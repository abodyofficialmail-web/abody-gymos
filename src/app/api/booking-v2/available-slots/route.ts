import { createClient } from "@supabase/supabase-js";
import { DateTime } from "luxon";
import { z } from "zod";
import type { Database } from "@/types/database";
import type { SupabaseClient } from "@supabase/supabase-js";
import { jsonResponse } from "../_cors";
export async function OPTIONS() {
  return jsonResponse({}, 200);
}
const querySchema = z.object({
  store_id: z.string().uuid("store_id は有効なUUIDである必要があります"),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date は YYYY-MM-DD 形式である必要があります"),
});
const SLOT_MINUTES = 30;
type ShiftRow = {
  id: string;
  trainer_id: string;
  store_id: string;
  shift_date: string;
  start_local: string;
  end_local: string;
  status: string;
};
function parseLocalTimeToMinutes(t: string): number {
  const [hh, mm] = t.split(":");
  const h = Number(hh);
  const m = Number(mm ?? 0);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return NaN;
  return h * 60 + m;
}
function toUtcIsoFromStoreDateAndLocal(ymd: string, localTimeHHMMSS: string, zone: string): string {
  const hh = localTimeHHMMSS.slice(0, 2);
  const mm = localTimeHHMMSS.slice(3, 5);
  const dt = DateTime.fromISO(`${ymd}T${hh}:${mm}:00`, { zone });
  if (!dt.isValid) {
    throw new Error(`無効な日時です: ${ymd} ${localTimeHHMMSS} (${zone})`);
  }
  return dt.toUTC().toISO()!;
}
function overlapsMs(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && aEnd > bStart;
}
function createServiceClient():
  | { supabase: SupabaseClient<Database>; errorResponse: null }
  | { supabase: null; errorResponse: Response } {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    return {
      supabase: null,
      errorResponse: jsonResponse(
        {
          error:
            "サーバー設定が不足しています。NEXT_PUBLIC_SUPABASE_URL と SUPABASE_SERVICE_ROLE_KEY を設定してください。",
        },
        500
      ),
    };
  }
  const supabase = createClient<Database>(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return { supabase, errorResponse: null };
}
export type AvailableSlotDto = {
  start_at: string;
  end_at: string;
  trainer_id: string;
};
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const parsed = querySchema.safeParse({
      store_id: url.searchParams.get("store_id"),
      date: url.searchParams.get("date"),
    });
    if (!parsed.success) {
      return jsonResponse({ error: "クエリが不正です", detail: parsed.error.flatten() }, 400);
    }
    const { store_id, date } = parsed.data;
    const client = createServiceClient();
    if (client.errorResponse) return client.errorResponse;
    const supabase = client.supabase;
    const { data: storeRow, error: storeErr } = await supabase
      .from("stores")
      .select("id, timezone")
      .eq("id", store_id)
      .maybeSingle();
    if (storeErr) {
      return jsonResponse({ error: "店舗の取得に失敗しました", detail: storeErr.message }, 500);
    }
    if (!storeRow) {
      return jsonResponse({ error: "店舗が見つかりません" }, 404);
    }
    const zone = storeRow.timezone?.trim() || "Asia/Tokyo";
    const { data: shiftsRaw, error: shiftsErr } = await supabase
      .from("trainer_shifts")
      .select("id, trainer_id, store_id, shift_date, start_local, end_local, status")
      .eq("store_id", store_id)
      .eq("shift_date", date)
      .neq("status", "draft");
    if (shiftsErr) {
      return jsonResponse({ error: "シフトの取得に失敗しました", detail: shiftsErr.message }, 500);
    }
    const shifts = (shiftsRaw ?? []) as unknown as ShiftRow[];
    if (shifts.length === 0) {
      return jsonResponse([] satisfies AvailableSlotDto[], 200);
    }
    const dayStartUtc = DateTime.fromISO(date, { zone }).startOf("day").toUTC();
    const dayEndUtc = dayStartUtc.plus({ days: 1 });
    const { data: resRaw, error: resErr } = await supabase
      .from("reservations")
      .select("trainer_id, start_at, end_at, status")
      .eq("store_id", store_id)
      .neq("status", "cancelled")
      .gte("start_at", dayStartUtc.toISO()!)
      .lt("start_at", dayEndUtc.toISO()!);
    if (resErr) {
      return jsonResponse({ error: "予約の取得に失敗しました", detail: resErr.message }, 500);
    }
    const busyByTrainer = new Map<string, { start: number; end: number }[]>();
    for (const r of resRaw ?? []) {
      const tId = r.trainer_id;
      if (!tId) continue;
      const s = DateTime.fromISO(r.start_at).toMillis();
      const e = DateTime.fromISO(r.end_at).toMillis();
      const arr = busyByTrainer.get(tId) ?? [];
      arr.push({ start: s, end: e });
      busyByTrainer.set(tId, arr);
    }
    const nowMs = DateTime.now().toUTC().toMillis();
    const results: AvailableSlotDto[] = [];
    for (const shift of shifts) {
      const shiftStartMin = parseLocalTimeToMinutes(shift.start_local);
      const shiftEndMin = parseLocalTimeToMinutes(shift.end_local);
      if (!(shiftEndMin > shiftStartMin) || Number.isNaN(shiftStartMin) || Number.isNaN(shiftEndMin)) {
        continue;
      }
      const busy = busyByTrainer.get(shift.trainer_id) ?? [];
      for (let m = shiftStartMin; m + SLOT_MINUTES <= shiftEndMin; m += SLOT_MINUTES) {
        const slotStartLocal = `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}:00`;
        const slotEndMin = m + SLOT_MINUTES;
        const slotEndLocal = `${String(Math.floor(slotEndMin / 60)).padStart(2, "0")}:${String(slotEndMin % 60).padStart(2, "0")}:00`;
        let startAt: string;
        let endAt: string;
        try {
          startAt = toUtcIsoFromStoreDateAndLocal(date, slotStartLocal, zone);
          endAt = toUtcIsoFromStoreDateAndLocal(date, slotEndLocal, zone);
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e);
          return jsonResponse({ error: "スロット日時の変換に失敗しました", detail: message }, 500);
        }
        const slotStartMs = DateTime.fromISO(startAt).toMillis();
        const slotEndMs = DateTime.fromISO(endAt).toMillis();
        if (slotStartMs <= nowMs) continue;
        const isBusy = busy.some((p) => overlapsMs(p.start, p.end, slotStartMs, slotEndMs));
        if (isBusy) continue;
        results.push({
          start_at: startAt,
          end_at: endAt,
          trainer_id: shift.trainer_id,
        });
      }
    }
    results.sort((a, b) => a.start_at.localeCompare(b.start_at));
    return jsonResponse(results satisfies AvailableSlotDto[], 200);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return jsonResponse(
      { error: "空き枠の取得中に予期しないエラーが発生しました", detail: message },
      500
    );
  }
}
