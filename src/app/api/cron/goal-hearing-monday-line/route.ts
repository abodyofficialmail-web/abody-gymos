import { DateTime } from "luxon";
import { jsonResponse } from "@/app/api/booking-v2/_cors";
import { createSupabaseServiceClient } from "@/lib/supabase/admin";
import {
  alreadySentThisWeek,
  buildMondayOpsReportText,
  listGoalHearingMondayTargets,
  sendGoalHearingMondayLine,
  sendMondayOpsReport,
} from "@/lib/goalHearingMondayLine";

export const maxDuration = 300;

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

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export async function GET(req: Request) {
  try {
    if (!mustCronAuth(req)) return jsonResponse({ error: "unauthorized" }, 401);

    const url = new URL(req.url);
    const dryRun = url.searchParams.get("dry_run") === "1";
    const force = url.searchParams.get("force") === "1";
    const now = DateTime.now().setZone(TZ);
    if (now.weekday !== 1 && !force) {
      return jsonResponse({ ok: true, skipped: true, reason: "not_monday_jst", weekday: now.weekday });
    }

    const supabase = createSupabaseServiceClient();
    const { weekStart, asOfLabel, targets, skippedNoPhoto, skippedNoHearing } =
      await listGoalHearingMondayTargets(supabase, now);

    let sent = 0;
    let failed = 0;
    let skippedNoLine = 0;
    let skippedAlready = 0;
    const failedCodes: string[] = [];
    const results: Array<Record<string, unknown>> = [];

    for (const m of targets) {
      if (!m.line_user_id) {
        skippedNoLine += 1;
        results.push({ member_code: m.member_code, ok: false, error: "no_line_user_id" });
        continue;
      }
      if (!dryRun && (await alreadySentThisWeek(supabase, weekStart, m.member_code))) {
        skippedAlready += 1;
        results.push({ member_code: m.member_code, ok: true, skipped: "already_sent" });
        continue;
      }
      const r = await sendGoalHearingMondayLine(supabase, {
        memberCode: m.member_code,
        dryRun,
        recordDispatch: !dryRun,
        now,
      });
      if (r.sent || (dryRun && !r.error)) {
        sent += 1;
        results.push({ member_code: m.member_code, ok: true, dry_run: dryRun || undefined });
      } else {
        failed += 1;
        failedCodes.push(m.member_code);
        results.push({ member_code: m.member_code, ok: false, error: r.error });
      }
      await sleep(300);
    }

    const reportText = buildMondayOpsReportText({
      asOfLabel,
      targets: targets.length,
      sent,
      failed,
      skippedNoLine,
      skippedAlready,
      skippedNoPhoto,
      skippedNoHearing,
      failedCodes,
      dryRun,
    });
    const opsReport = dryRun ? { ok: true } : await sendMondayOpsReport(supabase, reportText);

    return jsonResponse({
      ok: failed === 0 && opsReport.ok,
      dry_run: dryRun,
      week_start: weekStart,
      targets: targets.length,
      sent,
      failed,
      skipped_no_line: skippedNoLine,
      skipped_already: skippedAlready,
      skipped_no_photo: skippedNoPhoto,
      skipped_no_hearing: skippedNoHearing,
      ops_report: opsReport,
      results,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return jsonResponse({ error: message }, 500);
  }
}
