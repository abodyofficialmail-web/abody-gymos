import { jsonResponse } from "@/app/api/booking-v2/_cors";
import { createSupabaseServiceClient } from "@/lib/supabase/admin";
import {
  isMorningWeightReminderHour,
  listMorningWeightReminderTargets,
  sendMorningWeightReminder,
} from "@/lib/morningWeightReminderLine";
import { tokyoTodayYmd } from "@/lib/memberWeightLogs";

export const maxDuration = 300;

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
    const forceHour = url.searchParams.get("force") === "1";
    const forceSend = url.searchParams.get("force_send") === "1";
    if (!isMorningWeightReminderHour() && !forceHour && !forceSend) {
      return jsonResponse({ ok: true, skipped: true, reason: "not_7am_jst" });
    }

    const supabase = createSupabaseServiceClient();
    const today = tokyoTodayYmd();
    const targets = await listMorningWeightReminderTargets(supabase);

    let sent = 0;
    let failed = 0;
    let skipped = 0;
    const results: Array<Record<string, unknown>> = [];

    for (const member of targets) {
      const r = await sendMorningWeightReminder(supabase, {
        member,
        today,
        dryRun,
        force: forceSend,
        recordDispatch: !dryRun && !forceSend,
      });
      results.push(r);
      if (r.sent) sent += 1;
      else if (r.skipped) skipped += 1;
      else failed += 1;
      await sleep(250);
    }

    return jsonResponse({
      ok: failed === 0,
      dry_run: dryRun,
      today,
      targets: targets.length,
      sent,
      failed,
      skipped,
      results,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return jsonResponse({ error: message }, 500);
  }
}
