import { DateTime } from "luxon";
import { z } from "zod";
import { createSupabaseServiceClient } from "@/lib/supabase/admin";
import {
  SAK_SEP11_INVITE,
  SHINJUKU_SEP16_LEFTOVER,
  UENO_SEP17_LEFTOVER,
  buildInviteShiftLineMessages,
  ensureInviteShift,
  filterInviteSlotsByStarts,
  findConfirmedShift,
  generateInviteSlots,
  listOpenInviteSlots,
  loadInviteContext,
  pushInviteShiftLine,
  signInviteShiftQuery,
} from "@/lib/inviteShiftBooking";

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
  const serviceKey = req.headers.get("x-service-role-key") ?? "";
  const expected = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? "";
  if (gateSecret && (testKey === gateSecret || bearer === gateSecret)) return true;
  if (cronSecret && (testKey === cronSecret || bearer === cronSecret)) return true;
  if (expected && serviceKey === expected) return true;
  return false;
}

const shiftSchema = z.object({
  store_name: z.string().min(1),
  trainer_name: z.string().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  start: z.string().regex(/^\d{2}:\d{2}$/),
  end: z.string().regex(/^\d{2}:\d{2}$/),
});

const bodySchema = z.object({
  dry_run: z.boolean().optional().default(false),
  member_codes: z.array(z.string().min(1)).min(1),
  slot_minutes_by_code: z.record(z.union([z.literal(30), z.literal(60)])).optional(),
  campaign: z.enum(["sak-sep11", "shinjuku-sep16", "ueno-sep17"]).optional().default("sak-sep11"),
  shift: shiftSchema.optional(),
  intro: z.string().min(1).optional(),
  alt_text: z.string().min(1).optional(),
  slot_starts: z.array(z.string().regex(/^\d{2}:\d{2}$/)).optional(),
});

export async function POST(req: Request) {
  try {
    if (!mustAuth(req)) return json({ error: "unauthorized" }, 401);
    const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return json({ error: "invalid_body", detail: parsed.error.flatten() }, 400);

    const supabase = createSupabaseServiceClient();
    const requested = parsed.data.shift;
    if (requested && !parsed.data.intro) return json({ error: "intro_required" }, 400);
    const campaignKey = parsed.data.campaign;
    const campaign = requested
      ? {
          date: requested.date,
          start: requested.start,
          end: requested.end,
          storeName: requested.store_name.trim(),
          trainerName: requested.trainer_name.trim(),
          slotMinutesByCode: {} as Record<string, 30 | 60>,
        }
      : campaignKey === "ueno-sep17"
        ? UENO_SEP17_LEFTOVER
        : campaignKey === "shinjuku-sep16"
          ? SHINJUKU_SEP16_LEFTOVER
          : SAK_SEP11_INVITE;
    const shift = await (requested || campaignKey !== "sak-sep11"
      ? findConfirmedShift({
          supabase,
          storeName: campaign.storeName,
          trainerName: campaign.trainerName,
          dateYmd: campaign.date,
          startLocal: campaign.start,
          endLocal: campaign.end,
        })
      : ensureInviteShift({
          supabase,
          storeName: campaign.storeName,
          trainerName: campaign.trainerName,
          dateYmd: campaign.date,
          startLocal: campaign.start,
          endLocal: campaign.end,
        }));
    const expiresAt = DateTime.fromISO(`${campaign.date}T${campaign.end}:00`, { zone: "Asia/Tokyo" });
    const expiresAtMs = expiresAt.toMillis();
    if (!expiresAt.isValid) return json({ error: "expires_at の計算に失敗しました" }, 500);

    const dateLabel = DateTime.fromISO(`${campaign.date}T${campaign.start}:00`, { zone: "Asia/Tokyo" })
      .setLocale("ja")
      .toFormat("M月d日（ccc）");
    const timeRangeLabel = `${campaign.start}〜${campaign.end}`;
    const leftoverIntro = requested
      ? parsed.data.intro!
      : campaignKey === "ueno-sep17"
        ? `お世話になっております！
Abodyです😊

明日 ${dateLabel} 上野店に、30分の空き枠があります。

下のカードを横にスライドして、希望の時間の「この枠で予約する」からお取りください。
16:00〜18:00は連続なので、60分希望の方は2枠お取りください。
先着順です。埋まっている時間は選べません。

ご不明点はお気軽にご連絡ください！`
        : `お世話になっております！
Abodyです😊

本日 ${dateLabel} 新宿店に、30分の空き枠が残っています。

下のカードを横にスライドして、希望の時間の「この枠で予約する」からお取りください。
先着順です。埋まっている時間は選べません。

ご不明点はお気軽にご連絡ください！`;
    const allowedStarts: string[] | undefined = requested
      ? parsed.data.slot_starts
      : (parsed.data.slot_starts ?? (campaignKey === "ueno-sep17" ? UENO_SEP17_LEFTOVER.allowedStarts : undefined));

    const results: Array<Record<string, unknown>> = [];
    for (const rawCode of parsed.data.member_codes) {
      const code = rawCode.trim().toUpperCase();
      const { data: member, error: mErr } = await supabase
        .from("members")
        .select("id, member_code, name, display_name, line_user_id, line_channel_key, is_active")
        .eq("member_code", code)
        .maybeSingle();
      if (mErr || !member) {
        results.push({ member_code: code, ok: false, error: mErr?.message ?? "member_not_found" });
        continue;
      }
      const minutes =
        parsed.data.slot_minutes_by_code?.[code] ?? campaign.slotMinutesByCode[code] ?? 30;
      const signed = signInviteShiftQuery({
        memberId: member.id,
        shiftId: shift.shiftId,
        slotMinutes: minutes,
        expiresAtMs,
      });
      if (!signed) {
        results.push({ member_code: code, ok: false, error: "sign_secret_missing" });
        continue;
      }
      const loaded = await loadInviteContext(supabase, signed);
      if (!loaded.ok) {
        results.push({ member_code: code, ok: false, error: loaded.error });
        continue;
      }
      const openSlots = filterInviteSlotsByStarts(await listOpenInviteSlots(supabase, loaded.ctx), allowedStarts);
      const previewSlots =
        openSlots.length > 0
          ? openSlots
          : filterInviteSlotsByStarts(
              generateInviteSlots({
                dateYmd: campaign.date,
                startLocal: campaign.start,
                endLocal: campaign.end,
                slotMinutes: minutes,
              }),
              allowedStarts
            );
      const messages = buildInviteShiftLineMessages({
        storeName: campaign.storeName,
        query: signed,
        slotMinutes: minutes,
        slots: previewSlots,
        dateLabel,
        timeRangeLabel,
        intro: parsed.data.intro ?? (campaignKey === "sak-sep11" ? undefined : leftoverIntro),
        altText:
          parsed.data.alt_text ??
          (campaignKey === "ueno-sep17"
            ? `${dateLabel} 上野の空き枠`
            : campaignKey === "shinjuku-sep16"
              ? `${dateLabel} 新宿の空き枠`
              : undefined),
      });

      if (!member.line_user_id) {
        results.push({
          member_code: code,
          name: member.display_name ?? member.name,
          ok: false,
          error: "no_line_user_id",
        });
        continue;
      }
      if (parsed.data.dry_run) {
        results.push({
          member_code: code,
          name: member.display_name ?? member.name,
          ok: true,
          dry_run: true,
          slot_minutes: minutes,
          open_slots: openSlots.length,
        });
        continue;
      }
      const sent = await pushInviteShiftLine({
        lineUserId: member.line_user_id,
        memberCode: member.member_code,
        lineChannelKey: member.line_channel_key,
        storeName: campaign.storeName,
        messages,
      });
      results.push({
        member_code: code,
        name: member.display_name ?? member.name,
        ok: sent.ok,
        status: sent.status,
        body: (sent.body ?? sent.error ?? "").slice(0, 200),
        slot_minutes: minutes,
        open_slots: openSlots.length,
      });
    }

    return json({
      ok: results.every((r) => r.ok),
      shift_id: shift.shiftId,
      visibility: "visibility" in shift ? shift.visibility : "unchanged",
      date: campaign.date,
      campaign: parsed.data.campaign,
      results,
    });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
}
