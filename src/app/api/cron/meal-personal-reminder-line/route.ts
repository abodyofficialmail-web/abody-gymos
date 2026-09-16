import { jsonResponse } from "@/app/api/booking-v2/_cors";
import { createSupabaseServiceClient } from "@/lib/supabase/admin";
import {
  listMealPersonalReminderTargets,
  sendMealPersonalReminder,
  type MealReminderSlot,
} from "@/lib/mealPersonalReminderLine";
import { tokyoTodayYmd } from "@/lib/memberMealLogs";
import {
  DEFAULT_MEAL_REMINDER_SETTINGS,
  dueMealSlots,
  fetchMealReminderSettingsByMemberIds,
} from "@/lib/memberMealReminderSettings";

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
    const forceSend = url.searchParams.get("force_send") === "1";
    const slotParam = url.searchParams.get("slot");
    const forceSlot: MealReminderSlot | null =
      slotParam === "breakfast" || slotParam === "lunch" || slotParam === "dinner" || slotParam === "snack"
        ? slotParam
        : null;

    const supabase = createSupabaseServiceClient();
    const today = tokyoTodayYmd();
    const targets = await listMealPersonalReminderTargets(supabase);
    const settingsMap = await fetchMealReminderSettingsByMemberIds(
      supabase,
      targets.map((m) => m.id)
    );

    let sent = 0;
    let failed = 0;
    let skipped = 0;
    const results: Array<Record<string, unknown>> = [];

    for (const member of targets) {
      const settings = settingsMap.get(member.id) ?? DEFAULT_MEAL_REMINDER_SETTINGS;
      const slots = forceSlot ? [forceSlot] : dueMealSlots(settings);
      if (slots.length === 0) {
        skipped += 1;
        results.push({ member_code: member.member_code, sent: false, skipped: "not_due" });
        continue;
      }
      for (const slot of slots) {
        const r = await sendMealPersonalReminder(supabase, {
          member,
          slot,
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
