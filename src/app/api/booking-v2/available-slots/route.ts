import { createClient } from "@supabase/supabase-js";
import { DateTime } from "luxon";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import timezone from "dayjs/plugin/timezone";
import { z } from "zod";
import type { Database } from "@/types/database";
import type { SupabaseClient } from "@supabase/supabase-js";
import { jsonResponse } from "../_cors";
dayjs.extend(utc);
dayjs.extend(timezone);
export async function OPTIONS() {
  return jsonResponse({}, 200);
}
const querySchema = z.object({
  store_id: z.string().uuid("store_id は有効なUUIDである必要があります"),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date は YYYY-MM-DD 形式である必要があります"),
});
const SLOT_MINUTES = 30;
function isApril2026Closed(ymd: string) {
  // 要望: 2026年4月の予約を一旦閉じる
  return String(ymd).startsWith("2026-04-");
}
type ShiftRow = {
  id: string;
  trainer_id: string;
  store_id: string;
  shift_date: string;
  start_local: string;
  end_local: string;
  status: string;
  is_break?: boolean | null;
};
type EventRow = {
  id: string;
  trainer_id: string;
  store_id: string;
  event_date: string;
  start_local: string;
  end_local: string;
  title: string;
  block_booking: boolean;
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
    console.log("slots debug", { store_id, date });
    if (isApril2026Closed(date)) {
      return jsonResponse([], 200);
    }
    const client = createServiceClient();
    if (client.errorResponse) return client.errorResponse;
    const supabase = client.supabase;
    const { data: storeRow, error: storeErr } = await supabase
      .from("stores")
      .select("id, timezone, booking_cutoff_prev_day_time")
      .eq("id", store_id)
      .maybeSingle();
    if (storeErr) {
      return jsonResponse({ error: "店舗の取得に失敗しました", detail: storeErr.message }, 500);
    }
    if (!storeRow) {
      return jsonResponse({ error: "店舗が見つかりません" }, 404);
    }
    // stores.timezone に合わせて締切判定・表示を揃える
    const zone = storeRow.timezone?.trim() || "Asia/Tokyo";
    const cutoffHHMM = String((storeRow as any)?.booking_cutoff_prev_day_time ?? "22:00");
    {
      const now = DateTime.now().setZone(zone);
      const hh = Number(cutoffHHMM.slice(0, 2));
      const mm = Number(cutoffHHMM.slice(3, 5));
      const cutoff = DateTime.fromISO(`${date}T${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:00`, { zone }).minus({
        days: 1,
      });
      if (now.toMillis() > cutoff.toMillis()) {
        // 締切を過ぎている日はそもそも枠を表示しない
        return jsonResponse([], 200);
      }
    }
    let shifts: ShiftRow[] = [];
    {
      const makeQueryA = (select: string) =>
        supabase
          .from("trainer_shifts")
          .select(select)
          .eq("store_id", store_id)
          .eq("shift_date", date)
          .neq("status", "draft");

      const { data: shiftsRaw, error: shiftsErr } = await makeQueryA(
        "id, trainer_id, store_id, shift_date, start_local, end_local, break_minutes, status, is_break"
      );
      if (shiftsErr) {
        const msg = String((shiftsErr as any)?.message ?? "");
        if (msg.includes("break_minutes") && (msg.includes("does not exist") || msg.includes("column"))) {
          const { data: shiftsRaw2, error: shiftsErr2 } = await makeQueryA(
            "id, trainer_id, store_id, shift_date, start_local, end_local, status, is_break"
          );
          if (shiftsErr2) {
            // schema B: date / start_time / end_time
            const { data: shiftsRawB, error: shiftsErrB } = await (supabase as any)
              .from("trainer_shifts")
              .select("id, trainer_id, store_id, date, start_time, end_time, status, is_break")
              .eq("store_id", store_id)
              .eq("date", date)
              .neq("status", "draft");
            if (shiftsErrB) {
              return jsonResponse({ error: "シフトの取得に失敗しました", detail: shiftsErrB.message }, 500);
            }
            shifts = ((shiftsRawB ?? []) as any[]).map((s) => ({
              id: String(s.id),
              trainer_id: String(s.trainer_id),
              store_id: String(s.store_id),
              shift_date: String(s.date),
              start_local: String(s.start_time),
              end_local: String(s.end_time),
              status: String(s.status ?? ""),
              is_break: s.is_break ?? null,
            })) as unknown as ShiftRow[];
          } else {
            shifts = ((shiftsRaw2 ?? []) as any[]).map((s) => ({ ...s, break_minutes: 0 })) as unknown as ShiftRow[];
          }
        } else {
          // schema B: date / start_time / end_time
          const { data: shiftsRawB, error: shiftsErrB } = await (supabase as any)
            .from("trainer_shifts")
            .select("id, trainer_id, store_id, date, start_time, end_time, status, is_break")
            .eq("store_id", store_id)
            .eq("date", date)
            .neq("status", "draft");
          if (shiftsErrB) {
            return jsonResponse({ error: "シフトの取得に失敗しました", detail: shiftsErr.message }, 500);
          }
          shifts = ((shiftsRawB ?? []) as any[]).map((s) => ({
            id: String(s.id),
            trainer_id: String(s.trainer_id),
            store_id: String(s.store_id),
            shift_date: String(s.date),
            start_local: String(s.start_time),
            end_local: String(s.end_time),
            status: String(s.status ?? ""),
            is_break: s.is_break ?? null,
          })) as unknown as ShiftRow[];
        }
      } else {
        shifts = (shiftsRaw ?? []) as unknown as ShiftRow[];
        // A が空/時刻が無い場合は B も試す（reservations と同様にフォールバック）
        const hasAnyTimeA = shifts.some((s) => (s as any)?.start_local && (s as any)?.end_local);
        if (!hasAnyTimeA) {
          const { data: shiftsRawB, error: shiftsErrB } = await (supabase as any)
            .from("trainer_shifts")
            .select("id, trainer_id, store_id, date, start_time, end_time, status, is_break")
            .eq("store_id", store_id)
            .eq("date", date)
            .neq("status", "draft");
          if (!shiftsErrB) {
            shifts = ((shiftsRawB ?? []) as any[]).map((s) => ({
              id: String(s.id),
              trainer_id: String(s.trainer_id),
              store_id: String(s.store_id),
              shift_date: String(s.date),
              start_local: String(s.start_time),
              end_local: String(s.end_time),
              status: String(s.status ?? ""),
              is_break: s.is_break ?? null,
            })) as unknown as ShiftRow[];
          }
        }
      }
    }
    console.log("shifts found", shifts);
    if (shifts.length === 0) {
      return jsonResponse([] satisfies AvailableSlotDto[], 200);
    }

    // blocking events（trainer_events.block_booking=true）
    let blockingEvents: EventRow[] = [];
    try {
      const { data: eraw, error: eerr } = await (supabase as any)
        .from("trainer_events")
        .select("id, trainer_id, store_id, event_date, start_local, end_local, title, block_booking")
        .eq("store_id", store_id)
        .eq("event_date", date)
        .eq("block_booking", true);
      if (!eerr) blockingEvents = (eraw ?? []) as EventRow[];
    } catch {
      blockingEvents = [];
    }
    const eventRangesByTrainer = new Map<string, Array<{ start_min: number; end_min: number }>>();
    for (const ev of blockingEvents) {
      const a = parseLocalTimeToMinutes(String(ev.start_local));
      const b = parseLocalTimeToMinutes(String(ev.end_local));
      if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) continue;
      const arr = eventRangesByTrainer.get(ev.trainer_id) ?? [];
      arr.push({ start_min: a, end_min: b });
      eventRangesByTrainer.set(ev.trainer_id, arr);
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
    const unassignedReservations: { start: number; end: number }[] = [];
    for (const r of resRaw ?? []) {
      const tId = r.trainer_id;
      const s = DateTime.fromISO(r.start_at).toMillis();
      const e = DateTime.fromISO(r.end_at).toMillis();
      if (!tId) {
        unassignedReservations.push({ start: s, end: e });
        continue;
      }
      const arr = busyByTrainer.get(tId) ?? [];
      arr.push({ start: s, end: e });
      busyByTrainer.set(tId, arr);
    }
    const nowMs = DateTime.now().toUTC().toMillis();
    // breaks (shift_id -> breaks[])
    const breaksByShiftId = new Map<string, { start_time: string; end_time: string }[]>();
    try {
      const shiftIds = Array.from(new Set(shifts.map((s) => s.id).filter(Boolean)));
      if (shiftIds.length > 0) {
        const { data: braw, error: berr } = await supabase
          .from("trainer_shift_breaks")
          .select("shift_id, start_time, end_time")
          .in("shift_id", shiftIds);
        if (!berr) {
          for (const b of braw ?? []) {
            const arr = breaksByShiftId.get((b as any).shift_id) ?? [];
            arr.push({ start_time: String((b as any).start_time ?? ""), end_time: String((b as any).end_time ?? "") });
            breaksByShiftId.set((b as any).shift_id, arr);
          }
        } else {
          // テーブル未反映などは無視（休憩なし扱い）
          console.error("shift breaks fetch error", berr);
        }
      }
    } catch (e) {
      console.error("shift breaks fetch error", e);
    }
    // 各枠ごとに「空いているトレーナー数」をカウントし、trainer_id null の予約数で容量を消費させる
    const freeTrainerSetBySlotKey = new Map<string, Set<string>>();
    const startEndBySlotKey = new Map<string, { start_at: string; end_at: string }>();
    for (const shift of shifts) {
      if (shift.is_break) continue;
      const shiftStartMin = parseLocalTimeToMinutes(shift.start_local);
      const shiftEndMin = parseLocalTimeToMinutes(shift.end_local);
      if (!(shiftEndMin > shiftStartMin) || Number.isNaN(shiftStartMin) || Number.isNaN(shiftEndMin)) {
        continue;
      }
      const shiftStart = shift.start_local;
      const shiftEnd = shift.end_local;
      const generatedSlots: Array<{ start_at: string; end_at: string }> = [];
      const busy = busyByTrainer.get(shift.trainer_id) ?? [];
      const shiftBreaks = breaksByShiftId.get(shift.id) ?? [];
      const evRanges = eventRangesByTrainer.get(shift.trainer_id) ?? [];
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
        const isBlockedByEvent = evRanges.some((r) => m < r.end_min && m + SLOT_MINUTES > r.start_min);
        if (isBlockedByEvent) continue;
        const isBreak = shiftBreaks.some((b) => {
          const bsMin = parseLocalTimeToMinutes(String(b.start_time));
          const beMin = parseLocalTimeToMinutes(String(b.end_time));
          if (!Number.isFinite(bsMin) || !Number.isFinite(beMin) || beMin <= bsMin) return false;
          // slotは常に m→m+SLOT_MINUTES のローカル分なので、同じ分系で判定
          const slotStartMin = m;
          const slotEndMin = m + SLOT_MINUTES;
          return slotStartMin < beMin && slotEndMin > bsMin;
        });
        if (isBreak) continue;
        const key = `${startAt}|${endAt}`;
        const set = freeTrainerSetBySlotKey.get(key) ?? new Set<string>();
        set.add(shift.trainer_id);
        freeTrainerSetBySlotKey.set(key, set);
        if (!startEndBySlotKey.has(key)) startEndBySlotKey.set(key, { start_at: startAt, end_at: endAt });
        generatedSlots.push({ start_at: startAt, end_at: endAt });
      }
      console.log("生成スロット", { shiftStart, shiftEnd, generatedSlots });
    }

    const unassignedCountBySlotKey = new Map<string, number>();
    for (const [key, se] of startEndBySlotKey) {
      const slotStartMs = DateTime.fromISO(se.start_at).toMillis();
      const slotEndMs = DateTime.fromISO(se.end_at).toMillis();
      let c = 0;
      for (const r of unassignedReservations) {
        if (overlapsMs(r.start, r.end, slotStartMs, slotEndMs)) c += 1;
      }
      unassignedCountBySlotKey.set(key, c);
    }

    const results: AvailableSlotDto[] = [];
    for (const [key, trainersSet] of freeTrainerSetBySlotKey) {
      const capacity = trainersSet.size;
      const used = unassignedCountBySlotKey.get(key) ?? 0;
      if (capacity <= used) continue;
      const se = startEndBySlotKey.get(key);
      if (!se) continue;
      results.push({ start_at: se.start_at, end_at: se.end_at });
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
