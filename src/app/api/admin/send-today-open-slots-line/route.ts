import { DateTime } from "luxon";
import { z } from "zod";
import { GET as getAvailableSlots } from "@/app/api/booking-v2/available-slots/route";
import { createSupabaseServiceClient } from "@/lib/supabase/admin";
import {
  buildInviteShiftLineMessages,
  filterInviteSlotsByStarts,
  listOpenInviteSlots,
  loadInviteContext,
  pushInviteShiftLine,
  signInviteShiftQuery,
} from "@/lib/inviteShiftBooking";

const TZ = "Asia/Tokyo";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function mustAuth(req: Request): boolean {
  const gateSecret = process.env.TRAINER_GATE_SECRET?.trim();
  const cronSecret = process.env.CRON_SECRET?.trim();
  const testKey =
    req.headers.get("x-goal-hearing-test-key") ?? req.headers.get("x-reservation-reminder-test-key") ?? "";
  const auth = req.headers.get("authorization") ?? "";
  const bearer = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
  if (gateSecret && (testKey === gateSecret || bearer === gateSecret)) return true;
  if (cronSecret && (testKey === cronSecret || bearer === cronSecret)) return true;
  return false;
}

const bodySchema = z.object({
  dry_run: z.boolean().optional().default(false),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u),
  groups: z
    .array(
      z.object({
        store_name: z.string().min(1),
        member_codes: z.array(z.string().min(1)).min(1),
      })
    )
    .min(1),
});

function toMinutes(t: string): number {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(t ?? "").trim());
  if (!m) return NaN;
  return Number(m[1]) * 60 + Number(m[2]);
}

function hhmm(iso: string): string {
  return DateTime.fromISO(iso).setZone(TZ).toFormat("HH:mm");
}

async function openStarts(storeId: string, date: string): Promise<string[]> {
  const req = new Request(
    `http://open-slots.internal/api/booking-v2/available-slots?store_id=${encodeURIComponent(storeId)}&date=${encodeURIComponent(date)}&ignore_cutoff=1`
  );
  const res = await getAvailableSlots(req);
  const body = await res.json().catch(() => null);
  if (!res.ok || !Array.isArray(body)) return [];
  const now = DateTime.now().setZone(TZ);
  const starts = (body as Array<{ start_at?: string }>)
    .map((slot) => String(slot.start_at ?? ""))
    .filter(Boolean)
    .filter((iso) => {
      const start = DateTime.fromISO(iso).setZone(TZ);
      return start.isValid && start > now;
    })
    .map(hhmm);
  return [...new Set(starts)].sort();
}

export async function POST(req: Request) {
  try {
    if (!mustAuth(req)) return json({ error: "unauthorized" }, 401);
    const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return json({ error: "invalid_body", detail: parsed.error.flatten() }, 400);

    const supabase = createSupabaseServiceClient();
    const { date, dry_run: dryRun } = parsed.data;
    const dateLabel = DateTime.fromISO(date, { zone: TZ }).setLocale("ja").toFormat("M月d日（ccc）");
    const results: Array<Record<string, unknown>> = [];

    for (const group of parsed.data.groups) {
      const storeName = group.store_name.trim();
      const { data: store, error: storeErr } = await supabase
        .from("stores")
        .select("id, name")
        .eq("name", storeName)
        .maybeSingle();
      if (storeErr || !store) {
        results.push({ store_name: storeName, ok: false, error: storeErr?.message ?? "store_not_found" });
        continue;
      }

      const starts = await openStarts(store.id, date);
      if (starts.length === 0) {
        results.push({ store_name: storeName, ok: false, error: "no_open_slots", slots: [] });
        continue;
      }

      const { data: shiftRows, error: shiftErr } = await supabase
        .from("trainer_shifts")
        .select("id, trainer_id, start_local, end_local, status, is_break")
        .eq("store_id", store.id)
        .eq("shift_date", date)
        .neq("status", "draft");
      if (shiftErr) {
        results.push({ store_name: storeName, ok: false, error: shiftErr.message });
        continue;
      }
      const shifts = (shiftRows ?? []).filter((row) => row.is_break !== true);
      const wanted = starts.map(toMinutes);
      const ranked = shifts
        .map((row) => {
          const a = toMinutes(String(row.start_local));
          const b = toMinutes(String(row.end_local));
          const covered = wanted.filter((m) => m >= a && m + 30 <= b).length;
          return { row, covered, span: b - a };
        })
        .filter((item) => item.covered > 0)
        .sort((a, b) => b.covered - a.covered || b.span - a.span);
      const shift = ranked[0]?.row;
      if (!shift) {
        results.push({ store_name: storeName, ok: false, error: "shift_not_found", slots: starts });
        continue;
      }

      const { data: trainer } = shift.trainer_id
        ? await supabase.from("trainers").select("display_name").eq("id", shift.trainer_id).maybeSingle()
        : { data: null };
      const endMin = Math.max(...wanted) + 30;
      const expiresAt = DateTime.fromISO(date, { zone: TZ }).startOf("day").plus({ minutes: endMin });

      for (const rawCode of group.member_codes) {
        const code = rawCode.trim().toUpperCase();
        const { data: member, error: memberErr } = await supabase
          .from("members")
          .select("id, member_code, name, display_name, line_user_id, line_channel_key, is_active")
          .eq("member_code", code)
          .maybeSingle();
        if (memberErr || !member) {
          results.push({ store_name: storeName, member_code: code, ok: false, error: memberErr?.message ?? "member_not_found" });
          continue;
        }
        const signed = signInviteShiftQuery({
          memberId: member.id,
          shiftId: shift.id,
          slotMinutes: 30,
          expiresAtMs: expiresAt.toMillis(),
        });
        if (!signed) {
          results.push({ store_name: storeName, member_code: code, ok: false, error: "sign_secret_missing" });
          continue;
        }
        const loaded = await loadInviteContext(supabase, signed);
        if (!loaded.ok) {
          results.push({ store_name: storeName, member_code: code, ok: false, error: loaded.error });
          continue;
        }
        const slots = filterInviteSlotsByStarts(await listOpenInviteSlots(supabase, loaded.ctx), starts);
        const name = String(member.display_name ?? member.name ?? "");
        if (slots.length === 0) {
          results.push({
            store_name: storeName,
            member_code: code,
            name,
            ok: false,
            error: "no_slots_for_member",
            trainer: trainer?.display_name ?? null,
          });
          continue;
        }
        const timeLines = slots.map((slot) => slot.time_label).join("\n");
        const intro = `お世話になっております。
Abodyです。

本日${dateLabel}、${storeName}店に空きがあります。

${timeLines}

カードは${storeName}店の枠です。横にスライドして、「この枠で予約する」からお取りください。
先着順です。`;
        const messages = buildInviteShiftLineMessages({
          storeName,
          query: signed,
          slotMinutes: 30,
          slots,
          dateLabel,
          timeRangeLabel: slots.map((slot) => hhmm(slot.start_at)).join(" / "),
          intro,
          altText: `本日 ${storeName}店の空き ${slots.map((slot) => hhmm(slot.start_at)).join(" / ")}`,
        });
        if (!member.line_user_id) {
          results.push({ store_name: storeName, member_code: code, name, ok: false, error: "no_line_user_id", slots: slots.map((slot) => slot.time_label) });
          continue;
        }
        if (dryRun) {
          results.push({
            store_name: storeName,
            member_code: code,
            name,
            ok: true,
            dry_run: true,
            trainer: trainer?.display_name ?? null,
            slots: slots.map((slot) => slot.time_label),
          });
          continue;
        }
        const sent = await pushInviteShiftLine({
          lineUserId: member.line_user_id,
          memberCode: member.member_code,
          lineChannelKey: member.line_channel_key,
          storeName,
          messages,
        });
        results.push({
          store_name: storeName,
          member_code: code,
          name,
          ok: sent.ok,
          status: sent.status,
          error: sent.ok ? undefined : sent.error ?? sent.body?.slice(0, 180),
          trainer: trainer?.display_name ?? null,
          slots: slots.map((slot) => slot.time_label),
        });
      }
    }

    return json({ ok: results.every((row) => row.ok), date, results }, 200);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
}
