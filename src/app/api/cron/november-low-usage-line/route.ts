import { jsonResponse } from "@/app/api/booking-v2/_cors";
import { sendNovemberLowUsageTicketLine } from "@/lib/booking/novemberLowUsageLine";
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

export async function GET(req: Request) {
  try {
    if (!mustCronAuth(req)) return jsonResponse({ error: "unauthorized" }, 401);
    const supabase = createSupabaseServiceClient();
    const line = await sendNovemberLowUsageTicketLine(supabase);
    return jsonResponse({
      ok: line.failed.length === 0,
      ...line,
    });
  } catch (e) {
    return jsonResponse({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
}
