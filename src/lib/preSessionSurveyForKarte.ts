import { DateTime } from "luxon";
import { currentSurveyMonthKey, isIsoInSurveyMonth } from "@/lib/surveyMonth";
import { calcSurveyResponseRate } from "@/lib/surveyRateDisplay";
import {
  resolvePreSessionHearing,
  type PreSessionSurveyForKarte,
  type ReservationPreSessionHearing,
} from "./preSessionSurveyDisplay";
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
  session_format?: string | null;
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

export function isMissingSessionFormatColumn(error: { code?: string; message?: string } | null): boolean {
  const msg = String(error?.message ?? "");
  return /session_format/i.test(msg) && /does not exist|schema cache|Could not find|column/i.test(msg);
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

  const responseSelect = `
        id,
        reservation_id,
        session_start_at,
        condition_score,
        meal_status,
        intensity_preference,
        session_format,
        request_focus,
        concern,
        free_comment,
        created_at,
        trainers ( display_name ),
        stores ( name )
      `;
  const responseSelectLegacy = responseSelect.replace(/\n\s*session_format,/, "");

  const loadResponses = (select: string) =>
    supabase
      .from("pre_session_survey_responses")
      .select(select)
      .eq("member_id", memberId)
      .order("session_start_at", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(100);

  let responsesQuery = await loadResponses(responseSelect);
  if (responsesQuery.error && isMissingSessionFormatColumn(responsesQuery.error)) {
    responsesQuery = await loadResponses(responseSelectLegacy);
  }

  const reservationsResult = await supabase
    .from("reservations")
    .select("id, start_at")
    .eq("member_id", memberId)
    .eq("status", "confirmed")
    .lte("start_at", inviteThreshold);

  const { data, error } = responsesQuery;
  const responseRows = (data ?? []) as unknown as ResponseRow[];
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
  for (const row of responseRows) {
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

  const statsMonth = currentSurveyMonthKey();
  const monthlyInvitedIds = new Set<string>();
  for (const reservation of (reservations ?? []) as ReservationRow[]) {
    if (!isIsoInSurveyMonth(reservation.start_at, statsMonth)) continue;
    monthlyInvitedIds.add(reservation.id);
  }
  for (const row of responseRows) {
    if (!isIsoInSurveyMonth(row.session_start_at, statsMonth)) continue;
    monthlyInvitedIds.add(row.reservation_id);
  }

  const invite_count = monthlyInvitedIds.size;
  const response_count = responseRows.filter((row) =>
    isIsoInSurveyMonth(row.session_start_at, statsMonth)
  ).length;
  const response_rate = calcSurveyResponseRate(invite_count, response_count);

  return {
    pre_session_by_date,
    latest_pre_session,
    pre_session_stats: { invite_count, response_count, response_rate },
    pre_session_invite_by_date,
  };
}

function mapRow(row: ResponseRow, session_date: string): PreSessionSurveyForKarte {
  const hearing = resolvePreSessionHearing(row);
  return {
    id: row.id,
    reservation_id: row.reservation_id,
    session_date,
    session_start_at: row.session_start_at,
    condition_score: row.condition_score,
    meal_status: row.meal_status,
    intensity_preference: row.intensity_preference,
    session_format: hearing.session_format,
    request_focus: hearing.request_focus,
    concern: row.concern,
    free_comment: row.free_comment,
    trainer_name: pickName(row.trainers, "display_name"),
    store_name: pickName(row.stores, "name"),
    created_at: row.created_at,
  };
}

/** 予約一覧カード用。列未適用や取得失敗でも予約一覧自体は落とさない */
export async function fetchPreSessionHearingByReservationIds(
  supabase: SupabaseClient,
  reservationIds: string[]
): Promise<Map<string, ReservationPreSessionHearing>> {
  const map = new Map<string, ReservationPreSessionHearing>();
  const ids = Array.from(new Set(reservationIds.filter(Boolean)));
  if (ids.length === 0) return map;

  const chunkSize = 150;
  for (let i = 0; i < ids.length; i += chunkSize) {
    const chunk = ids.slice(i, i + chunkSize);
    const full = await supabase
      .from("pre_session_survey_responses")
      .select("reservation_id, request_focus, session_format")
      .in("reservation_id", chunk);

    if (full.error && isMissingSessionFormatColumn(full.error)) {
      const legacy = await supabase
        .from("pre_session_survey_responses")
        .select("reservation_id, request_focus")
        .in("reservation_id", chunk);
      if (legacy.error) {
        if (!isTableMissing(legacy.error)) {
          console.error("pre session hearing for reservations failed", legacy.error);
        }
        return map;
      }
      for (const row of legacy.data ?? []) {
        const hearing = resolvePreSessionHearing({ request_focus: row.request_focus });
        if (!hearing.session_format && !hearing.request_focus) continue;
        map.set(row.reservation_id, hearing);
      }
      continue;
    }

    if (full.error) {
      if (!isTableMissing(full.error)) {
        console.error("pre session hearing for reservations failed", full.error);
      }
      return map;
    }

    for (const row of full.data ?? []) {
      const hearing = resolvePreSessionHearing(row);
      if (!hearing.session_format && !hearing.request_focus) continue;
      map.set(row.reservation_id, hearing);
    }
  }
  return map;
}
