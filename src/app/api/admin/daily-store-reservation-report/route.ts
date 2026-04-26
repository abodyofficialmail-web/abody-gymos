import { DateTime } from "luxon";
import { z } from "zod";
import { createSupabaseServiceClient } from "@/lib/supabase/admin";
import { jsonResponse } from "@/app/api/booking-v2/_cors";
import { sendDailyStoreReservationReport } from "@/lib/email";

const TZ = "Asia/Tokyo";
const SLOT_MINUTES = 30;

const querySchema = z.object({
  // today: 当日分(08:00), tomorrow: 翌日分(22:00前日)
  target: z.enum(["today", "tomorrow"]),
});

function mustCronAuth(req: Request): boolean {
  const secret = process.env.REPORT_CRON_SECRET;
  if (!secret) return false;
  const got = req.headers.get("x-cron-secret") ?? "";
  return got === secret;
}

function formatDateJa(ymd: string) {
  const dt = DateTime.fromISO(ymd, { zone: TZ });
  return dt.isValid ? dt.setLocale("ja").toFormat("yyyy年M月d日（ccc）") : ymd;
}

function formatTimeJa(utcIso: string) {
  const dt = DateTime.fromISO(utcIso).setZone(TZ);
  return dt.toFormat("HH:mm");
}

async function fetchAvailableSlotsCount(params: { origin: string; storeId: string; dateYmd: string }): Promise<number> {
  const { origin, storeId, dateYmd } = params;
  const url = new URL("/api/booking-v2/available-slots", origin);
  url.searchParams.set("store_id", storeId);
  url.searchParams.set("date", dateYmd);
  const res = await fetch(url.toString(), { cache: "no-store" });
  const j = await res.json().catch(() => []);
  if (!res.ok) return 0;
  return Array.isArray(j) ? j.length : 0;
}

export async function GET(req: Request) {
  try {
    if (!mustCronAuth(req)) {
      return jsonResponse({ error: "unauthorized" }, 401);
    }

    const url = new URL(req.url);
    const parsed = querySchema.safeParse({ target: url.searchParams.get("target") });
    if (!parsed.success) return jsonResponse({ error: "invalid_query", detail: parsed.error.flatten() }, 400);

    const target = parsed.data.target;
    const nowJst = DateTime.now().setZone(TZ);
    const dateYmd = (target === "today" ? nowJst : nowJst.plus({ days: 1 })).toISODate()!;

    const supabase = createSupabaseServiceClient();

    // stores
    const { data: stores, error: storeErr } = await supabase
      .from("stores")
      .select("id,name,timezone,booking_cutoff_prev_day_time")
      .order("created_at", { ascending: true });
    if (storeErr) return jsonResponse({ error: "stores_fetch_failed", detail: storeErr.message }, 500);

    // reservations for date (all stores)
    const dayStartUtc = DateTime.fromISO(dateYmd, { zone: TZ }).startOf("day").toUTC();
    const dayEndUtc = dayStartUtc.plus({ days: 1 });
    const { data: reservations, error: resErr } = await supabase
      .from("reservations")
      .select("id, store_id, trainer_id, member_id, start_at, end_at, status")
      .neq("status", "cancelled")
      .gte("start_at", dayStartUtc.toISO()!)
      .lt("start_at", dayEndUtc.toISO()!);
    if (resErr) return jsonResponse({ error: "reservations_fetch_failed", detail: resErr.message }, 500);

    // shifts for date (all stores)
    const { data: shifts, error: shiftsErr } = await supabase
      .from("trainer_shifts")
      .select("id, store_id, trainer_id, shift_date, start_local, end_local, status, is_break")
      .eq("shift_date", dateYmd)
      .neq("status", "draft");
    if (shiftsErr) return jsonResponse({ error: "shifts_fetch_failed", detail: shiftsErr.message }, 500);

    // members / trainers names
    const memberIds = Array.from(new Set((reservations ?? []).map((r: any) => String(r.member_id)).filter(Boolean)));
    const trainerIds = Array.from(
      new Set(
        [
          ...(reservations ?? []).map((r: any) => String(r.trainer_id ?? "")).filter(Boolean),
          ...(shifts ?? []).map((s: any) => String(s.trainer_id ?? "")).filter(Boolean),
        ].filter(Boolean)
      )
    );

    const [membersQ, trainersQ] = await Promise.all([
      memberIds.length
        ? supabase.from("members").select("id,member_code,name,display_name").in("id", memberIds)
        : Promise.resolve({ data: [], error: null } as any),
      trainerIds.length
        ? supabase.from("trainers").select("id,display_name").in("id", trainerIds)
        : Promise.resolve({ data: [], error: null } as any),
    ]);
    if (membersQ.error) return jsonResponse({ error: "members_fetch_failed", detail: membersQ.error.message }, 500);
    if (trainersQ.error) return jsonResponse({ error: "trainers_fetch_failed", detail: trainersQ.error.message }, 500);

    const memberById = new Map<string, { member_code: string; name: string }>();
    for (const m of membersQ.data ?? []) {
      memberById.set(String((m as any).id), {
        member_code: String((m as any).member_code ?? ""),
        name: String((m as any).display_name ?? (m as any).name ?? ""),
      });
    }
    const trainerNameById = new Map<string, string>();
    for (const t of trainersQ.data ?? []) {
      trainerNameById.set(String((t as any).id), String((t as any).display_name ?? ""));
    }

    const to = process.env.REPORT_MAIL_TO ?? "abodyofficial.mail@gmail.com";
    const origin = url.origin;
    const sent: Array<{ store_id: string; ok: boolean; subject: string }> = [];

    for (const st of stores ?? []) {
      const storeId = String((st as any).id);
      const storeName = String((st as any).name ?? "");

      const resList = (reservations ?? [])
        .filter((r: any) => String(r.store_id) === storeId)
        .slice()
        .sort((a: any, b: any) => String(a.start_at).localeCompare(String(b.start_at)));

      const shiftList = (shifts ?? [])
        .filter((s: any) => String(s.store_id) === storeId)
        .filter((s: any) => s.is_break !== true)
        .slice()
        .sort((a: any, b: any) => String(a.start_local).localeCompare(String(b.start_local)));

      const slotCount = await fetchAvailableSlotsCount({ origin, storeId, dateYmd });
      const freeMinutes = slotCount * SLOT_MINUTES;

      const sessionCount = resList.length;

      const shiftLines =
        shiftList.length === 0
          ? ["（勤務予定なし）"]
          : shiftList.map((s: any) => {
              const trainerName = trainerNameById.get(String(s.trainer_id)) ?? String(s.trainer_id);
              return `- ${trainerName}: ${String(s.start_local).slice(0, 5)}〜${String(s.end_local).slice(0, 5)}`;
            });

      const resLines =
        resList.length === 0
          ? ["（予約なし）"]
          : resList.map((r: any) => {
              const member = memberById.get(String(r.member_id));
              const memberCode = member?.member_code ? member.member_code : String(r.member_id);
              const memberName = member?.name ? member.name : "";
              const tName = r.trainer_id ? trainerNameById.get(String(r.trainer_id)) ?? "" : "";
              const time = `${formatTimeJa(String(r.start_at))}〜${formatTimeJa(String(r.end_at))}`;
              const who = `${memberCode} ${memberName}`.trim();
              const trainerSuffix = tName ? `（${tName}）` : "";
              return `- ${time}  ${who}${trainerSuffix}`;
            });

      const subject = `【予約一覧】${formatDateJa(dateYmd)} / ${storeName}（セッション${sessionCount}件）`;
      const text = [
        `日付: ${formatDateJa(dateYmd)}`,
        `店舗: ${storeName}`,
        ``,
        `担当トレーナー勤務予定時間:`,
        ...shiftLines,
        ``,
        `セッション数: ${sessionCount}`,
        ``,
        `予約一覧:`,
        ...resLines,
        ``,
        `空き枠: ${slotCount}枠（約${Math.floor(freeMinutes / 60)}h${freeMinutes % 60}m）`,
        ``,
        `※空き枠は予約カレンダーの表示ロジック（available-slots）と同じ算出です。`,
      ].join("\n");

      const ok = await sendDailyStoreReservationReport({ to, subject, text });
      sent.push({ store_id: storeId, ok, subject });
    }

    return jsonResponse({ ok: true, target, date: dateYmd, sent }, 200);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return jsonResponse({ error: "unexpected_error", detail: message }, 500);
  }
}

