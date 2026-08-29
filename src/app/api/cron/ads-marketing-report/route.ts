import { DateTime } from "luxon";
import { jsonResponse } from "@/app/api/booking-v2/_cors";
import { createSupabaseServiceClient } from "@/lib/supabase/admin";
import { dailyRangeYmd, loadAdsMarketingReport, weeklyRangeYmd } from "@/lib/marketing/loadAdsMarketingReport";
import { syncMarketingSnapshots } from "@/lib/marketing/syncMarketingSnapshots";
import {
  alreadySentMarketingReport,
  markMarketingReportSent,
  sendAdsMarketingReport,
} from "@/lib/marketing/sendAdsMarketingReport";
import { formatAdsMarketingReport } from "@/lib/marketing/formatAdsMarketingReport";
import type { AdsReportKind } from "@/lib/marketing/types";

export const maxDuration = 120;

const TZ = "Asia/Tokyo";

function mustCronAuth(req: Request): boolean {
  const reportSecret = process.env.REPORT_CRON_SECRET?.trim();
  const cronSecret = process.env.CRON_SECRET?.trim();
  const got = req.headers.get("x-cron-secret") ?? "";
  const auth = req.headers.get("authorization") ?? "";
  if (reportSecret && got === reportSecret) return true;
  if (cronSecret && auth === `Bearer ${cronSecret}`) return true;
  return false;
}

function periodKey(kind: AdsReportKind, startYmd: string, endYmd: string): string {
  return kind === "daily" ? startYmd : `${startYmd}_${endYmd}`;
}

export async function GET(req: Request) {
  try {
    if (!mustCronAuth(req)) return jsonResponse({ error: "unauthorized" }, 401);

    const url = new URL(req.url);
    const dryRun = url.searchParams.get("dry_run") === "1";
    const force = url.searchParams.get("force") === "1";
    const skipSync = url.searchParams.get("skip_sync") === "1";
    const kindParam = url.searchParams.get("kind");
    const now = DateTime.now().setZone(TZ);

    const kinds: AdsReportKind[] =
      kindParam === "daily" || kindParam === "weekly"
        ? [kindParam]
        : now.weekday === 1
          ? ["daily", "weekly"]
          : ["daily"];

    const supabase = createSupabaseServiceClient();
    const yesterday = now.minus({ days: 1 }).toISODate()!;

    const sync = skipSync
      ? null
      : await syncMarketingSnapshots({
          supabase,
          insightDateYmd: yesterday,
          snapshotDateYmd: yesterday,
        });

    const results: Array<Record<string, unknown>> = [];
    for (const kind of kinds) {
      const range = kind === "weekly" ? weeklyRangeYmd(now) : dailyRangeYmd(now);
      const report = await loadAdsMarketingReport({
        supabase,
        kind,
        startYmd: range.startYmd,
        endYmd: range.endYmd,
        generatedAtYmd: now.toISODate()!,
      });
      const key = periodKey(kind, range.startYmd, range.endYmd);
      const preview = formatAdsMarketingReport(report, { allStores: true });

      if (dryRun) {
        results.push({ kind, period_key: key, dry_run: true, preview, report });
        continue;
      }

      if (!force && (await alreadySentMarketingReport(supabase, kind, key))) {
        results.push({ kind, period_key: key, skipped: "already_sent" });
        continue;
      }

      const pushed = await sendAdsMarketingReport(supabase, report);
      if (pushed.ok) await markMarketingReportSent(supabase, kind, key);
      results.push({
        kind,
        period_key: key,
        sent: pushed.sent,
        skipped: pushed.skipped,
        ok: pushed.ok,
        error: pushed.error,
        preview,
      });
    }

    return jsonResponse({ ok: true, sync, results });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const status = message === "TABLE_MISSING" ? 503 : 500;
    return jsonResponse({ error: status === 503 ? "tables_missing" : "unexpected_error", detail: message }, status);
  }
}
