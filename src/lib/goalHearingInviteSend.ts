import type { SupabaseClient } from "@supabase/supabase-js";
import { buildGoalHearingInviteMessages } from "@/lib/goalHearingLine";
import { goalHearingPageUrl, signGoalHearingPayload } from "@/lib/goalHearingSigned";
import { linePushTokenForMemberRow } from "@/lib/lineChannel";

const DEFAULT_APP_URL = "https://abody-gymos.vercel.app";
const INVITE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export type GoalHearingInviteMember = {
  id: string;
  member_code: string;
  name?: string | null;
  line_user_id: string | null;
  line_channel_key?: string | null;
  store_id?: string | null;
  is_active?: boolean | null;
};

export type SendGoalHearingInviteResult = {
  member_code?: string;
  sent: boolean;
  dry_run?: boolean;
  skipped?: boolean;
  error?: string;
  detail?: string;
  status?: number;
  survey_url?: string;
  invite_id?: string | null;
  channelKey?: string | null;
};

function resolveAppUrl() {
  return process.env.NEXT_PUBLIC_APP_URL?.trim()?.replace(/\/$/, "") || DEFAULT_APP_URL;
}

async function pushMessages(
  token: string,
  toUserId: string,
  messages: ReturnType<typeof buildGoalHearingInviteMessages>
) {
  const res = await fetch("https://api.line.me/v2/bot/message/push", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ to: toUserId, messages }),
  });
  const body = await res.text().catch(() => "");
  return { ok: res.ok, status: res.status, body };
}

export async function sendGoalHearingInviteForMember(
  // webhook / admin 双方から呼べるよう緩く受ける
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any>,
  opts: {
    memberCode?: string;
    memberId?: string;
    member?: GoalHearingInviteMember | null;
    dryRun?: boolean;
    /** 直近この日数以内に招待送信済みならスキップ（既定: なし） */
    skipIfRecentlySentDays?: number;
  }
): Promise<SendGoalHearingInviteResult> {
  const dryRun = Boolean(opts.dryRun);
  let member = opts.member ?? null;

  if (!member) {
    let q = supabase
      .from("members")
      .select("id, member_code, name, line_user_id, line_channel_key, store_id, is_active");
    if (opts.memberId) q = q.eq("id", opts.memberId);
    else if (opts.memberCode) q = q.eq("member_code", opts.memberCode.trim().toUpperCase());
    else return { sent: false, error: "member_ref_missing" };

    const { data, error } = await q.maybeSingle();
    if (error) return { sent: false, error: "member_fetch_failed", detail: error.message };
    member = data as GoalHearingInviteMember | null;
  }

  if (!member) return { sent: false, error: "member_not_found" };
  const memberCode = String(member.member_code ?? "").toUpperCase();
  if (member.is_active === false) {
    return { member_code: memberCode, sent: false, error: "member_inactive" };
  }
  if (!member.line_user_id) {
    return { member_code: memberCode, sent: false, error: "member_or_line_missing" };
  }

  if (opts.skipIfRecentlySentDays && opts.skipIfRecentlySentDays > 0) {
    const since = new Date(Date.now() - opts.skipIfRecentlySentDays * 24 * 60 * 60 * 1000).toISOString();
    const { data: recent } = await supabase
      .from("goal_hearing_invites")
      .select("id")
      .eq("member_id", member.id)
      .not("line_sent_at", "is", null)
      .gte("line_sent_at", since)
      .limit(1)
      .maybeSingle();
    if (recent?.id) {
      return {
        member_code: memberCode,
        sent: false,
        skipped: true,
        error: "recently_sent",
        invite_id: recent.id,
      };
    }
  }

  let inviteId: string | null = null;
  if (member.store_id) {
    const expiresAt = new Date(Date.now() + INVITE_TTL_MS).toISOString();
    const { data: invite } = await supabase
      .from("goal_hearing_invites")
      .insert({
        member_id: member.id,
        store_id: member.store_id,
        expires_at: expiresAt,
      })
      .select("id")
      .maybeSingle();
    inviteId = invite?.id ?? null;
  }

  const signed = signGoalHearingPayload({ member_id: member.id, invite_id: inviteId });
  if (!signed) {
    return { member_code: memberCode, sent: false, error: "sign_secret_missing", invite_id: inviteId };
  }

  const appUrl = resolveAppUrl();
  const surveyUrl = goalHearingPageUrl(appUrl, { member_id: member.id, invite_id: inviteId });
  const { token, channelKey } = linePushTokenForMemberRow(member);
  if (!token) {
    return {
      member_code: memberCode,
      sent: false,
      error: "line_token_missing",
      channelKey,
      survey_url: surveyUrl,
      invite_id: inviteId,
    };
  }

  if (dryRun) {
    return {
      member_code: memberCode,
      sent: false,
      dry_run: true,
      survey_url: surveyUrl,
      invite_id: inviteId,
      channelKey,
    };
  }

  const push = await pushMessages(token, member.line_user_id, buildGoalHearingInviteMessages(surveyUrl));
  if (push.ok && inviteId) {
    await supabase
      .from("goal_hearing_invites")
      .update({ line_sent_at: new Date().toISOString() })
      .eq("id", inviteId);
  }

  return {
    member_code: memberCode,
    sent: push.ok,
    status: push.status,
    survey_url: surveyUrl,
    invite_id: inviteId,
    channelKey,
    detail: push.ok ? undefined : push.body,
    error: push.ok ? undefined : "line_push_failed",
  };
}
