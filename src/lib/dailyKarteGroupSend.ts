import { lineAccessTokenForChannelKey } from "@/lib/lineChannel";
import { chunkLinePushText, pushLineTextChunks } from "@/lib/lineMessagingPush";

/** 試し送信で届いたトレーナーのグループ。環境変数があればそちらを使う。 */
const DEFAULT_TRAINER_GROUP_ID = "Cbe51152d1c1f443040a4d23e643fa97e";

export function karteReportGroupId(): string {
  return process.env.LINE_KARTE_REPORT_GROUP_ID?.trim() || DEFAULT_TRAINER_GROUP_ID;
}

/** カルテ日報の本文を、福岡公式アカウントからトレーナーのグループへ送る。 */
export async function pushKarteReportToTrainerGroup(text: string): Promise<{ ok: boolean; status?: number }> {
  const token = lineAccessTokenForChannelKey("fukuoka");
  const groupId = karteReportGroupId();
  if (!token || !groupId) {
    console.error("[karte-group] missing token or group id");
    return { ok: false };
  }
  const chunks = chunkLinePushText(text);
  const results = await pushLineTextChunks({ token, toUserId: groupId, chunks });
  const ok = results.length > 0 && results.every((result) => result.ok);
  if (!ok) {
    const last = results[results.length - 1];
    console.error("[karte-group] push failed", { status: last?.status, body: last?.body?.slice(0, 300) });
    return { ok: false, status: last?.status };
  }
  return { ok: true, status: results[results.length - 1]?.status };
}
