import type { SupabaseClient } from "@supabase/supabase-js";
import { linePushTokenForMemberRow } from "@/lib/lineChannel";
import { pushLineTextAsChunks } from "@/lib/lineMessagingPush";

export const JUNE_LOW_BOOKING_LINE_MESSAGE = `お世話になっております！
Abodyです😊


6月のご予約数が少なかったため、個別でご連絡させていただきました。

まずは7月分のご予約を先に8コマお取りいただき、その後ご都合が合いそうでしたら追加でご予約いただけたら嬉しいです！

目標達成に向けて、7月は10回以上のセッションを目標に進めていきたいと考えております💪
お忙しくてなかなか予約が取れない場合は60分でのセッションや体調が悪い場合はストレッチや軽めのトレーニングで調整させていただきますので、気分転換がてら遊びにくる感覚でも大丈夫です！



人気の時間帯は早めに埋まりやすいため、ご予定がお決まりでしたらお早めのご予約をお願いいたします🙇‍♂️


7月もしっかりサポートさせていただきますので、一緒に頑張っていきましょう😊

ご不明点ございましたらお気軽にご連絡ください！
引き続きよろしくお願いいたいします。`;

export async function sendJuneLowBookingLine(
  supabase: SupabaseClient,
  params: { memberCode: string; dryRun?: boolean }
) {
  const memberCode = params.memberCode.trim().toUpperCase();
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

  const sent = (await pushLineTextAsChunks(line.token, member.line_user_id, JUNE_LOW_BOOKING_LINE_MESSAGE)).ok;
  return {
    member_code: memberCode,
    ok: sent,
    name: member.display_name || member.name,
    channel: line.channelKey,
    source: line.source,
    error: sent ? undefined : "line_push_failed",
  };
}
