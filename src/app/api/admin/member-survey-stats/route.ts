import { DateTime } from "luxon";
import { z } from "zod";
import { calcSurveyResponseRate, type SurveyRateStats } from "@/lib/surveyRateDisplay";
import { currentSurveyMonthKey, isIsoInSurveyMonth, surveyMonthRange } from "@/lib/surveyMonth";
import { createSupabaseServiceClient } from "@/lib/supabase/admin";

const TZ = "Asia/Tokyo";
const INVITE_LEAD_MINUTES = 65;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const emptyStats = (): SurveyRateStats => ({ invite_count: 0, response_count: 0, response_rate: null });

const querySchema = z.object({
  store_id: z.string().uuid().optional(),
  month: z.string().regex(/^\d{4}-\d{2}$/).optional(),
});

export type MemberSurveyStatsRow = {
  pre_session: SurveyRateStats;
  post_session: SurveyRateStats;
};

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const parsed = querySchema.safeParse({
      store_id: url.searchParams.get("store_id") ?? undefined,
      month: url.searchParams.get("month") ?? undefined,
    });
    if (!parsed.success) return json({ error: "invalid_query" }, 400);

    const storeId = parsed.data.store_id;
    const monthKey = parsed.data.month ?? currentSurveyMonthKey();
    const { startDate, endDate } = surveyMonthRange(monthKey);
    const supabase = createSupabaseServiceClient();
    const stats: Record<string, MemberSurveyStatsRow> = {};

    const ensure = (memberId: string): MemberSurveyStatsRow => {
      if (!stats[memberId]) {
        stats[memberId] = { pre_session: emptyStats(), post_session: emptyStats() };
      }
      return stats[memberId];
    };

    const inviteThreshold = DateTime.now().setZone(TZ).plus({ minutes: INVITE_LEAD_MINUTES }).toISO()!;

    let postInviteQuery = supabase
      .from("session_survey_invites")
      .select("member_id, session_date")
      .gte("session_date", startDate)
      .lte("session_date", endDate);
    let postResponseQuery = supabase
      .from("session_survey_responses")
      .select("member_id, session_date")
      .gte("session_date", startDate)
      .lte("session_date", endDate);
    if (storeId) {
      postInviteQuery = postInviteQuery.eq("store_id", storeId);
      postResponseQuery = postResponseQuery.eq("store_id", storeId);
    }

    let preReservationQuery = supabase
      .from("reservations")
      .select("id, member_id, start_at")
      .eq("status", "confirmed")
      .lte("start_at", inviteThreshold)
      .not("member_id", "is", null)
      .gte("start_at", DateTime.fromISO(startDate, { zone: TZ }).startOf("day").toUTC().toISO()!)
      .lte("start_at", DateTime.fromISO(endDate, { zone: TZ }).endOf("day").toUTC().toISO()!);
    let preResponseQuery = supabase
      .from("pre_session_survey_responses")
      .select("member_id, reservation_id, session_start_at");
    if (storeId) {
      preReservationQuery = preReservationQuery.eq("store_id", storeId);
      preResponseQuery = preResponseQuery.eq("store_id", storeId);
    }

    const [postInvites, postResponses, preReservations, preResponses] = await Promise.all([
      postInviteQuery,
      postResponseQuery,
      preReservationQuery,
      preResponseQuery,
    ]);

    if (postInvites.error?.message?.includes("session_survey")) {
      return json({ stats: {} }, 200);
    }
    if (postInvites.error) return json({ error: postInvites.error.message }, 400);
    if (postResponses.error) return json({ error: postResponses.error.message }, 400);
    if (preResponses.error?.message?.includes("pre_session_survey")) {
      return json({ stats: {} }, 200);
    }
    if (preReservations.error) return json({ error: preReservations.error.message }, 400);
    if (preResponses.error) return json({ error: preResponses.error.message }, 400);

    for (const row of postInvites.data ?? []) {
      const memberId = String(row.member_id ?? "");
      if (!memberId) continue;
      ensure(memberId).post_session.invite_count += 1;
    }

    for (const row of postResponses.data ?? []) {
      const memberId = String(row.member_id ?? "");
      if (!memberId) continue;
      ensure(memberId).post_session.response_count += 1;
    }

    const preInviteIdsByMember = new Map<string, Set<string>>();
    for (const row of preReservations.data ?? []) {
      const memberId = String(row.member_id ?? "");
      const reservationId = String(row.id ?? "");
      if (!memberId || !reservationId) continue;
      const set = preInviteIdsByMember.get(memberId) ?? new Set<string>();
      set.add(reservationId);
      preInviteIdsByMember.set(memberId, set);
    }

    for (const row of preResponses.data ?? []) {
      const memberId = String(row.member_id ?? "");
      const reservationId = String(row.reservation_id ?? "");
      const sessionStartAt = String((row as { session_start_at?: string }).session_start_at ?? "");
      if (!memberId || !isIsoInSurveyMonth(sessionStartAt, monthKey)) continue;
      const rowStats = ensure(memberId);
      rowStats.pre_session.response_count += 1;
      if (reservationId) {
        const set = preInviteIdsByMember.get(memberId) ?? new Set<string>();
        set.add(reservationId);
        preInviteIdsByMember.set(memberId, set);
      }
    }

    for (const [memberId, ids] of preInviteIdsByMember) {
      ensure(memberId).pre_session.invite_count = ids.size;
    }

    for (const memberId of Object.keys(stats)) {
      const row = stats[memberId];
      row.pre_session.response_rate = calcSurveyResponseRate(
        row.pre_session.invite_count,
        row.pre_session.response_count
      );
      row.post_session.response_rate = calcSurveyResponseRate(
        row.post_session.invite_count,
        row.post_session.response_count
      );
    }

    return json({ stats, month: monthKey }, 200);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return json({ error: message }, 500);
  }
}
