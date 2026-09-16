import { DateTime } from "luxon";

export type ShiftForOnShift = {
  id: string;
  trainer_id: string;
  start_local: string;
  end_local: string;
  is_break?: boolean | null;
};

export function parseLocalTimeToMinutes(t: string): number {
  const [hh, mm] = String(t ?? "").split(":");
  const h = Number(hh);
  const m = Number(mm ?? 0);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return NaN;
  return h * 60 + m;
}

function rangesOverlap(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && aEnd > bStart;
}

/** その時間枠にシフトが入っているトレーナー（休憩中は除く。予約の有無は見ない） */
export function trainerIdsOnShiftForSlot(params: {
  shifts: ShiftForOnShift[];
  breaksByShiftId: Map<string, Array<{ start_time: string; end_time: string }>>;
  slotStartMin: number;
  slotEndMin: number;
}): string[] {
  const { shifts, breaksByShiftId, slotStartMin, slotEndMin } = params;
  if (!(slotEndMin > slotStartMin) || Number.isNaN(slotStartMin) || Number.isNaN(slotEndMin)) return [];

  const ids: string[] = [];
  const seen = new Set<string>();
  for (const shift of shifts) {
    if (shift.is_break) continue;
    const trainerId = String(shift.trainer_id ?? "").trim();
    if (!trainerId || seen.has(trainerId)) continue;

    const shiftStart = parseLocalTimeToMinutes(shift.start_local);
    const shiftEnd = parseLocalTimeToMinutes(shift.end_local);
    if (!(shiftEnd > shiftStart) || Number.isNaN(shiftStart) || Number.isNaN(shiftEnd)) continue;
    if (slotStartMin < shiftStart || slotEndMin > shiftEnd) continue;

    const breaks = breaksByShiftId.get(shift.id) ?? [];
    const onBreak = breaks.some((b) => {
      const bs = parseLocalTimeToMinutes(String(b.start_time));
      const be = parseLocalTimeToMinutes(String(b.end_time));
      if (!Number.isFinite(bs) || !Number.isFinite(be) || be <= bs) return false;
      return rangesOverlap(slotStartMin, slotEndMin, bs, be);
    });
    if (onBreak) continue;

    seen.add(trainerId);
    ids.push(trainerId);
  }
  return ids;
}

export function formatOnShiftTrainerNames(trainers: Array<{ display_name: string }>): string {
  return trainers
    .map((t) => String(t.display_name ?? "").trim())
    .filter(Boolean)
    .join(" / ");
}

async function loadShiftsForStoreDate(supabase: any, storeId: string, ymd: string): Promise<ShiftForOnShift[]> {
  const mapA = (rows: any[]): ShiftForOnShift[] =>
    (rows ?? []).map((s) => ({
      id: String(s.id),
      trainer_id: String(s.trainer_id),
      start_local: String(s.start_local ?? s.start_time ?? ""),
      end_local: String(s.end_local ?? s.end_time ?? ""),
      is_break: s.is_break ?? null,
    }));

  const first = await supabase
    .from("trainer_shifts")
    .select("id, trainer_id, start_local, end_local, status, is_break")
    .eq("store_id", storeId)
    .eq("shift_date", ymd)
    .neq("status", "draft");
  if (!first.error && Array.isArray(first.data) && first.data.length > 0) {
    return mapA(first.data);
  }

  const second = await supabase
    .from("trainer_shifts")
    .select("id, trainer_id, start_time, end_time, status, is_break")
    .eq("store_id", storeId)
    .eq("date", ymd)
    .neq("status", "draft");
  if (!second.error) return mapA(second.data ?? []);
  return [];
}

async function loadBreaksByShiftId(supabase: any, shiftIds: string[]): Promise<Map<string, Array<{ start_time: string; end_time: string }>>> {
  const map = new Map<string, Array<{ start_time: string; end_time: string }>>();
  if (shiftIds.length === 0) return map;
  const { data, error } = await supabase.from("trainer_shift_breaks").select("shift_id, start_time, end_time").in("shift_id", shiftIds);
  if (error) return map;
  for (const b of data ?? []) {
    const id = String((b as any).shift_id ?? "");
    if (!id) continue;
    const arr = map.get(id) ?? [];
    arr.push({ start_time: String((b as any).start_time ?? ""), end_time: String((b as any).end_time ?? "") });
    map.set(id, arr);
  }
  return map;
}

/** 予約枠ごとに、その時間の出勤トレーナー名を返す（休憩中は除く） */
export async function fetchOnShiftTrainerNamesBySlots(
  supabase: any,
  slots: Array<{ store_id: string; start_at: string; end_at: string }>,
  zoneByStoreId?: Map<string, string>
): Promise<string[]> {
  const out = slots.map(() => "");
  if (slots.length === 0) return out;

  const storeIds = Array.from(new Set(slots.map((s) => String(s.store_id ?? "")).filter(Boolean)));
  const zones = new Map<string, string>(zoneByStoreId ?? []);
  if (storeIds.length > 0) {
    const missing = storeIds.filter((id) => !zones.has(id));
    if (missing.length > 0) {
      const { data } = await supabase.from("stores").select("id, timezone").in("id", missing);
      for (const s of data ?? []) {
        zones.set(String(s.id), String(s.timezone ?? "").trim() || "Asia/Tokyo");
      }
    }
  }

  type DayKey = string;
  const byDay = new Map<DayKey, { storeId: string; ymd: string; zone: string }>();
  const slotMeta = slots.map((slot) => {
    const storeId = String(slot.store_id ?? "");
    const zone = zones.get(storeId) || "Asia/Tokyo";
    const start = DateTime.fromISO(slot.start_at).setZone(zone);
    const end = DateTime.fromISO(slot.end_at).setZone(zone);
    const ymd = start.toISODate() || "";
    const key = `${storeId}|${ymd}`;
    if (storeId && ymd && !byDay.has(key)) byDay.set(key, { storeId, ymd, zone });
    return {
      storeId,
      zone,
      ymd,
      startMin: start.hour * 60 + start.minute,
      endMin: end.hour * 60 + end.minute,
    };
  });

  const shiftsByDay = new Map<DayKey, ShiftForOnShift[]>();
  const breaksByDay = new Map<DayKey, Map<string, Array<{ start_time: string; end_time: string }>>>();
  const allTrainerIds = new Set<string>();
  for (const [key, day] of byDay) {
    const shifts = await loadShiftsForStoreDate(supabase, day.storeId, day.ymd);
    shiftsByDay.set(key, shifts);
    const breaks = await loadBreaksByShiftId(
      supabase,
      shifts.map((s) => s.id)
    );
    breaksByDay.set(key, breaks);
    for (const s of shifts) if (s.trainer_id) allTrainerIds.add(s.trainer_id);
  }

  const nameById = new Map<string, string>();
  if (allTrainerIds.size > 0) {
    const { data } = await supabase.from("trainers").select("id, display_name").in("id", Array.from(allTrainerIds));
    for (const t of data ?? []) {
      nameById.set(String(t.id), String(t.display_name ?? "").trim());
    }
  }

  return slotMeta.map((meta, i) => {
    if (!meta.storeId || !meta.ymd) return out[i];
    const key = `${meta.storeId}|${meta.ymd}`;
    const ids = trainerIdsOnShiftForSlot({
      shifts: shiftsByDay.get(key) ?? [],
      breaksByShiftId: breaksByDay.get(key) ?? new Map(),
      slotStartMin: meta.startMin,
      slotEndMin: meta.endMin,
    });
    const trainers = ids
      .map((id) => ({ display_name: nameById.get(id) ?? "" }))
      .filter((t) => t.display_name)
      .sort((a, b) => a.display_name.localeCompare(b.display_name, "ja"));
    return formatOnShiftTrainerNames(trainers);
  });
}
