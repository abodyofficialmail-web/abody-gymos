import { DateTime } from "luxon";
import { jsonResponse } from "@/app/api/booking-v2/_cors";
import {
  claimDailyKarteReport,
  formatDailyKarteReport,
  loadDailyKarteReport,
  releaseDailyKarteReport,
} from "@/lib/dailyKarteReport";
import { pushOpsLineNotice } from "@/lib/paymentLinkNotify";
import { createSupabaseServiceClient } from "@/lib/supabase/admin";

export const maxDuration = 60;

const TZ = "Asia/Tokyo";

/**
 * 毎日 22:30 JST（vercel.json は 13:30 UTC）。
 * 終了済みセッションについて、店舗ごとのトレーナー別カルテ送信率と、未来店率・当日キャンセル率を
 * ゆうととテストアカウントへ送る。未来店は送信率の分母に入れない。
 */
function mustCronAuth(req: Request): boolean {
  const reportSecret = process.env.REPORT_CRON_SECRET?.trim();
  const cronSecret = process.env.CRON_SECRET?.trim();
  const got = req.headers.get("x-cron-secret") ?? "";
  const auth = req.headers.get("authorization") ?? "";
  if (reportSecret && got === reportSecret) return true;
  if (cronSecret && auth === `Bearer ${cronSecret}`) return true;
  return false;
}

export async function GET(req: Request) {
  try {
    if (!mustCronAuth(req)) return jsonResponse({ error: "unauthorized" }, 401);

    const url = new URL(req.url);
    const dryRun = url.searchParams.get("dry_run") === "1";
    const force = url.searchParams.get("force") === "1";
    const dateParam = url.searchParams.get("date");
    if (dateParam && !/^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
      return jsonResponse({ error: "invalid_date" }, 400);
    }

    const now = DateTime.now().setZone(TZ);
    const dateYmd = dateParam || now.toISODate()!;
    const supabase = createSupabaseServiceClient();
    const report = await loadDailyKarteReport(supabase, { dateYmd, now });
    const text = formatDailyKarteReport(report);
    const summary = {
      date: dateYmd,
      sessions: report.summary.sessions,
      karte_sent: report.summary.sent,
      karte_unsent: report.summary.unsent,
      karte_consumed: report.summary.consumed,
    };

    if (dryRun) {
      return jsonResponse({ ok: true, dry_run: true, ...summary, preview: text }, 200);
    }

    if (force) await releaseDailyKarteReport(supabase, dateYmd);
    const claim = await claimDailyKarteReport(supabase, dateYmd);
    if (claim === "already") {
      return jsonResponse({ ok: true, skipped: "already_sent", ...summary }, 200);
    }

    const pushed = await pushOpsLineNotice(supabase, text);
    if (pushed.sent.length === 0) {
      if (claim === "claimed") {
        await releaseDailyKarteReport(supabase, dateYmd).catch((e) => {
          console.error("[dailyKarteReport] release failed", e);
        });
      }
      return jsonResponse({ error: "push_failed", sent: pushed.sent, missed: pushed.missed, ...summary }, 502);
    }

    if (pushed.missed.length > 0) {
      console.error("[dailyKarteReport] partial send", pushed);
    }
    return jsonResponse(
      { ok: pushed.missed.length === 0, deduped: claim === "claimed", sent: pushed.sent, missed: pushed.missed, ...summary },
      200
    );
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return jsonResponse({ error: "unexpected_error", detail: message }, 500);
  }
}
