/**
 * 9月: こうへい除く全員が1時間オンラインMTG可能な日時を列挙
 * シフト（buildRows計画）+ DB予約 + trainer_events を考慮
 *
 * node --env-file=.env.local scripts/find-mtg-slots-2026-09.mjs
 */
import { createClient } from "@supabase/supabase-js";
import { buildRows } from "./sync-final-shifts-2026-09.mjs";

const MONTH = "2026-09";
const EXCLUDE = new Set(["こうへい"]);
const TZ = "Asia/Tokyo";
const SLOT_STEP_MIN = 30;
const MTG_DURATION_MIN = 60;
const SEARCH_START = 8 * 60; // 08:00
const SEARCH_END = 21 * 60; // 21:00開始まで（22:00終了）

function toMinutes(hhmm) {
  const [h, m] = String(hhmm).slice(0, 5).split(":").map(Number);
  return h * 60 + m;
}

function overlaps(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && aEnd > bStart;
}

function isoToLocalMinutes(iso, ymd) {
  const d = new Date(iso);
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = Object.fromEntries(fmt.formatToParts(d).map((p) => [p.type, p.value]));
  const date = `${parts.year}-${parts.month}-${parts.day}`;
  if (date !== ymd) return null;
  return Number(parts.hour) * 60 + Number(parts.minute);
}

function isoEndMinutes(iso, ymd, startMin) {
  const endMin = isoToLocalMinutes(iso, ymd);
  if (endMin == null) {
    // 日跨ぎ: 当日分は start から 24:00 まで busy とみなす
    return 24 * 60;
  }
  if (endMin <= startMin) return endMin + 24 * 60;
  return endMin;
}

function formatRange(startMin, endMin) {
  const fmt = (m) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  return `${fmt(startMin)}-${fmt(endMin)}`;
}

function dayOfWeek(ymd) {
  const [y, m, d] = ymd.split("-").map(Number);
  return ["日", "月", "火", "水", "木", "金", "土"][new Date(y, m - 1, d).getDay()];
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("DB未接続");
    process.exit(1);
  }

  const supabase = createClient(url, key, { auth: { persistSession: false } });

  const planRows = buildRows().filter((r) => !EXCLUDE.has(r.trainer_name));
  const targetNames = [...new Set(planRows.map((r) => r.trainer_name))].sort();

  const { data: trainers } = await supabase
    .from("trainers")
    .select("id, display_name")
    .in("display_name", targetNames);
  const trainerIdByName = Object.fromEntries((trainers ?? []).map((t) => [t.display_name, t.id]));
  const trainerNameById = Object.fromEntries((trainers ?? []).map((t) => [t.id, t.display_name]));
  const trainerIds = targetNames.map((n) => trainerIdByName[n]).filter(Boolean);

  // DBシフト（draft含む・休憩ブロック除外）で計画を上書き補完
  const { data: dbShifts } = await supabase
    .from("trainer_shifts")
    .select("trainer_id, shift_date, start_local, end_local, status, is_break")
    .gte("shift_date", `${MONTH}-01`)
    .lte("shift_date", `${MONTH}-30`)
    .in("trainer_id", trainerIds)
    .neq("status", "draft")
    .eq("is_break", false);

  const useDbShifts = (dbShifts ?? []).length > 0;
  const shiftSource = useDbShifts ? "db_confirmed" : "buildRows_plan";

  const shiftRows = useDbShifts
    ? (dbShifts ?? []).map((s) => ({
        trainer_name: trainerNameById[s.trainer_id],
        shift_date: s.shift_date,
        start_local: s.start_local,
        end_local: s.end_local,
      }))
    : planRows;

  const busyByTrainerDay = new Map(); // key: name|date -> intervals[]

  function addBusy(name, date, startMin, endMin, kind) {
    if (!name || EXCLUDE.has(name)) return;
    const key = `${name}|${date}`;
    const list = busyByTrainerDay.get(key) ?? [];
    list.push({ startMin, endMin, kind });
    busyByTrainerDay.set(key, list);
  }

  for (const r of shiftRows) {
    if (!r.trainer_name || EXCLUDE.has(r.trainer_name)) continue;
    addBusy(r.trainer_name, r.shift_date, toMinutes(r.start_local), toMinutes(r.end_local), "shift");
  }

  const monthStart = `${MONTH}-01T00:00:00+09:00`;
  const monthEnd = `${MONTH}-30T23:59:59+09:00`;

  const { data: reservations } = await supabase
    .from("reservations")
    .select("trainer_id, start_at, end_at, status")
    .in("trainer_id", trainerIds)
    .gte("start_at", monthStart)
    .lte("start_at", monthEnd);

  let reservationCount = 0;
  for (const r of reservations ?? []) {
    if (String(r.status).toLowerCase() === "cancelled") continue;
    const name = trainerNameById[r.trainer_id];
    if (!name) continue;
    const ymd = new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date(r.start_at));
    const startMin = isoToLocalMinutes(r.start_at, ymd);
    if (startMin == null) continue;
    const endMin = isoEndMinutes(r.end_at, ymd, startMin);
    addBusy(name, ymd, startMin, Math.min(endMin, 24 * 60), "reservation");
    reservationCount++;
  }

  const { data: events } = await supabase
    .from("trainer_events")
    .select("trainer_id, event_date, start_local, end_local, block_booking, title")
    .in("trainer_id", trainerIds)
    .gte("event_date", `${MONTH}-01`)
    .lte("event_date", `${MONTH}-30`);

  for (const e of events ?? []) {
    if (e.block_booking === false) continue;
    const name = trainerNameById[e.trainer_id];
    addBusy(name, e.event_date, toMinutes(e.start_local), toMinutes(e.end_local), "event");
  }

  function isFree(name, date, slotStart, slotEnd) {
    const key = `${name}|${date}`;
    const busy = busyByTrainerDay.get(key) ?? [];
    return !busy.some((b) => overlaps(slotStart, slotEnd, b.startMin, b.endMin));
  }

  const slots = [];
  for (let day = 1; day <= 30; day++) {
    const ymd = `${MONTH}-${String(day).padStart(2, "0")}`;
    for (let start = SEARCH_START; start + MTG_DURATION_MIN <= SEARCH_END + 60; start += SLOT_STEP_MIN) {
      if (start + MTG_DURATION_MIN > 22 * 60) break;
      const end = start + MTG_DURATION_MIN;
      const allFree = targetNames.every((name) => isFree(name, ymd, start, end));
      if (allFree) {
        slots.push({
          date: ymd,
          dow: dayOfWeek(ymd),
          time: formatRange(start, end),
          startMin: start,
        });
      }
    }
  }

  // 連続スロットをマージ（同じ日で隣接する30分刻み）
  const merged = [];
  for (const ymd of [...new Set(slots.map((s) => s.date))]) {
    const daySlots = slots.filter((s) => s.date === ymd).sort((a, b) => a.startMin - b.startMin);
    let cur = null;
    for (const s of daySlots) {
      if (!cur) {
        cur = { ...s };
        continue;
      }
      if (s.startMin <= cur.startMin + MTG_DURATION_MIN) {
        // extend if overlapping hour windows
        const curEnd = cur.startMin + MTG_DURATION_MIN;
        if (s.startMin < curEnd) continue;
      }
      merged.push(cur);
      cur = { ...s };
    }
    if (cur) merged.push(cur);
  }

  // 日付ごとにグループ化して見やすく
  const byDate = {};
  for (const s of slots) {
    const key = `${s.date} (${s.dow})`;
    if (!byDate[key]) byDate[key] = [];
    if (!byDate[key].includes(s.time)) byDate[key].push(s.time);
  }

  // 重複除去: 同じ1時間枠は1つ（30分刻みで複数ヒットするのでユニーク化）
  const uniqueSlots = [];
  const seen = new Set();
  for (const s of slots) {
    const k = `${s.date}|${s.time}`;
    if (seen.has(k)) continue;
    seen.add(k);
    uniqueSlots.push({ date: s.date, dow: s.dow, time: s.time });
  }

  console.log(
    JSON.stringify(
      {
        month: MONTH,
        exclude: [...EXCLUDE],
        targetTrainers: targetNames,
        shiftSource,
        reservationCount,
        searchWindow: "08:00-22:00 (1時間枠)",
        totalSlotOptions: uniqueSlots.length,
        slots: uniqueSlots,
        byDate,
      },
      null,
      2,
    ),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
