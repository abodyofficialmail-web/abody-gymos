import { DateTime } from "luxon";
import { jsonResponse } from "@/app/api/booking-v2/_cors";
import { createSupabaseServiceClient } from "@/lib/supabase/admin";
import {
  alreadySentThisMonth,
  buildMidMonthOpsListText,
  buildMidMonthOpsReportText,
  listMidMonthLowBookingMembers,
  markSentThisMonth,
  sendMidMonthMemberLine,
  sendOpsLine,
} from "@/lib/midMonthLowBooking";

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
    if (now.day !== 15 && !force) {
      return jsonResponse({ ok: true, skipped: true, reason: "not_the_15th_jst", day: now.day });
    }

    const supabase = createSupabaseServiceClient();
    const { monthKey, monthLabel, asOfLabel, members } = await listMidMonthLowBookingMembers(supabase, now);

    const listText = buildMidMonthOpsListText({ monthLabel, asOfLabel, members });
    const listNotify = dryRun ? { ok: true } : await sendOpsLine(supabase, listText);
    if (!dryRun && !listNotify.ok) {
      return jsonResponse({ error: "ops_list_failed", detail: listNotify.error, count: members.length }, 500);
    }

    let sent = 0;
    let photo = 0;
    let failed = 0;
    let skippedNoLine = 0;
    let skippedAlready = 0;
    const failedCodes: string[] = [];
    const results: Array<Record<string, unknown>> = [];

    for (const m of members) {
      if (!m.line_user_id) {
        skippedNoLine += 1;
        results.push({ member_code: m.member_code, ok: false, error: "no_line_user_id" });
        continue;
      }
      if (!dryRun && (await alreadySentThisMonth(supabase, monthKey, m.member_code))) {
        skippedAlready += 1;
        results.push({ member_code: m.member_code, ok: true, skipped: "already_sent" });
        continue;
      }
      if (dryRun) {
        sent += 1;
        results.push({ member_code: m.member_code, ok: true, dry_run: true });
        continue;
      }
      const r = await sendMidMonthMemberLine(supabase, m, monthLabel);
      if (r.ok) {
        sent += 1;
        if (r.photo) photo += 1;
        await markSentThisMonth(supabase, monthKey, m.member_code, r.photo);
        results.push({ member_code: m.member_code, ok: true, photo: r.photo });
      } else {
        failed += 1;
        failedCodes.push(m.member_code);
        results.push({ member_code: m.member_code, ok: false, error: r.error });
      }
      await sleep(300);
    }

    const reportText = buildMidMonthOpsReportText({
      monthLabel,
      sent,
      photo,
      failed,
      skippedNoLine,
      skippedAlready,
      failedCodes,
    });
    const reportNotify = dryRun ? { ok: true } : await sendOpsLine(supabase, reportText);

    return jsonResponse({
      ok: failed === 0 && reportNotify.ok,
      dry_run: dryRun,
      month: monthKey,
      targets: members.length,
      sent,
      photo,
      failed,
      skipped_no_line: skippedNoLine,
      skipped_already: skippedAlready,
      ops_list: listNotify,
      ops_report: reportNotify,
      results,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return jsonResponse({ error: message }, 500);
  }
}
