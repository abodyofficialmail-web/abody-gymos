import { jsonResponse } from "@/app/api/booking-v2/_cors";
import { NOVEMBER_PUBLIC_LINE_AT_ISO, novemberPublicLineWindow } from "@/lib/booking/novemberEarlyAccess";
import { sendNovemberPublicReleaseLine } from "@/lib/booking/novemberPublicLine";
import { createSupabaseServiceClient } from "@/lib/supabase/admin";

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
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function GET(req: Request) {
  try {
    if (!mustCronAuth(req)) return jsonResponse({ error: "unauthorized" }, 401);
    const startMs = Date.parse(NOVEMBER_PUBLIC_LINE_AT_ISO);
    const earlyMs = startMs - Date.now();
    if (earlyMs > 0 && earlyMs <= 90_000) await sleep(earlyMs);
    const window = novemberPublicLineWindow(new Date());
    if (window !== "open") return jsonResponse({ ok: true, skipped: true, window });
    const supabase = createSupabaseServiceClient();
    const line = await sendNovemberPublicReleaseLine(supabase);
    return jsonResponse({ ok: line.failed.length === 0, ...line });
  } catch (e) {
    return jsonResponse({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
}
