import { jsonResponse } from "@/app/api/booking-v2/_cors";
import {
  DECEMBER_BOOKING_MONTH,
  TOKYO_DECEMBER_STORES,
  decemberBookingPhase,
} from "@/lib/booking/decemberEarlyAccess";
import { createSupabaseServiceClient } from "@/lib/supabase/admin";

export const maxDuration = 300;

const MONTH_START = "2026-12-01";
const MONTH_END = "2026-12-31";
const MONTH_START_ISO = "2026-12-01T00:00:00+09:00";
const NEXT_MONTH_START = "2027-01-01T00:00:00+09:00";

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
    const phase = decemberBookingPhase(now);
    if (phase !== "public") {
      return jsonResponse({ ok: true, skipped: true, phase, month: DECEMBER_BOOKING_MONTH });
    }

    const supabase = createSupabaseServiceClient();
    const { data: stores, error: storeErr } = await supabase.from("stores").select("id,name").in("name", [...TOKYO_DECEMBER_STORES]);
    if (storeErr) return jsonResponse({ error: storeErr.message }, 500);
    const storeIds = (stores ?? []).map((s) => s.id);
    if (storeIds.length !== TOKYO_DECEMBER_STORES.length) {
      return jsonResponse({ error: "store_missing", found: (stores ?? []).map((s) => s.name) }, 500);
    }

    const before = await supabase
      .from("reservations")
      .select("id", { count: "exact", head: true })
      .in("store_id", storeIds)
      .gte("start_at", MONTH_START_ISO)
      .lt("start_at", NEXT_MONTH_START)
      .neq("status", "cancelled");
    if (before.error) return jsonResponse({ error: before.error.message }, 500);

    const { data: updated, error: shiftErr } = await supabase
      .from("trainer_shifts")
      .update({ status: "confirmed" })
      .in("store_id", storeIds)
      .gte("shift_date", MONTH_START)
      .lte("shift_date", MONTH_END)
      .eq("status", "draft")
      .select("id");
    if (shiftErr) return jsonResponse({ error: shiftErr.message }, 500);

    const after = await supabase
      .from("reservations")
      .select("id", { count: "exact", head: true })
      .in("store_id", storeIds)
      .gte("start_at", MONTH_START_ISO)
      .lt("start_at", NEXT_MONTH_START)
      .neq("status", "cancelled");
    if (after.error) return jsonResponse({ error: after.error.message }, 500);

    return jsonResponse({
      ok: true,
      phase,
      month: DECEMBER_BOOKING_MONTH,
      released: (updated ?? []).length,
      decemberReservationsBefore: before.count ?? 0,
      decemberReservationsAfter: after.count ?? 0,
    });
  } catch (e) {
    return jsonResponse({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
}
