import { DateTime } from "luxon";
import { linePushTokenForMemberRow } from "@/lib/lineChannel";
import { pushLineTextAsChunks } from "@/lib/lineMessagingPush";
import { PRE_SESSION_ACCENT_COLOR } from "@/lib/preSessionSurvey";
import { preSessionSurveySignedQuery } from "@/lib/preSessionSurveySigned";
import type { SupabaseClient } from "@supabase/supabase-js";

const TZ = "Asia/Tokyo";

export function preSessionSurveyPageUrl(appUrl: string, params: { reservation_id: string; member_id: string }): string {
  const q = preSessionSurveySignedQuery(params);
  const base = appUrl.replace(/\/$/, "");
  return q ? `${base}/pre-session-survey?${q}` : `${base}/pre-session-survey`;
}

export function buildPreSessionReminderText(params: {
  startAtUtcIso: string;
  storeName: string;
  trainerName: string;
  sessionType: string | null;
  onShiftTrainerNames?: string | null;
}): string {
  const start = DateTime.fromISO(params.startAtUtcIso).setZone(TZ);
  const formattedDate = start.setLocale("ja").toFormat("M月d日（ccc）");
  const formattedTime = start.toFormat("HH:mm");
  const sessionLabel = params.sessionType === "online" ? "オンライン" : "店舗";
  const trainerLine = params.onShiftTrainerNames
    ? `出勤トレーナー：${params.onShiftTrainerNames}`
    : `担当：${params.trainerName}`;
  return `【ご予約リマインド】
本日 ${formattedDate} ${formattedTime} からセッション予定です。

店舗：${params.storeName}
${trainerLine}
セッション種別：${sessionLabel}

お気をつけてお越しください！`.trim();
}

export function buildPreSessionSurveyFlex(surveyUrl: string) {
  const intro =
    "本日の体調やご希望を事前に教えてください。\nトレーナーがセッション内容を準備します。";
  return {
    type: "flex" as const,
    altText: "セッション前ヒアリングのご協力をお願いします",
    contents: {
      type: "bubble" as const,
      size: "mega" as const,
      body: {
        type: "box" as const,
        layout: "vertical" as const,
        spacing: "md" as const,
        contents: [
          { type: "text" as const, text: "セッション前ヒアリング", weight: "bold" as const, size: "lg" as const, color: "#1e293b" },
          { type: "text" as const, text: intro, wrap: true, size: "sm" as const, color: "#334155" },
          {
            type: "button" as const,
            style: "primary" as const,
            color: PRE_SESSION_ACCENT_COLOR,
            height: "sm" as const,
            action: { type: "uri" as const, label: "ヒアリングに回答する", uri: surveyUrl },
          },
        ],
      },
    },
  };
}

async function pushFlex(token: string, toUserId: string, message: ReturnType<typeof buildPreSessionSurveyFlex>) {
  const res = await fetch("https://api.line.me/v2/bot/message/push", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ to: toUserId, messages: [message] }),
  });
  const body = await res.text().catch(() => "");
  return { ok: res.ok, status: res.status, body };
}

export async function pushPreSessionReminderMessages(params: {
  token: string;
  lineUserId: string;
  reminderText: string;
  surveyUrl: string;
}): Promise<{ textOk: boolean; flexOk: boolean; flexDetail?: string }> {
  const textOk = (await pushLineTextAsChunks(params.token, params.lineUserId, params.reminderText)).ok;
  if (!textOk) return { textOk: false, flexOk: false };
  const flexRes = await pushFlex(params.token, params.lineUserId, buildPreSessionSurveyFlex(params.surveyUrl));
  return { textOk: true, flexOk: flexRes.ok, flexDetail: flexRes.ok ? undefined : flexRes.body };
}

export async function sendPreSessionReminderTest(
  supabase: SupabaseClient,
  params: { memberCode: string; appUrl: string; reservationId?: string }
): Promise<Record<string, unknown>> {
  const memberCode = params.memberCode.trim().toUpperCase();
  const { data: member, error: mErr } = await supabase
    .from("members")
    .select("id, member_code, name, line_user_id, line_channel_key, is_active")
    .eq("member_code", memberCode)
    .maybeSingle();

  if (mErr) return { member_code: memberCode, sent: false, error: "member_fetch_failed", detail: mErr.message };
  if (!member?.is_active || !member.line_user_id) {
    return { member_code: memberCode, sent: false, error: "member_or_line_missing" };
  }

  const now = DateTime.now().setZone(TZ);
  const reservationSelect = "id, start_at, session_type, stores(name), trainers(display_name)";
  type ReservationPick = {
    id: string;
    start_at: string;
    session_type: string | null;
    stores?: { name?: string } | { name?: string }[] | null;
    trainers?: { display_name?: string } | { display_name?: string }[] | null;
  };
  let lookup = "upcoming";
  let lookupError: string | null = null;
  let reservation: ReservationPick | null = null;

  if (params.reservationId) {
    lookup = "specified";
    const specified = await supabase
      .from("reservations")
      .select(reservationSelect)
      .eq("id", params.reservationId)
      .eq("member_id", member.id)
      .maybeSingle();
    if (specified.error) lookupError = specified.error.message;
    reservation = (specified.data as ReservationPick | null) ?? null;
  }

  if (!reservation?.id) {
    lookup = "upcoming";
    const upcoming = await supabase
      .from("reservations")
      .select(reservationSelect)
      .eq("member_id", member.id)
      .eq("status", "confirmed")
      .gte("start_at", now.toISO())
      .order("start_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (upcoming.error) lookupError = upcoming.error.message;
    reservation = (upcoming.data as ReservationPick | null) ?? null;
  }

  if (!reservation?.id) {
    lookup = "recent";
    const recentStart = now.minus({ hours: 36 }).toUTC().toISO();
    const recent = await supabase
      .from("reservations")
      .select(reservationSelect)
      .eq("member_id", member.id)
      .eq("status", "confirmed")
      .gte("start_at", recentStart)
      .order("start_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (recent.error) lookupError = recent.error.message;
    reservation = (recent.data as ReservationPick | null) ?? null;
  }

  let reservationId: string;
  let startAt: string;
  let storeName: string;
  let trainerName: string;
  let sessionType: string | null;

  if (reservation?.id) {
    reservationId = reservation.id;
    startAt = reservation.start_at;
    const storeRel = Array.isArray(reservation.stores) ? reservation.stores[0] : reservation.stores;
    const trainerRel = Array.isArray(reservation.trainers) ? reservation.trainers[0] : reservation.trainers;
    storeName = storeRel?.name ?? "恵比寿";
    trainerName = trainerRel?.display_name ?? "担当トレーナー";
    sessionType = reservation.session_type;
  } else {
    return {
      member_code: memberCode,
      sent: false,
      error: "reservation_not_found",
      lookup,
      lookup_error: lookupError,
    };
  }

  const line = linePushTokenForMemberRow(member, storeName);
  if (!line.token) {
    return { member_code: memberCode, sent: false, error: "line_token_missing", line_source: line.source };
  }

  const reminderText = buildPreSessionReminderText({
    startAtUtcIso: startAt,
    storeName,
    trainerName,
    sessionType,
  });
  const surveyUrl = preSessionSurveyPageUrl(params.appUrl, {
    reservation_id: reservationId,
    member_id: member.id,
  });
  const flex = buildPreSessionSurveyFlex(surveyUrl);

  const textOk = (await pushLineTextAsChunks(line.token, String(member.line_user_id), reminderText)).ok;
  if (!textOk) {
    return { member_code: memberCode, sent: false, error: "line_text_push_failed", survey_url: surveyUrl };
  }

  const flexRes = await pushFlex(line.token, String(member.line_user_id), flex);
  if (!flexRes.ok) {
    return {
      member_code: memberCode,
      sent: false,
      error: "line_flex_push_failed",
      detail: flexRes.body,
      survey_url: surveyUrl,
    };
  }

  return {
    member_code: memberCode,
    sent: true,
    reservation_id: reservationId,
    store_name: storeName,
    trainer_name: trainerName,
    start_at: startAt,
    survey_url: surveyUrl,
    line_source: line.source,
    lookup,
    lookup_error: lookupError,
  };
}
