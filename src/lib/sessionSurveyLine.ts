import {
  lineAccessTokenForChannelKey,
  lineChannelKeyForStoreName,
  lineMemberProfileReachable,
  linePushTokenForMember,
  normalizeLineChannelKey,
  type LineChannelKey,
} from "@/lib/lineChannel";
import { sessionSurveyPageUrl, sessionSurveyPageUrlFromInviteToken } from "@/lib/sessionSurvey";
import { sessionSurveySignedQuery } from "@/lib/sessionSurveySigned";
import { fetchSessionSurveysForMember } from "@/lib/sessionSurveyForKarte";
import {
  formatMemberSurveyRateForLine,
  sessionSurveyLineButtonColor,
  type SurveyRateStats,
} from "@/lib/surveyRateDisplay";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadNextBookingOffer } from "@/lib/sessionSurveyNextBooking";
import { nextBookingPageUrlFromInviteToken, pushNextBookingInviteLine } from "@/lib/nextBookingLine";

export type SessionSurveyInviteParams = {
  member_id: string;
  trainer_id: string;
  store_id: string;
  session_date: string;
  client_note_id?: string | null;
};

export type SessionSurveyInviteRow = {
  id: string;
  member_id: string;
  trainer_id: string;
  store_id: string;
  session_date: string;
};

function isDupInviteError(err: { code?: string; message?: string } | null): boolean {
  const c = String(err?.code ?? "");
  const m = String(err?.message ?? "");
  return c === "23505" || m.includes("duplicate") || m.includes("unique");
}

function isSessionSurveyTableMissing(err: { code?: string; message?: string } | null): boolean {
  const c = String(err?.code ?? "");
  const m = String(err?.message ?? "");
  return c === "PGRST205" || m.includes("Could not find the table") || m.includes("session_survey");
}

/** 招待レコードを upsert（同日は1件） */
export async function upsertSessionSurveyInvite(
  supabase: SupabaseClient,
  params: SessionSurveyInviteParams
): Promise<SessionSurveyInviteRow | null> {
  const row = {
    member_id: params.member_id,
    trainer_id: params.trainer_id,
    store_id: params.store_id,
    session_date: params.session_date,
    client_note_id: params.client_note_id ?? null,
  };

  const { data: existing, error: selErr } = await supabase
    .from("session_survey_invites")
    .select("id, member_id, trainer_id, store_id, session_date")
    .eq("member_id", params.member_id)
    .eq("session_date", params.session_date)
    .maybeSingle();

  if (selErr && isSessionSurveyTableMissing(selErr)) {
    console.error("session_survey_invites table missing", selErr);
    return null;
  }

  if (existing?.id) {
    await supabase
      .from("session_survey_invites")
      .update({
        trainer_id: params.trainer_id,
        store_id: params.store_id,
        client_note_id: params.client_note_id ?? null,
      })
      .eq("id", existing.id);
    return existing as SessionSurveyInviteRow;
  }

  const { data, error } = await supabase
    .from("session_survey_invites")
    .insert(row)
    .select("id, member_id, trainer_id, store_id, session_date")
    .single();

  if (error) {
    if (isDupInviteError(error)) {
      const { data: again } = await supabase
        .from("session_survey_invites")
        .select("id, member_id, trainer_id, store_id, session_date")
        .eq("member_id", params.member_id)
        .eq("session_date", params.session_date)
        .maybeSingle();
      return (again as SessionSurveyInviteRow) ?? null;
    }
    console.error("session_survey_invite insert failed", error);
    return null;
  }
  return data as SessionSurveyInviteRow;
}

export function buildSessionSurveyFlexMessage(params: {
  trainerDisplayName: string;
  surveyUrl: string;
  memberStats?: SurveyRateStats | null;
}): object {
  const name = params.trainerDisplayName.trim() || "トレーナー";
  const intro = `担当トレーナーの${name}です。\n本日のセッションはいかがでしたでしょうか？\n次回のセッションに活かすほか、トレーナーの評価にも反映されます。\nご回答いただくと、トレーナーから返信が届く場合もあります。`;
  const rateText = params.memberStats ? formatMemberSurveyRateForLine(params.memberStats) : null;
  const buttonColor = sessionSurveyLineButtonColor(
    params.memberStats ?? { invite_count: 0, response_count: 0, response_rate: null }
  );

  const bodyContents: object[] = [
    {
      type: "text",
      text: "セッション後アンケート",
      weight: "bold",
      size: "lg",
      color: "#1e293b",
    },
    {
      type: "text",
      text: intro,
      wrap: true,
      size: "sm",
      color: "#334155",
    },
  ];

  if (rateText) {
    bodyContents.push({
      type: "text",
      text: rateText,
      wrap: true,
      size: "sm",
      weight: "bold",
      color: buttonColor,
    });
  }

  bodyContents.push({
    type: "button",
    style: "primary",
    color: buttonColor,
    height: "sm",
    action: {
      type: "uri",
      label: "アンケートに回答する",
      uri: params.surveyUrl,
    },
  });

  return {
    type: "flex",
    altText: `担当トレーナーの${name}です。セッション後アンケートのご協力をお願いします`,
    contents: {
      type: "bubble",
      size: "mega",
      body: {
        type: "box",
        layout: "vertical",
        spacing: "md",
        contents: bodyContents,
      },
    },
  };
}

async function linePushMessages(token: string, to: string, messages: object[]): Promise<boolean> {
  const res = await fetch("https://api.line.me/v2/bot/message/push", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ to, messages }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.error("LINE push failed", { status: res.status, body });
    return false;
  }
  return true;
}

export async function pushSessionSurveyInviteLine(params: {
  lineUserId: string;
  memberCode?: string | null;
  lineChannelKey?: string | null;
  storeName: string;
  trainerDisplayName: string;
  /** invite UUID またはフル survey URL */
  inviteToken: string;
  memberStats?: SurveyRateStats | null;
}): Promise<boolean> {
  const surveyUrl = params.inviteToken.startsWith("http")
    ? params.inviteToken
    : params.inviteToken.includes("=")
      ? sessionSurveyPageUrl(params.inviteToken)
      : sessionSurveyPageUrlFromInviteToken(params.inviteToken);
  const flex = buildSessionSurveyFlexMessage({
    trainerDisplayName: params.trainerDisplayName,
    surveyUrl,
    memberStats: params.memberStats,
  });

  const line = linePushTokenForMember({
    lineChannelKey: normalizeLineChannelKey(params.lineChannelKey),
    memberCode: params.memberCode,
    fallbackStoreName: params.storeName,
  });

  const tried = new Set<string>();
  const tokens: Array<{ token: string; channelKey: LineChannelKey | null }> = [];

  if (line.token) tokens.push({ token: line.token, channelKey: line.channelKey });

  const storeKey = lineChannelKeyForStoreName(params.storeName);
  const storeToken = storeKey ? lineAccessTokenForChannelKey(storeKey) : null;
  if (storeToken) tokens.push({ token: storeToken, channelKey: storeKey });

  if (!normalizeLineChannelKey(params.lineChannelKey)) {
    const defaultToken = lineAccessTokenForChannelKey("default");
    if (defaultToken) tokens.push({ token: defaultToken, channelKey: "default" });
  }

  for (const { token, channelKey } of tokens) {
    if (tried.has(token)) continue;
    tried.add(token);
    const reachable = await lineMemberProfileReachable(token, params.lineUserId);
    if (!reachable) continue;
    const sent = await linePushMessages(token, params.lineUserId, [flex]);
    if (sent) return true;
  }

  console.error("LINE token missing or push failed for session survey", {
    storeName: params.storeName,
    memberCode: params.memberCode,
    lineChannelSource: line.source,
    lineChannelKey: line.channelKey,
  });
  return false;
}

function surveyUrlForInvite(
  invite: SessionSurveyInviteRow | null,
  params: SessionSurveyInviteParams
): string {
  if (invite?.id) return sessionSurveyPageUrlFromInviteToken(invite.id);
  const q = sessionSurveySignedQuery({
    member_id: params.member_id,
    trainer_id: params.trainer_id,
    store_id: params.store_id,
    session_date: params.session_date,
    client_note_id: params.client_note_id ?? null,
  });
  return q ? sessionSurveyPageUrl(q) : "";
}

export async function sendSessionSurveyAfterClientNote(
  supabase: SupabaseClient,
  params: SessionSurveyInviteParams & {
    line_user_id: string;
    member_code?: string | null;
    line_channel_key?: string | null;
    store_name: string;
    trainer_display_name: string;
  }
): Promise<{ sent: boolean; invite_id?: string; survey_url?: string; mode?: string; next_booking_sent?: boolean }> {
  const invite = await upsertSessionSurveyInvite(supabase, params);
  const surveyUrl = surveyUrlForInvite(invite, params);
  if (!surveyUrl) return { sent: false };

  if (invite?.id) {
    const { data: responded } = await supabase
      .from("session_survey_responses")
      .select("id")
      .eq("invite_id", invite.id)
      .maybeSingle();
    if (responded?.id) return { sent: false, invite_id: invite.id, survey_url: surveyUrl };
  }

  const { survey_stats: memberStats } = await fetchSessionSurveysForMember(supabase, params.member_id);

  const sent = await pushSessionSurveyInviteLine({
    lineUserId: params.line_user_id,
    memberCode: params.member_code,
    lineChannelKey: params.line_channel_key,
    storeName: params.store_name,
    trainerDisplayName: params.trainer_display_name,
    inviteToken: surveyUrl,
    memberStats,
  });

  if (sent && invite?.id) {
    await supabase
      .from("session_survey_invites")
      .update({ line_sent_at: new Date().toISOString() })
      .eq("id", invite.id);
  }

  let next_booking_sent = false;
  if (invite?.id) {
    try {
      next_booking_sent = await sendNextBookingLineForInvite(supabase, {
        inviteId: invite.id,
        memberId: params.member_id,
        storeId: params.store_id,
        sessionDate: params.session_date,
        lineUserId: params.line_user_id,
        memberCode: params.member_code,
        lineChannelKey: params.line_channel_key,
        storeName: params.store_name,
      });
    } catch (e) {
      console.error("next booking LINE failed", e);
    }
  }

  return {
    sent,
    invite_id: invite?.id,
    survey_url: surveyUrl,
    mode: invite?.id ? "invite" : "signed",
    next_booking_sent,
  };
}

export async function sendNextBookingLineForInvite(
  supabase: SupabaseClient,
  params: {
    inviteId: string;
    memberId: string;
    storeId: string;
    sessionDate: string;
    lineUserId: string;
    memberCode?: string | null;
    lineChannelKey?: string | null;
    storeName: string;
  }
): Promise<boolean> {
  const offer = await loadNextBookingOffer(supabase, {
    memberId: params.memberId,
    storeId: params.storeId,
    sessionDate: params.sessionDate,
  });
  if (!offer.eligible) return false;
  return pushNextBookingInviteLine({
    lineUserId: params.lineUserId,
    memberCode: params.memberCode,
    lineChannelKey: params.lineChannelKey,
    storeName: params.storeName,
    bookingUrl: nextBookingPageUrlFromInviteToken(params.inviteId),
    offer,
  });
}
