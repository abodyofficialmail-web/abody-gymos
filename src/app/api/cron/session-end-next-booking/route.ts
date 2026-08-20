import { DateTime } from "luxon";
import { createSupabaseServiceClient } from "@/lib/supabase/admin";
import { jsonResponse } from "@/app/api/booking-v2/_cors";
import { upsertSessionSurveyInvite, sendNextBookingLineForInvite } from "@/lib/sessionSurveyLine";

const TZ = "Asia/Tokyo";
/** 終了の 5〜15 分後に送る（10分間隔 cron で拾う） */
const WINDOW_MIN = 5;
const WINDOW_MAX = 15;

function mustCronAuth(req: Request): boolean {
  const reportSecret = process.env.REPORT_CRON_SECRET?.trim();
  const cronSecret = process.env.CRON_SECRET?.trim();
  const gateSecret = process.env.TRAINER_GATE_SECRET?.trim();
  const got = req.headers.get("x-cron-secret") ?? "";
  const auth = req.headers.get("authorization") ?? "";
  const testKey = req.headers.get("x-session-survey-test-key") ?? "";
  if (reportSecret && got === reportSecret) return true;
  if (cronSecret && auth === `Bearer ${cronSecret}`) return true;
  if (gateSecret && testKey === gateSecret) return true;
  return false;
}

function isDupInsertError(err: { code?: string; message?: string } | null): boolean {
  const c = String(err?.code ?? "");
  const m = String(err?.message ?? "");
  return c === "23505" || m.includes("duplicate") || m.includes("unique");
}

function isMissingTable(err: { code?: string; message?: string } | null | undefined): boolean {
  const c = String(err?.code ?? "");
  const m = String(err?.message ?? "");
  return (
    c === "PGRST205" ||
    m.includes("session_end_next_booking_dispatches") ||
    m.includes("does not exist") ||
    m.includes("Could not find the table") ||
    m.includes("schema cache")
  );
}

function pickRelName(
  rel:
    | { display_name?: string | null; name?: string | null }
    | { display_name?: string | null; name?: string | null }[]
    | null,
  field: "display_name" | "name"
): string {
  if (!rel) return "";
  const row = Array.isArray(rel) ? rel[0] : rel;
  const v = row?.[field];
  return typeof v === "string" ? v.trim() : "";
}

type ReservationRow = {
  id: string;
  start_at: string;
  end_at: string;
  member_id: string;
  store_id: string;
  trainer_id: string | null;
  members:
    | {
        id: string;
        member_code: string | null;
        line_user_id: string | null;
        line_channel_key: string | null;
        is_active: boolean | null;
      }
    | {
        id: string;
        member_code: string | null;
        line_user_id: string | null;
        line_channel_key: string | null;
        is_active: boolean | null;
      }[]
    | null;
  stores: { name?: string | null } | { name?: string | null }[] | null;
};

/**
 * セッション終了 5〜15 分後に、対象会員へ次回予約カードを送る。
 */
export async function GET(req: Request) {
  try {
    if (!mustCronAuth(req)) {
      return jsonResponse({ error: "unauthorized" }, 401);
    }

    const supabase = createSupabaseServiceClient();
    const now = DateTime.now().setZone(TZ);
    const windowStart = now.minus({ minutes: WINDOW_MAX }).toUTC().toISO()!;
    const windowEnd = now.minus({ minutes: WINDOW_MIN }).toUTC().toISO()!;

    const { data: rows, error: rErr } = await supabase
      .from("reservations")
      .select(
        `
        id,
        start_at,
        end_at,
        member_id,
        store_id,
        trainer_id,
        members (
          id,
          member_code,
          line_user_id,
          line_channel_key,
          is_active
        ),
        stores ( name )
      `
      )
      .eq("status", "confirmed")
      .not("member_id", "is", null)
      .gt("end_at", windowStart)
      .lte("end_at", windowEnd);

    if (rErr) {
      return jsonResponse({ error: "reservations_fetch_failed", detail: rErr.message }, 500);
    }

    const results: Array<Record<string, unknown>> = [];

    for (const raw of (rows ?? []) as unknown as ReservationRow[]) {
      const member = Array.isArray(raw.members) ? raw.members[0] : raw.members;
      if (!member?.id || !member.is_active || !member.line_user_id) {
        results.push({ reservation_id: raw.id, sent: false, skipped: "member_or_line_missing" });
        continue;
      }
      if (!raw.store_id || !raw.trainer_id) {
        results.push({ reservation_id: raw.id, sent: false, skipped: "trainer_or_store_missing" });
        continue;
      }

      const { error: claimErr } = await supabase.from("session_end_next_booking_dispatches").insert({
        reservation_id: raw.id,
      });
      if (claimErr && isMissingTable(claimErr)) {
        return jsonResponse(
          {
            error: "migration_required",
            detail: "Supabase で session_end_next_booking_dispatches のマイグレーションを実行してください",
          },
          500
        );
      }
      if (claimErr && isDupInsertError(claimErr)) {
        results.push({ reservation_id: raw.id, sent: false, skipped: "already_sent" });
        continue;
      }
      if (claimErr) {
        results.push({
          reservation_id: raw.id,
          sent: false,
          error: "dispatch_claim_failed",
          detail: claimErr.message,
        });
        continue;
      }

      const sessionDate = DateTime.fromISO(raw.start_at).setZone(TZ).toISODate();
      if (!sessionDate) {
        results.push({ reservation_id: raw.id, sent: false, skipped: "session_date_invalid" });
        continue;
      }

      const invite = await upsertSessionSurveyInvite(supabase, {
        member_id: member.id,
        trainer_id: raw.trainer_id,
        store_id: raw.store_id,
        session_date: sessionDate,
      });
      if (!invite?.id) {
        results.push({ reservation_id: raw.id, sent: false, error: "invite_missing" });
        continue;
      }

      const storeName = pickRelName(raw.stores, "name") || "店舗";
      const sent = await sendNextBookingLineForInvite(supabase, {
        inviteId: invite.id,
        memberId: member.id,
        storeId: raw.store_id,
        sessionDate,
        lineUserId: String(member.line_user_id),
        memberCode: member.member_code,
        lineChannelKey: member.line_channel_key,
        storeName,
      });

      results.push({
        reservation_id: raw.id,
        member_code: member.member_code,
        sent,
        skipped: sent ? undefined : "not_eligible_or_line_failed",
        session_date: sessionDate,
        store_name: storeName,
      });
    }

    return jsonResponse(
      {
        ok: true,
        window: { min_minutes: WINDOW_MIN, max_minutes: WINDOW_MAX, start: windowStart, end: windowEnd },
        count: results.length,
        results,
      },
      200
    );
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return jsonResponse({ error: "unexpected_error", detail: message }, 500);
  }
}
