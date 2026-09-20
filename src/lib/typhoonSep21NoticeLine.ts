import type { SupabaseClient } from "@supabase/supabase-js";
import { linePushTokenForMemberRow } from "@/lib/lineChannel";
import { pushLineTextAsChunks } from "@/lib/lineMessagingPush";

export const TYPHOON_SEP21_NOTICE_LINE_MESSAGE = `【台風接近に伴う営業について】

いつもAbodyをご利用いただきありがとうございます。

明日9月21日にご予約いただいている会員様へ、台風接近に伴う営業についてご案内です。

現時点では通常通り営業を予定しておりますが、
今後の天候状況や交通機関への影響によっては、お客様・トレーナーの安全を最優先に営業時間の変更または臨時休業とさせていただく可能性がございます。

営業内容に変更がある場合は、改めて公式LINEよりご連絡いたします。
また、通常営業の場合でも雨風が強くなる可能性がございますので、決して無理をせず、安全を最優先にご判断ください。

ご来店予定の方は、天候や交通状況をご確認のうえ、お気をつけてお越しください。
ご不便をおかけする可能性がございますが、何卒ご理解・ご協力のほどよろしくお願いいたします。

Abody`;

export async function sendTyphoonSep21NoticeLine(
  supabase: SupabaseClient,
  params: { memberCode: string; text?: string; dryRun?: boolean },
) {
  const memberCode = params.memberCode.trim().toUpperCase();
  const text = params.text?.trim() || TYPHOON_SEP21_NOTICE_LINE_MESSAGE;

  const { data: member, error } = await supabase
    .from("members")
    .select("id, member_code, name, display_name, line_user_id, line_channel_key")
    .eq("member_code", memberCode)
    .maybeSingle();
  if (error) throw error;
  if (!member) return { member_code: memberCode, ok: false, error: "member_not_found" };
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

  if (params.dryRun) {
    return {
      member_code: memberCode,
      ok: true,
      dry_run: true,
      name: member.display_name || member.name,
      line_user_id: member.line_user_id,
      channel: line.channelKey,
      source: line.source,
    };
  }

  const sent = (await pushLineTextAsChunks(line.token, member.line_user_id, text)).ok;
  return {
    member_code: memberCode,
    ok: sent,
    name: member.display_name || member.name,
    channel: line.channelKey,
    source: line.source,
    error: sent ? undefined : "line_push_failed",
  };
}
