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
  month: z.string().regex(/^\d{4}-\d{2}$/u, "month は YYYY-MM 形式である必要があります"),
  trainer_id: z.string().uuid("trainer_id は有効なUUIDである必要があります").optional(),
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
  shift_date: string; // YYYY-MM-DD (store local)
  start_local: string; // HH:MM:SS
  end_local: string; // HH:MM:SS
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
type DateCount = { date: string; count: number };
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const parsed = querySchema.safeParse({
      store_id: url.searchParams.get("store_id"),
      month: url.searchParams.get("month"),
      trainer_id: url.searchParams.get("trainer_id") ?? undefined,
    });
    if (!parsed.success) {
      return jsonResponse({ error: "クエリが不正です", detail: parsed.error.flatten() }, 400);
    }
    const { store_id, month, trainer_id } = parsed.data;
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
    const zone = storeRow.timezone?.trim() || "Asia/Tokyo";
    const cutoffHHMM = String((storeRow as any)?.booking_cutoff_prev_day_time ?? "22:00");
    const cutoffParts = /^\d{2}:\d{2}$/u.test(cutoffHHMM)
      ? { h: Number(cutoffHHMM.slice(0, 2)), m: Number(cutoffHHMM.slice(3, 5)) }
      : { h: 22, m: 0 };
    const now = DateTime.now().setZone(zone);
    const monthStartLocal = DateTime.fromISO(`${month}-01`, { zone }).startOf("month");
    if (!monthStartLocal.isValid) {
      return jsonResponse({ error: "month の解釈に失敗しました" }, 400);
    }
    const monthEndLocal = monthStartLocal.endOf("month").startOf("day");
    const startDate = monthStartLocal.toISODate()!;
    const endDate = monthEndLocal.toISODate()!;
    let shifts: ShiftRow[] = [];
    {
      const makeQuery = (select: string) => {
        let q = supabase
          .from("trainer_shifts")
          .select(select)
          .eq("store_id", store_id)
          .gte("shift_date", startDate)
          .lte("shift_date", endDate)
          .neq("status", "draft");
        if (trainer_id) q = q.eq("trainer_id", trainer_id);
        return q;
      };

      const { data: shiftsRaw, error: shiftsErr } = await makeQuery(
        "id, trainer_id, store_id, shift_date, start_local, end_local, break_minutes, status, is_break"
      );
      if (shiftsErr) {
        const msg = String((shiftsErr as any)?.message ?? "");
        if (msg.includes("break_minutes") && (msg.includes("does not exist") || msg.includes("column"))) {
          const { data: shiftsRaw2, error: shiftsErr2 } = await makeQuery(
            "id, trainer_id, store_id, shift_date, start_local, end_local, status, is_break"
          );
          if (shiftsErr2) return jsonResponse({ error: "シフトの取得に失敗しました", detail: shiftsErr2.message }, 500);
          shifts = ((shiftsRaw2 ?? []) as any[]).map((s) => ({ ...s, break_minutes: 0 })) as unknown as ShiftRow[];
        } else {
          return jsonResponse({ error: "シフトの取得に失敗しました", detail: shiftsErr.message }, 500);
        }
      } else {
        shifts = (shiftsRaw ?? []) as unknown as ShiftRow[];
      }
    }
    const monthStartUtc = monthStartLocal.startOf("day").toUTC();
    const nextMonthStartUtc = monthStartLocal.plus({ months: 1 }).startOf("month").toUTC();
    let resQuery = supabase
      .from("reservations")
      .select("trainer_id, start_at, end_at, status")
      .eq("store_id", store_id)
      .neq("status", "cancelled")
      .gte("start_at", monthStartUtc.toISO()!)
      .lt("start_at", nextMonthStartUtc.toISO()!);
    if (trainer_id) resQuery = resQuery.eq("trainer_id", trainer_id);
    const { data: resRaw, error: resErr } = await resQuery;
    if (resErr) {
      return jsonResponse({ error: "予約の取得に失敗しました", detail: resErr.message }, 500);
    }
    // busyByTrainerDate: key = `${YYYY-MM-DD}|${trainer_id}`（trainer_idがある予約のみ）
    const busyByTrainerDate = new Map<string, { start: number; end: number }[]>();
    // unassignedByDate: key = `${YYYY-MM-DD}`（trainer_id=null の予約は「その時間帯の容量」を消費する）
    const unassignedByDate = new Map<string, { start: number; end: number }[]>();
    for (const r of resRaw ?? []) {
      const tId = (r as any).trainer_id as string | null;
      const sIso = (r as any).start_at as string;
      const eIso = (r as any).end_at as string;
      const sMs = DateTime.fromISO(sIso).toMillis();
      const eMs = DateTime.fromISO(eIso).toMillis();
      const dateYmd = DateTime.fromISO(sIso).setZone(zone).toISODate();
      if (!dateYmd) continue;
      if (tId) {
        const key = `${dateYmd}|${tId}`;
        const arr = busyByTrainerDate.get(key) ?? [];
        arr.push({ start: sMs, end: eMs });
        busyByTrainerDate.set(key, arr);
      } else {
        const key = `${dateYmd}`;
        const arr = unassignedByDate.get(key) ?? [];
        arr.push({ start: sMs, end: eMs });
        unassignedByDate.set(key, arr);
      }
    }
    // NOTE:
    // countByDate は「営業枠の総数」ではなく「実際に予約可能な時間枠数（残り枠>0の枠数）」にする。
    // Step 4（available-slots）と整合させるため、trainer_id=null の予約も容量消費として差し引く。
    const countByDate = new Map<string, number>();

    // blocking events（trainer_events.block_booking=true）を日別・trainer別に保持
    const blockingByTrainerDate = new Map<string, Array<{ start: number; end: number }>>();
    try {
      const { data: eraw, error: eerr } = await (supabase as any)
        .from("trainer_events")
        .select("id, trainer_id, store_id, event_date, start_local, end_local, title, block_booking")
        .eq("store_id", store_id)
        .gte("event_date", startDate)
        .lte("event_date", endDate)
        .eq("block_booking", true);
      if (!eerr) {
        for (const ev of eraw ?? []) {
          const ymd = String((ev as any).event_date ?? "");
          const tid = String((ev as any).trainer_id ?? "");
          const a = parseLocalTimeToMinutes(String((ev as any).start_local ?? ""));
          const b = parseLocalTimeToMinutes(String((ev as any).end_local ?? ""));
          if (!ymd || !tid) continue;
          if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) continue;
          const key = `${ymd}|${tid}`;
          const arr = blockingByTrainerDate.get(key) ?? [];
          arr.push({ start: a, end: b });
          blockingByTrainerDate.set(key, arr);
        }
      }
    } catch {
      // ignore
    }

    // breaks（trainer_shift_breaks）を shift_id ごとに保持（存在しない環境では無視）
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
            const sid = String((b as any).shift_id ?? "");
            if (!sid) continue;
            const arr = breaksByShiftId.get(sid) ?? [];
            arr.push({
              start_time: String((b as any).start_time ?? ""),
              end_time: String((b as any).end_time ?? ""),
            });
            breaksByShiftId.set(sid, arr);
          }
        }
      }
    } catch {
      // ignore
    }

    const nowUtcMs = DateTime.now().toUTC().toMillis();
    // day -> slotKey -> set(trainer_id)
    const freeTrainerSetByDateSlotKey = new Map<string, Map<string, Set<string>>>();
    // day -> slotKey -> {start_at,end_at}
    const startEndByDateSlotKey = new Map<string, Map<string, { start_at: string; end_at: string }>>();

    for (const shift of shifts) {
      if (shift.is_break) continue;
      const shiftStartMin = parseLocalTimeToMinutes(shift.start_local);
      const shiftEndMin = parseLocalTimeToMinutes(shift.end_local);
      if (
        !(shiftEndMin > shiftStartMin) ||
        Number.isNaN(shiftStartMin) ||
        Number.isNaN(shiftEndMin)
      ) {
        continue;
      }
      const busyKey = `${shift.shift_date}|${shift.trainer_id}`;
      const busy = busyByTrainerDate.get(busyKey) ?? [];
      const blocked = blockingByTrainerDate.get(busyKey) ?? [];
      const shiftBreaks = breaksByShiftId.get(shift.id) ?? [];
      for (let m = shiftStartMin; m + SLOT_MINUTES <= shiftEndMin; m += SLOT_MINUTES) {
        const slotStartLocal = `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(
          m % 60
        ).padStart(2, "0")}:00`;
        const slotEndMin = m + SLOT_MINUTES;
        const slotEndLocal = `${String(Math.floor(slotEndMin / 60)).padStart(2, "0")}:${String(
          slotEndMin % 60
        ).padStart(2, "0")}:00`;
        let startAt: string;
        let endAt: string;
        try {
          startAt = toUtcIsoFromStoreDateAndLocal(shift.shift_date, slotStartLocal, zone);
          endAt = toUtcIsoFromStoreDateAndLocal(shift.shift_date, slotEndLocal, zone);
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e);
          return jsonResponse({ error: "スロット日時の変換に失敗しました", detail: message }, 500);
        }
        const slotStartMs = DateTime.fromISO(startAt).toMillis();
        const slotEndMs = DateTime.fromISO(endAt).toMillis();
        // 過去時刻は枠として扱わない（Step4と揃える）
        if (slotStartMs <= nowUtcMs) continue;
        const isBusy = busy.some((p) => overlapsMs(p.start, p.end, slotStartMs, slotEndMs));
        if (isBusy) continue;
        const isBlockedByEvent = blocked.some((r) => m < r.end && m + SLOT_MINUTES > r.start);
        if (isBlockedByEvent) continue;

        const isBreak = shiftBreaks.some((b) => {
          const bsMin = parseLocalTimeToMinutes(String((b as any).start_time ?? ""));
          const beMin = parseLocalTimeToMinutes(String((b as any).end_time ?? ""));
          if (!Number.isFinite(bsMin) || !Number.isFinite(beMin) || beMin <= bsMin) return false;
          const slotStartMin = m;
          const slotEndMin = m + SLOT_MINUTES;
          return slotStartMin < beMin && slotEndMin > bsMin;
        });
        if (isBreak) continue;

        const slotKey = `${startAt}|${endAt}`;
        const day = shift.shift_date;
        const bySlot = freeTrainerSetByDateSlotKey.get(day) ?? new Map<string, Set<string>>();
        const set = bySlot.get(slotKey) ?? new Set<string>();
        set.add(shift.trainer_id);
        bySlot.set(slotKey, set);
        freeTrainerSetByDateSlotKey.set(day, bySlot);

        const seBySlot = startEndByDateSlotKey.get(day) ?? new Map<string, { start_at: string; end_at: string }>();
        if (!seBySlot.has(slotKey)) seBySlot.set(slotKey, { start_at: startAt, end_at: endAt });
        startEndByDateSlotKey.set(day, seBySlot);
      }
      // shift がある日を 0 として保持（後段で上書き）
      if (!countByDate.has(shift.shift_date)) countByDate.set(shift.shift_date, 0);
    }

    // dayごとに「予約可能な時間枠数」を算出（capacity > used の枠だけ数える）
    for (const [day, slotMap] of freeTrainerSetByDateSlotKey.entries()) {
      const seBySlot = startEndByDateSlotKey.get(day) ?? new Map();
      const unassigned = unassignedByDate.get(day) ?? [];
      let availableSlotCount = 0;
      for (const [slotKey, trainerSet] of slotMap.entries()) {
        const se = seBySlot.get(slotKey);
        if (!se) continue;
        const slotStartMs = DateTime.fromISO(se.start_at).toMillis();
        const slotEndMs = DateTime.fromISO(se.end_at).toMillis();
        const used = unassigned.reduce(
          (acc, r) => acc + (overlapsMs(r.start, r.end, slotStartMs, slotEndMs) ? 1 : 0),
          0
        );
        const capacity = trainerSet.size;
        if (capacity > used) availableSlotCount += 1;
      }
      countByDate.set(day, availableSlotCount);
    }

    // 要件例に合わせ、月内すべての日付を返す（shiftなしの日は 0）
    const daysInMonth = monthStartLocal.daysInMonth;
    const dates: DateCount[] = Array.from({ length: daysInMonth }, (_, i) => {
      const d = monthStartLocal.plus({ days: i }).toISODate()!;
      const count = countByDate.get(d) ?? 0;
      return { date: d, count };
    });
    // 締切（前日HH:MM）を過ぎた日は count=0 扱い
    const dates2 = dates.map((d) => {
      const cutoff = DateTime.fromISO(
        `${d.date}T${String(cutoffParts.h).padStart(2, "0")}:${String(cutoffParts.m).padStart(2, "0")}:00`,
        { zone }
      ).minus({ days: 1 });
      const allowed = now.toMillis() <= cutoff.toMillis();
      if (isApril2026Closed(d.date)) return { ...d, count: 0 };
      return allowed ? d : { ...d, count: 0 };
    });
    return jsonResponse({ dates: dates2 }, 200);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return jsonResponse(
      { error: "日別空き枠の取得中に予期しないエラーが発生しました", detail: message },
      500
    );
  }
}
