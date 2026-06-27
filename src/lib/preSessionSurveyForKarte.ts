import { DateTime } from "luxon";
import type { PreSessionSurveyForKarte } from "@/lib/preSessionSurveyDisplay";
import type { SupabaseClient } from "@supabase/supabase-js";

const TZ = "Asia/Tokyo";

/** 60分前リマインド送信ウィンドウ（55〜65分前）の上限。これを過ぎた予約は招待済みとみなす */
const INVITE_LEAD_MINUTES = 65;

export type MemberPreSessionSurveyStats = {
  invite_count: number;
  response_count: number;
  response_rate: number | null;
};

export type MemberPreSessionSurveyData = {
  pre_session_by_date: Record<string, PreSessionSurveyForKarte>;
  latest_pre_session: PreSessionSurveyForKarte | null;
  pre_session_stats: MemberPreSessionSurveyStats;
  pre_session_invite_by_date: Record<string, true>;
};

type ResponseRow = {
  id: string;
  reservation_id: string;
  session_start_at: string;
  condition_score: number;
  meal_status: string;
  intensity_preference: string;
  request_focus: string | null;
  concern: string | null;
  free_comment: string | null;
  created_at: string;
  trainers: { display_name: string | null } | { display_name: string | null }[] | null;
  stores: { name: string | null } | { name: string | null }[] | null;
};

type ReservationRow = {
  id: string;
  start_at: string;
};

function pickName(
  rel: { display_name?: string | null; name?: string | null } | { display_name?: string | null; name?: string | null }[] | null,
  field: "display_name" | "name"
): string {
  if (!rel) return "";
  const row = Array.isArray(rel) ? rel[0] : rel;
  const v = row?.[field];
  return typeof v === "string" ? v.trim() : "";
}

function sessionDateFromStartAt(startAt: string): string {
  const dt = DateTime.fromISO(startAt).setZone(TZ);
  return dt.isValid ? dt.toISODate()! : startAt.slice(0, 10);
}

function isTableMissing(error: { code?: string; message?: string } | null): boolean {
  const msg = String(error?.message ?? "");
  return msg.includes("pre_session_survey") || error?.code === "PGRST205";
}

function emptyMemberPreSessionSurveyData(): MemberPreSessionSurveyData {
  return {
    pre_session_by_date: {},
    latest_pre_session: null,
    pre_session_stats: { invite_count: 0, response_count: 0, response_rate: null },
    pre_session_invite_by_date: {},
  };
}

export async function fetchPreSessionSurveysForMember(
  supabase: SupabaseClient,
  memberId: string
): Promise<MemberPreSessionSurveyData> {
  const inviteThreshold = DateTime.now().setZone(TZ).plus({ minutes: INVITE_LEAD_MINUTES }).toISO()!;

  const [responsesResult, reservationsResult] = await Promise.all([
    supabase
      .from("pre_session_survey_responses")
      .select(
        `
        id,
        reservation_id,
        session_start_at,
        condition_score,
        meal_status,
        intensity_preference,
        request_focus,
        concern,
        free_comment,
        created_at,
        trainers ( display_name ),
        stores ( name )
      `
      )
      .eq("member_id", memberId)
      .order("session_start_at", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(100),
    supabase
      .from("reservations")
      .select("id, start_at")
      .eq("member_id", memberId)
      .eq("status", "confirmed")
      .lte("start_at", inviteThreshold),
  ]);

  const { data, error } = responsesResult;
  if (error) {
    if (isTableMissing(error)) {
      return emptyMemberPreSessionSurveyData();
    }
    console.error("pre_session_survey_responses fetch failed", error);
    return emptyMemberPreSessionSurveyData();
  }

  const { data: reservations, error: reservationError } = reservationsResult;
  if (reservationError) {
    console.error("reservations fetch for pre-session invites failed", reservationError);
  }

  const pre_session_invite_by_date: Record<string, true> = {};
  const invitedReservationIds = new Set<string>();
  for (const reservation of (reservations ?? []) as ReservationRow[]) {
    invitedReservationIds.add(reservation.id);
    const date = sessionDateFromStartAt(reservation.start_at);
    if (date) pre_session_invite_by_date[date] = true;
  }

  const pre_session_by_date: Record<string, PreSessionSurveyForKarte> = {};
  for (const row of (data ?? []) as unknown as ResponseRow[]) {
    invitedReservationIds.add(row.reservation_id);
    const date = sessionDateFromStartAt(row.session_start_at);
    if (date) pre_session_invite_by_date[date] = true;
    if (pre_session_by_date[date]) continue;
    pre_session_by_date[date] = mapRow(row, date);
  }

  const latest_pre_session =
    Object.values(pre_session_by_date).sort(
      (a, b) => new Date(b.session_start_at).getTime() - new Date(a.session_start_at).getTime()
    )[0] ?? null;

  const invite_count = invitedReservationIds.size;
  const response_count = (data ?? []).length;
  const response_rate =
    invite_count > 0 ? Math.round((response_count / invite_count) * 1000) / 10 : null;

  return {
    pre_session_by_date,
    latest_pre_session,
    pre_session_stats: { invite_count, response_count, response_rate },
    pre_session_invite_by_date,
  };
}

function mapRow(row: ResponseRow, session_date: string): PreSessionSurveyForKarte {
  return {
    id: row.id,
    reservation_id: row.reservation_id,
    session_date,
    session_start_at: row.session_start_at,
    condition_score: row.condition_score,
    meal_status: row.meal_status,
    intensity_preference: row.intensity_preference,
    request_focus: row.request_focus,
    concern: row.concern,
    free_comment: row.free_comment,
    trainer_name: pickName(row.trainers, "display_name"),
    store_name: pickName(row.stores, "name"),
    created_at: row.created_at,
  };
}
