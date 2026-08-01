import type { SupabaseClient } from "@supabase/supabase-js";
import { linePushTokenForMemberRow } from "@/lib/lineChannel";

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

/**
 * 月次レポートを LINE で送る（テキスト + 画像最大4枚 + 任意PDF）。
 * 1回の push は最大5メッセージなので、テキスト+PDF+画像3、残り画像は2通目。
 */
export async function sendMonthlyProgressLine(
  supabase: SupabaseClient,
  params: {
    memberCode: string;
    text: string;
    imageUrls: string[];
    pdfUrl?: string | null;
    pdfFileName?: string | null;
    dryRun?: boolean;
  }
) {
  const memberCode = params.memberCode.trim().toUpperCase();
  const { data: member, error } = await supabase
    .from("members")
    .select("id, member_code, name, display_name, line_user_id, line_channel_key, is_active, membership_status")
    .eq("member_code", memberCode)
    .maybeSingle();
  if (error) throw error;
  if (!member) return { member_code: memberCode, ok: false, error: "member_not_found" };

  // 退会のみ除外（休会にも月次レポートを送る）
  const membershipStatus = String(member.membership_status ?? "").toLowerCase();
  if (membershipStatus === "withdrawn") {
    return { member_code: memberCode, ok: false, error: "withdrawn" };
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
      image_count: params.imageUrls.length,
      has_pdf: Boolean(params.pdfUrl),
      channel: line.channelKey,
      source: line.source,
    };
  }

  const batches: Array<Array<Record<string, unknown>>> = [];
  let current: Array<Record<string, unknown>> = [{ type: "text", text: params.text }];

  // NOTE: LINE Messaging API の file タイプはアカウントにより不可。
  // PDFはテキスト内のURLで渡す（pdfUrl は呼び出し側で本文へ埋め込み）。

  for (const imageUrl of params.imageUrls) {
    const imageMsg = {
      type: "image",
      originalContentUrl: imageUrl,
      previewImageUrl: imageUrl,
    };
    if (current.length >= 5) {
      batches.push(current);
      current = [imageMsg];
    } else {
      current.push(imageMsg);
    }
  }
  if (current.length) batches.push(current);

  const pushResults = [];
  for (const messages of batches) {
    const pushed = await pushMessages({
      token: line.token,
      toUserId: member.line_user_id,
      messages,
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
    channel: line.channelKey,
    source: line.source,
    batches: batches.length,
    status: last?.status,
    error: ok ? undefined : "line_push_failed",
    detail: ok ? undefined : last?.body,
  };
}
