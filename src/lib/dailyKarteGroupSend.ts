import { DateTime } from "luxon";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  claimDailyKarteReport,
  formatDailyKarteReport,
  loadDailyKarteReport,
  releaseDailyKarteReport,
} from "@/lib/dailyKarteReport";
import { lineAccessTokenForChannelKey } from "@/lib/lineChannel";
import { chunkLinePushText, pushLineTextChunks } from "@/lib/lineMessagingPush";

const TZ = "Asia/Tokyo";
/** 本送信（当日の日報）とは別の一度きりロック。1970-01-01 は実在の日報日ではない。 */
const ONCE_LOCK_DATE = "1970-01-01";

/**
 * 福岡公式アカウントが入ったグループへ、昨日のカルテ日報を一度だけ送る。
 * 招待時のグループIDは保存されていないため、次のグループイベントで送る。
 */
export async function sendYesterdayKarteReportToFukuokaGroup(
  supabase: SupabaseClient<any>,
  groupId: string
): Promise<void> {
  const token = lineAccessTokenForChannelKey("fukuoka");
  if (!token) {
    console.error("[karte-group] fukuoka token missing");
    return;
  }

  const claim = await claimDailyKarteReport(supabase, ONCE_LOCK_DATE);
  if (claim === "already") return;

  const now = DateTime.now().setZone(TZ);
  const dateYmd = now.minus({ days: 1 }).toISODate();
  if (!dateYmd) {
    if (claim === "claimed") await releaseDailyKarteReport(supabase, ONCE_LOCK_DATE).catch(() => {});
    return;
  }

  try {
    const report = await loadDailyKarteReport(supabase, { dateYmd, now });
    const text = `【試し送信】昨日の日報です。\n\n${formatDailyKarteReport(report)}`;
    const chunks = chunkLinePushText(text);
    const results = await pushLineTextChunks({ token, toUserId: groupId, chunks });
    const ok = results.length > 0 && results.every((result) => result.ok);
    if (!ok) {
      const last = results[results.length - 1];
      console.error("[karte-group] push failed", { status: last?.status, body: last?.body?.slice(0, 300) });
      if (claim === "claimed") await releaseDailyKarteReport(supabase, ONCE_LOCK_DATE);
      return;
    }
    console.log(JSON.stringify({ karteGroupSent: true, dateYmd, chunks: chunks.length }));
  } catch (e) {
    console.error("[karte-group]", e instanceof Error ? e.message : e);
    if (claim === "claimed") await releaseDailyKarteReport(supabase, ONCE_LOCK_DATE).catch(() => {});
  }
}
