import type { SupabaseClient } from "@supabase/supabase-js";
import { linePushTokenForMemberRow } from "@/lib/lineChannel";
import { chunkLinePushText } from "@/lib/lineMessagingPush";

export const SEP_LOW_BOOKING_MOTIVATION_MESSAGE = `こんにちは！Abodyです😊

今月まだご予約数が少ないため個別でご連絡させていただきました！

お仕事や予定が忙しく、なかなかトレーニングの時間が取れないかもですが今月はまず【16日までに5回の来店】を目標にしてみましょう🔥
「今日はトレーニングする元気がない…」という日は、ストレッチだけでも全然OKです！
30分だけでも身体を動かしたり整えるだけで気分転換にもなりますし体の変化もでてきます！

60分併用しながら5コマ消化することもできますので
まずは予約メニューから2コマご予約ください！

もし予約取れない等でお困りであれば、公式LINEにてお気軽に相談してください☺️

今月もトレーナー一同しっかりサポートします💪
ご予約お待ちしております！`;

/** 9月合計0〜2回・在籍のみ・手動除外後（2026-09-09） */
export const SEP_LOW_BOOKING_MOTIVATION_MEMBER_CODES = [
  "UEN012",
  "SAK036",
  "SHI001",
  "SAK053",
  "EBI027",
  "FUK001",
  "SAK011",
  "SAK047",
  "SAK050",
  "SHI003",
  "SHI012",
  "UEN014",
  "UEN022",
  "UEN024",
  "UEN042",
  "UEN050",
  "UEN057",
  "ZAI001",
  "SAK009",
  "EBI009",
  "UEN039",
  "EBI002",
  "EBI026",
  "FUK012",
  "UEN031",
  "UEN053",
  "SAK061",
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
