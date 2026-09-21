/**
 * 9月 開放枠（確定シフトベース30分コマ）と予約率
 * node --env-file=.env.local scripts/report-sep-open-slots-booking-rate.mjs
 */
import { createClient } from "@supabase/supabase-js";
import { DateTime } from "luxon";
import { fetchAllChecked } from "./lib/supabaseFetchAll.mjs";

const TZ = "Asia/Tokyo";
const MONTH = "2026-09";
const STORES = ["恵比寿", "上野", "新宿", "桜木町", "福岡"];
const SINGLE_BOOTH = new Set(["恵比寿", "新宿"]);

function toMinutes(hhmm) {
  const [hh, mm] = String(hhmm).slice(0, 5).split(":").map(Number);
  return hh * 60 + mm;
}

function effectiveOpenSlotsForDay(storeName, dayRows) {
  let daySlots = 0;
  for (let t = 540; t < 1320; t += 30) {
    let cap = 0;
    for (const r of dayRows) {
      const s = toMinutes(r.start_local);
      const e = toMinutes(r.end_local);
      if (s <= t && t + 30 <= e) cap++;
    }
    if (SINGLE_BOOTH.has(storeName)) cap = cap > 0 ? 1 : 0;
    daySlots += cap;
  }
  return daySlots;
}

function reservationSlotUnits(startIso, endIso) {
  const start = DateTime.fromISO(startIso).setZone(TZ);
  const end = DateTime.fromISO(endIso).setZone(TZ);
  if (!start.isValid || !end.isValid || end <= start) return 0;
  const mins = end.diff(start, "minutes").minutes;
  return Math.max(1, Math.round(mins / 30));
}

function pct(n, d) {
  if (!d) return null;
  return Math.round((n / d) * 1000) / 10;
}

function inDayRange(shiftDate, fromDay, toDay) {
  const d = Number(shiftDate.slice(-2));
  return d >= fromDay && d <= toDay;
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("DB未接続");
    process.exit(1);
  }

  const supabase = createClient(url, key, { auth: { persistSession: false } });
  const monthStart = `${MONTH}-01T00:00:00+09:00`;
  const monthEnd = "2026-10-01T00:00:00+09:00";

  const storesResult = await fetchAllChecked(supabase, "stores", "id, name", undefined, "stores");
  const storeNameById = Object.fromEntries(storesResult.rows.map((s) => [s.id, s.name]));
  const storeIdByName = Object.fromEntries(storesResult.rows.map((s) => [s.name, s.id]));

  const shiftsResult = await fetchAllChecked(
    supabase,
    "trainer_shifts",
    "shift_date, start_local, end_local, store_id, status, is_break",
    (q) => q.gte("shift_date", `${MONTH}-01`).lte("shift_date", `${MONTH}-30`).neq("status", "draft").eq("is_break", false),
    "shifts.sep",
  );

  const resResult = await fetchAllChecked(
    supabase,
    "reservations",
    "id, store_id, start_at, end_at, status",
    (q) => q.gte("start_at", monthStart).lt("start_at", monthEnd).neq("status", "cancelled"),
    "reservations.sep",
  );

  const shiftRows = shiftsResult.rows
    .map((s) => ({
      shift_date: s.shift_date,
      start_local: s.start_local,
      end_local: s.end_local,
      store_name: storeNameById[s.store_id],
    }))
    .filter((r) => r.store_name);

  const byStoreDate = new Map();
  for (const r of shiftRows) {
    const k = `${r.store_name}|${r.shift_date}`;
    if (!byStoreDate.has(k)) byStoreDate.set(k, []);
    byStoreDate.get(k).push(r);
  }

  function openSlotsForRange(fromDay, toDay, storeFilter = null) {
    const byStore = Object.fromEntries(STORES.map((n) => [n, 0]));
    let total = 0;
    for (const [k, dayRows] of byStoreDate) {
      const [store, date] = k.split("|");
      if (storeFilter && store !== storeFilter) continue;
      if (!inDayRange(date, fromDay, toDay)) continue;
      if (!STORES.includes(store)) continue;
      const slots = effectiveOpenSlotsForDay(store, dayRows);
      byStore[store] = (byStore[store] ?? 0) + slots;
      total += slots;
    }
    return { total, byStore };
  }

  function bookedForRange(fromDay, toDay, storeFilter = null) {
    const byStore = Object.fromEntries(STORES.map((n) => [n, { sessions: 0, slotUnits: 0 }]));
    let totalSessions = 0;
    let totalSlots = 0;
    for (const r of resResult.rows) {
      const store = storeNameById[r.store_id];
      if (!store || !STORES.includes(store)) continue;
      if (storeFilter && store !== storeFilter) continue;
      const day = DateTime.fromISO(r.start_at).setZone(TZ).toISODate();
      if (!day?.startsWith(MONTH)) continue;
      const dayNum = Number(day.slice(-2));
      if (dayNum < fromDay || dayNum > toDay) continue;
      const units = reservationSlotUnits(r.start_at, r.end_at);
      byStore[store].sessions += 1;
      byStore[store].slotUnits += units;
      totalSessions += 1;
      totalSlots += units;
    }
    return { totalSessions, totalSlotUnits: totalSlots, byStore };
  }

  function buildPeriod(fromDay, toDay, label) {
    const open = openSlotsForRange(fromDay, toDay);
    const booked = bookedForRange(fromDay, toDay);
    const stores = STORES.map((name) => ({
      store: name,
      openSlots: open.byStore[name] ?? 0,
      bookedSessions: booked.byStore[name]?.sessions ?? 0,
      bookedSlotUnits: booked.byStore[name]?.slotUnits ?? 0,
      bookingRateBySlots: pct(booked.byStore[name]?.slotUnits ?? 0, open.byStore[name] ?? 0),
      bookingRateBySessions: pct(booked.byStore[name]?.sessions ?? 0, open.byStore[name] ?? 0),
    }));
    return {
      label,
      from: `${MONTH}-${String(fromDay).padStart(2, "0")}`,
      to: `${MONTH}-${String(toDay).padStart(2, "0")}`,
      openSlotsTotal: open.total,
      bookedSessionsTotal: booked.totalSessions,
      bookedSlotUnitsTotal: booked.totalSlotUnits,
      bookingRateBySlots: pct(booked.totalSlotUnits, open.total),
      bookingRateBySessions: pct(booked.totalSessions, open.total),
      stores,
    };
  }

  const asOf = DateTime.now().setZone(TZ).toISO();
  const payload = {
    asOfJst: asOf,
    note: "開放枠=確定シフト（draft除外）から算出した30分予約可能コマ。予約率=予約コマ数÷開放枠（30分単位）。上野・桜木町は同日複数トレーナーで同時枠加算。",
    periods: [buildPeriod(1, 20, "9/1〜9/20"), buildPeriod(1, 30, "9/1〜9/30")],
  };

  console.log(JSON.stringify(payload, null, 2));

  console.log("\n--- 9/1〜9/20 ---");
  printTable(payload.periods[0]);
  console.log("\n--- 9/1〜9/30 ---");
  printTable(payload.periods[1]);
}

function printTable(p) {
  console.log(`開放枠合計: ${p.openSlotsTotal} | 予約コマ: ${p.bookedSlotUnitsTotal} | 予約率: ${p.bookingRateBySlots ?? "—"}%`);
  console.log(`（参考）予約件数: ${p.bookedSessionsTotal} | 件数÷開放枠: ${p.bookingRateBySessions ?? "—"}%`);
  console.log("| 店舗 | 開放枠 | 予約コマ | 予約率 | 予約件数 |");
  console.log("|------|------:|--------:|-------:|--------:|");
  for (const s of p.stores) {
    if (s.openSlots === 0 && s.bookedSlotUnits === 0) continue;
    console.log(
      `| ${s.store} | ${s.openSlots} | ${s.bookedSlotUnits} | ${s.bookingRateBySlots ?? "—"}% | ${s.bookedSessions} |`,
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
