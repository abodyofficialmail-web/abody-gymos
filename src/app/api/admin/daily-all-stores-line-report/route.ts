import { DateTime } from "luxon";
import { z } from "zod";
import { jsonResponse } from "@/app/api/booking-v2/_cors";
import { createSupabaseServiceClient } from "@/lib/supabase/admin";
import { dailyReportChannelToken } from "@/lib/dailyLineRecipients";
import { listMidMonthLowBookingMembers } from "@/lib/midMonthLowBooking";
import {
  buildDailyOpsText,
  loadDailySurveyVoices,
  loadKarteDoneKeys,
  loadOpenOpsMessages,
  type DailyOpsBundle,
} from "@/lib/trainerDailyBriefing";
import { pushOpsTexts, resolveOpsRecipients } from "@/lib/trainerOpsScope";

const TZ = "Asia/Tokyo";

/**
 * --- 送信文面の雛形（全店舗まとめ）-----------------------------------
 * 【全店舗】2026年5月5日（火）｜明日の業務サマリ（前日22時・JST送信／対象は翌日）
 *
 * ━━ 恵比寿 ━━
 * ■ 勤務予定
 * （勤務予定なし）
 *
 * ■ 予定（MTG/撮影/作業など）
 * （予定なし）
 *
 * ■ 予約一覧（0件）
 * （予約なし）
 *
 * ━━ 上野 ━━
 * …
 * -------------------------------------------------------------------
 */

const querySchema = z.object({
  target: z.enum(["today", "tomorrow"]),
  dry_run: z.enum(["0", "1"]).optional(),
});

/** x-cron-secret + REPORT_CRON_SECRET、または Authorization: Bearer + CRON_SECRET（Vercel標準） */
function mustCronAuth(req: Request): boolean {
  const reportSecret = process.env.REPORT_CRON_SECRET?.trim();
  const cronSecret = process.env.CRON_SECRET?.trim();
  const got = req.headers.get("x-cron-secret") ?? "";
  const auth = req.headers.get("authorization") ?? "";
  if (reportSecret && got === reportSecret) return true;
  if (cronSecret && auth === `Bearer ${cronSecret}`) return true;
  return false;
}

export async function GET(req: Request) {
  try {
    if (!mustCronAuth(req)) {
      return jsonResponse({ error: "unauthorized" }, 401);
    }

    const url = new URL(req.url);
    const parsed = querySchema.safeParse({
      target: url.searchParams.get("target"),
      dry_run: url.searchParams.get("dry_run") ?? undefined,
    });
    if (!parsed.success) return jsonResponse({ error: "invalid_query", detail: parsed.error.flatten() }, 400);

    const target = parsed.data.target;
    const dryRun = parsed.data.dry_run === "1";

    const nowJst = DateTime.now().setZone(TZ);
    const dateYmd = (target === "today" ? nowJst : nowJst.plus({ days: 1 })).toISODate()!;

    const supabase = createSupabaseServiceClient();

    const recipients = await resolveOpsRecipients(supabase);

    const token = dailyReportChannelToken();
    if (!dryRun && !token) {
      return jsonResponse(
        {
          error: "missing_token",
          detail: "LINE_DAILY_REPORT_CHANNEL_TOKEN または LINE_CHANNEL_ACCESS_TOKEN を設定してください",
        },
        500
      );
    }

    if (!dryRun && recipients.length === 0) {
      return jsonResponse(
        {
          error: "missing_recipients",
          detail:
            "送信先がありません。LINE_DAILY_REPORT_USER_IDS を設定するか、会員番号（既定EBI020）の LINE連携、またはトレーナーLINE連携を確認してください。",
        },
        500
      );
    }

    const { data: storeRows, error: storeErr } = await supabase
      .from("stores")
      .select("id,name")
      .eq("is_active", true)
      .order("name", { ascending: true });
    if (storeErr) return jsonResponse({ error: "stores_fetch_failed", detail: storeErr.message }, 500);

    const stores = (storeRows ?? []) as { id: string; name: string }[];
    if (stores.length === 0) {
      return jsonResponse({ error: "no_active_stores", detail: "有効な店舗がありません" }, 500);
    }

    const dayStartUtc = DateTime.fromISO(dateYmd, { zone: TZ }).startOf("day").toUTC();
    const dayEndUtc = dayStartUtc.plus({ days: 1 });

    const { data: reservations, error: resErr } = await supabase
      .from("reservations")
      .select("id, store_id, trainer_id, member_id, start_at, end_at, status, session_type")
      .neq("status", "cancelled")
      .gte("start_at", dayStartUtc.toISO()!)
      .lt("start_at", dayEndUtc.toISO()!);
    if (resErr) return jsonResponse({ error: "reservations_fetch_failed", detail: resErr.message }, 500);

    const { data: shifts, error: shiftsErr } = await supabase
      .from("trainer_shifts")
      .select("id, store_id, trainer_id, shift_date, start_local, end_local, status, is_break")
      .eq("shift_date", dateYmd)
      .neq("status", "draft");
    if (shiftsErr) return jsonResponse({ error: "shifts_fetch_failed", detail: shiftsErr.message }, 500);

    let events: Array<{
      store_id: string;
      trainer_id: string;
      start_local: string;
      end_local: string;
      title: string;
      notes: string | null;
      block_booking: boolean;
    }> = [];

    const evQ = await supabase
      .from("trainer_events")
      .select("store_id,trainer_id,start_local,end_local,title,notes,block_booking")
      .eq("event_date", dateYmd);
    if (!evQ.error && evQ.data) events = evQ.data as typeof events;

    const reservationsFiltered = (reservations ?? []).filter((r) =>
      stores.some((st) => st.id === String(r.store_id))
    );

    const memberIds = Array.from(new Set(reservationsFiltered.map((r) => String(r.member_id)).filter(Boolean)));
    const trainerIds = Array.from(
      new Set(
        [
          ...reservationsFiltered.map((r) => String(r.trainer_id ?? "")).filter(Boolean),
          ...(shifts ?? []).map((s) => String(s.trainer_id ?? "")).filter(Boolean),
          ...events.map((e) => String(e.trainer_id ?? "")).filter(Boolean),
        ].filter(Boolean)
      )
    );

    const [membersQ, trainersQ] = await Promise.all([
      memberIds.length
        ? supabase.from("members").select("id,member_code,name,display_name").in("id", memberIds)
        : Promise.resolve({ data: [], error: null } as const),
      trainerIds.length
        ? supabase.from("trainers").select("id,display_name").in("id", trainerIds)
        : Promise.resolve({ data: [], error: null } as const),
    ]);
    if (membersQ.error) return jsonResponse({ error: "members_fetch_failed", detail: membersQ.error.message }, 500);
    if (trainersQ.error) return jsonResponse({ error: "trainers_fetch_failed", detail: trainersQ.error.message }, 500);

    const memberById = new Map<string, { member_code: string; name: string }>();
    for (const m of membersQ.data ?? []) {
      memberById.set(String(m.id), {
        member_code: String(m.member_code ?? ""),
        name: String(m.display_name ?? m.name ?? ""),
      });
    }
    const trainerNameById = new Map<string, string>();
    for (const t of trainersQ.data ?? []) {
      trainerNameById.set(String(t.id), String(t.display_name ?? ""));
    }
    const storeNameById = new Map(stores.map((s) => [s.id, s.name]));

    const voiceYmd = target === "tomorrow" ? nowJst.toISODate()! : dateYmd;
    const reservationMemberIds = Array.from(
      new Set(reservationsFiltered.map((r) => String(r.member_id ?? "")).filter(Boolean))
    );
    const [lowBookingPack, voices, opsMessages, karteDone] = await Promise.all([
      listMidMonthLowBookingMembers(supabase, nowJst),
      loadDailySurveyVoices(supabase, voiceYmd),
      loadOpenOpsMessages(supabase),
      loadKarteDoneKeys(supabase, dateYmd, reservationMemberIds),
    ]);

    const bundle: DailyOpsBundle = {
      dateYmd,
      target,
      stores,
      shifts: ((shifts ?? []) as any[]).map((s) => ({
        store_id: String(s.store_id),
        trainer_id: String(s.trainer_id),
        start_local: String(s.start_local),
        end_local: String(s.end_local),
        is_break: s.is_break,
      })),
      events: events.map((e) => ({
        store_id: String(e.store_id),
        trainer_id: String(e.trainer_id),
        start_local: String(e.start_local),
        end_local: String(e.end_local),
        title: String(e.title ?? ""),
        notes: e.notes ?? null,
        block_booking: Boolean(e.block_booking),
      })),
      reservations: reservationsFiltered.map((r) => ({
        store_id: String(r.store_id),
        trainer_id: r.trainer_id ? String(r.trainer_id) : null,
        member_id: r.member_id ? String(r.member_id) : null,
        start_at: String(r.start_at),
        end_at: String(r.end_at),
      })),
      memberById,
      trainerNameById,
      storeNameById,
      lowBooking: lowBookingPack.members,
      voices,
      opsMessages,
      karteDone,
    };

    const previewByKind: Record<string, string> = {};
    for (const r of recipients) {
      if (previewByKind[r.kind]) continue;
      const text = buildDailyOpsText(bundle, r);
      if (text) previewByKind[r.kind] = text;
    }

    if (dryRun) {
      return jsonResponse(
        {
          ok: true,
          dry_run: true,
          target,
          date: dateYmd,
          store_count: stores.length,
          recipient_count: recipients.length,
          recipients: recipients.map((r) => ({
            kind: r.kind,
            display_name: r.display_name,
            store_names: r.store_names,
            all_stores: r.all_stores,
          })),
          preview_by_kind: previewByKind,
        },
        200
      );
    }

    const pushed = await pushOpsTexts(supabase, (r) => buildDailyOpsText(bundle, r));

    return jsonResponse(
      {
        ok: pushed.ok,
        target,
        date: dateYmd,
        store_count: stores.length,
        recipients: recipients.length,
        sent: pushed.sent,
        skipped: pushed.skipped,
        error: pushed.error,
      },
      pushed.ok ? 200 : 502
    );
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return jsonResponse({ error: "unexpected_error", detail: message }, 500);
  }
}
