import type { SupabaseClient } from "@supabase/supabase-js";
import { linePushTokenForMemberRow } from "@/lib/lineChannel";
import { chunkLinePushText } from "@/lib/lineMessagingPush";

export const SEP_LOW_BOOKING_MOTIVATION_MESSAGE = `こんにちは！Abodyです😊

9月も折り返しですが、最近身体動かせていますか？

お仕事や予定が忙しく、「行こうと思ってたけど、気づいたら間が空いてしまった…」
という方もいると思います。

そんな時はまず30分だけでも大丈夫です💪

トレーニングは勿論「今日は疲れてるな…」という日はストレッチだけでもOKです！

まずは次の1回から！
予約メニューを開いて、空いている日をチェックしてみてください😊

僕たちも一緒に頑張りますので、今月後半またペースを上げていきましょう💪
ご予約お待ちしてます！`;

/** 9月前半後半0〜5・合計0〜5・9月入会除外・手動10名除外後（2026-09-16） */
export const SEP_LOW_BOOKING_MOTIVATION_MEMBER_CODES = [
  "FUK001",
  "SAK035",
  "SAK050",
  "SHI001",
  "SHI003",
  "SHI012",
  "UEN050",
  "EBI027",
  "SAK009",
  "EBI026",
  "EBI020",
  "UEN053",
  "SAK044",
  "FUK012",
  "UEN031",
  "FUK011",
  "UEN039",
  "UEN048",
  "SAK051",
  "SHI011",
  "SHI019",
  "SHI024",
  "UEN045",
  "SAK002",
  "SAK017",
  "SAK043",
  "SAK036",
] as const;

async function pushMessages(params: {
  token: string;
  toUserId: string;
  messages: Array<Record<string, unknown>>;
}): Promise<{ ok: boolean; status: number; body: string }> {
  const res = await fetch("https://api.line.me/v2/bot/message/push", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${params.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ to: params.toUserId, messages: params.messages }),
  });
  const body = await res.text().catch(() => "");
  return { ok: res.ok, status: res.status, body };
}

export async function sendSepLowBookingMotivationLine(
  supabase: SupabaseClient,
  params: {
    memberCode: string;
    text?: string;
    videoUrl?: string | null;
    previewImageUrl?: string | null;
    dryRun?: boolean;
  },
) {
  const memberCode = params.memberCode.trim().toUpperCase();
  const text = (params.text ?? SEP_LOW_BOOKING_MOTIVATION_MESSAGE).trim();
  const videoUrl = params.videoUrl?.trim() || null;
  const previewImageUrl = params.previewImageUrl?.trim() || null;

  if ((videoUrl && !previewImageUrl) || (!videoUrl && previewImageUrl)) {
    return {
      member_code: memberCode,
      ok: false,
      error: "video_and_preview_required_together",
    };
  }

  const { data: member, error } = await supabase
    .from("members")
    .select("id, member_code, name, display_name, line_user_id, line_channel_key, is_active, membership_status")
    .eq("member_code", memberCode)
    .maybeSingle();
  if (error) throw error;
  if (!member) return { member_code: memberCode, ok: false, error: "member_not_found" };

  const membershipStatus = String(member.membership_status ?? "").toLowerCase();
  if (membershipStatus === "withdrawn" || membershipStatus === "hiatus") {
    return { member_code: memberCode, ok: false, error: membershipStatus };
  }
  if (!member.line_user_id) return { member_code: memberCode, ok: false, error: "no_line_user_id" };

  const line = linePushTokenForMemberRow(member);
  if (!line.token) {
    return {
      member_code: memberCode,
      ok: false,
      error: "missing_line_token",
      channel: line.channelKey,
      source: line.source,
    };
  }

  const name = member.display_name || member.name;
  if (params.dryRun) {
    return {
      member_code: memberCode,
      ok: true,
      dry_run: true,
      name,
      has_video: Boolean(videoUrl),
      channel: line.channelKey,
      source: line.source,
    };
  }

  if (!videoUrl || !previewImageUrl) {
    return { member_code: memberCode, ok: false, error: "video_url_required_for_send" };
  }

  const messages: Array<Record<string, unknown>> = [];
  for (const chunk of chunkLinePushText(text)) {
    messages.push({ type: "text", text: chunk });
  }
  messages.push({
    type: "video",
    originalContentUrl: videoUrl,
    previewImageUrl,
  });

  const batches: Array<Array<Record<string, unknown>>> = [];
  let current: Array<Record<string, unknown>> = [];
  for (const msg of messages) {
    if (current.length >= 5) {
      batches.push(current);
      current = [msg];
    } else {
      current.push(msg);
    }
  }
  if (current.length) batches.push(current);

  const pushResults = [];
  for (const batch of batches) {
    const pushed = await pushMessages({
      token: line.token,
      toUserId: member.line_user_id,
      messages: batch,
    });
    pushResults.push(pushed);
    if (!pushed.ok) break;
    await new Promise((r) => setTimeout(r, 250));
  }

  const ok = pushResults.length > 0 && pushResults.every((r) => r.ok);
  const last = pushResults[pushResults.length - 1];
  return {
    member_code: memberCode,
    ok,
    name,
    has_video: true,
    channel: line.channelKey,
    source: line.source,
    batches: batches.length,
    status: last?.status,
    error: ok ? undefined : "line_push_failed",
    detail: ok ? undefined : last?.body,
  };
}
