import { jsonResponse } from "@/app/api/booking-v2/_cors";
import { grantNovemberLowUsageTickets } from "@/lib/booking/novemberLowUsageGrant";
import { sendNovemberLowUsageTicketLine } from "@/lib/booking/novemberLowUsageLine";
import {
  NOVEMBER_BOOKING_MONTH,
  TOKYO_NOVEMBER_STORES,
  novemberBookingPhase,
} from "@/lib/booking/novemberEarlyAccess";
import { createSupabaseServiceClient } from "@/lib/supabase/admin";
import { applyNovemberTokyoShifts } from "../../../../../scripts/sync-final-shifts-2026-11.mjs";

export const maxDuration = 300;

const MONTH_START = "2026-11-01";
const MONTH_END = "2026-11-30";

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
    const now = new Date();
    const phase = novemberBookingPhase(now);
    if (phase === "hidden") {
      return jsonResponse({ ok: true, skipped: true, phase, month: NOVEMBER_BOOKING_MONTH });
    }

    const supabase = createSupabaseServiceClient();
    const shifts = await applyNovemberTokyoShifts(supabase, {
      nowMs: now.getTime(),
      allowExistingReservations: true,
    });
    const tickets = await grantNovemberLowUsageTickets(supabase);

    let released = 0;
    if (phase === "public") {
      const { data: stores, error: storeErr } = await supabase.from("stores").select("id,name").in("name", [...TOKYO_NOVEMBER_STORES]);
      if (storeErr) return jsonResponse({ error: storeErr.message, shifts, tickets }, 500);
      const storeIds = (stores ?? []).map((s) => s.id);
      if (storeIds.length !== TOKYO_NOVEMBER_STORES.length) {
        return jsonResponse({ error: "store_missing", found: (stores ?? []).map((s) => s.name), shifts, tickets }, 500);
      }
      const { data: updated, error: shiftErr } = await supabase
        .from("trainer_shifts")
        .update({ status: "confirmed" })
        .in("store_id", storeIds)
        .gte("shift_date", MONTH_START)
        .lte("shift_date", MONTH_END)
        .eq("status", "draft")
        .or("is_break.is.null,is_break.eq.false")
        .select("id");
      if (shiftErr) return jsonResponse({ error: shiftErr.message, shifts, tickets }, 500);
      released = (updated ?? []).length;
    }

    const line = await sendNovemberLowUsageTicketLine(supabase);

    return jsonResponse({
      ok: tickets.failed.length === 0 && line.failed.length === 0,
      line,
      phase,
      month: NOVEMBER_BOOKING_MONTH,
      shifts,
      eligible: tickets.eligible,
      granted: tickets.granted,
      skipped: tickets.skipped,
      failed: tickets.failed,
      released,
    });
  } catch (e) {
    return jsonResponse({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
}
