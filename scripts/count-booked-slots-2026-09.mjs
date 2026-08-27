/**
 * 9月 店舗別 予約埋まり枠数（30分枠ベース）
 * node --env-file=.env.local scripts/count-booked-slots-2026-09.mjs
 */
import { createClient } from "@supabase/supabase-js";
import { buildRows } from "./sync-final-shifts-2026-09.mjs";

const MONTH = "2026-09";
const STORES = ["恵比寿", "上野", "新宿", "桜木町"];
const SINGLE_BOOTH = new Set(["恵比寿", "新宿"]);
const SLOT_MIN = 30;
const TZ = "Asia/Tokyo";

function toMinutes(hhmm) {
  const [h, m] = String(hhmm).slice(0, 5).split(":").map(Number);
  return h * 60 + m;
}

function overlaps(a0, a1, b0, b1) {
  return a0 < b1 && a1 > b0;
}

function isoToLocalRange(isoStart, isoEnd, ymd) {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = (iso) => Object.fromEntries(fmt.formatToParts(new Date(iso)).map((p) => [p.type, p.value]));
  const s = parts(isoStart);
  const e = parts(isoEnd);
  const sDate = `${s.year}-${s.month}-${s.day}`;
  const eDate = `${e.year}-${e.month}-${e.day}`;
  if (sDate !== ymd && eDate !== ymd) return null;
  const startMin = sDate === ymd ? Number(s.hour) * 60 + Number(s.minute) : 0;
  let endMin = eDate === ymd ? Number(e.hour) * 60 + Number(e.minute) : 24 * 60;
  if (endMin <= startMin && eDate > sDate) endMin = 24 * 60;
  return { startMin, endMin };
}

function totalCapacitySlots(shiftRows) {
  const byStoreDate = new Map();
  for (const r of shiftRows) {
    const k = `${r.store_name}|${r.shift_date}`;
    if (!byStoreDate.has(k)) byStoreDate.set(k, []);
    byStoreDate.get(k).push(r);
  }
  const byStore = new Map(STORES.map((s) => [s, 0]));
  for (const [k, dayRows] of byStoreDate) {
    const [store] = k.split("|");
    if (!STORES.includes(store)) continue;
    for (let t = 540; t < 1320; t += SLOT_MIN) {
      let cap = 0;
      for (const r of dayRows) {
        const s = toMinutes(r.start_local);
        const e = toMinutes(r.end_local);
        if (s <= t && t + SLOT_MIN <= e) cap++;
      }
      if (SINGLE_BOOTH.has(store)) cap = cap > 0 ? 1 : 0;
      byStore.set(store, (byStore.get(store) ?? 0) + cap);
    }
  }
  return Object.fromEntries(byStore);
}

function filledSlotsByStore(shiftRows, reservations, storeIdToName) {
  const byStoreDate = new Map();
  for (const r of shiftRows) {
    const k = `${r.store_name}|${r.shift_date}`;
    if (!byStoreDate.has(k)) byStoreDate.set(k, []);
    byStoreDate.get(k).push(r);
  }

  const resByStoreDate = new Map();
  for (const r of reservations) {
    const store = storeIdToName[r.store_id];
    if (!store || !STORES.includes(store)) continue;
    const ymd = new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date(r.start_at));
    const range = isoToLocalRange(r.start_at, r.end_at, ymd);
    if (!range) continue;
    const k = `${store}|${ymd}`;
    const list = resByStoreDate.get(k) ?? [];
    list.push({ ...range, trainer_id: r.trainer_id });
    resByStoreDate.set(k, list);
  }

  const filled = new Map(STORES.map((s) => [s, 0]));
  const reservationCount = new Map(STORES.map((s) => [s, 0]));

  for (const r of reservations) {
    const store = storeIdToName[r.store_id];
    if (store && STORES.includes(store)) {
      reservationCount.set(store, (reservationCount.get(store) ?? 0) + 1);
    }
  }

  for (const [k, dayRows] of byStoreDate) {
    const [store, ymd] = k.split("|");
    const dayRes = resByStoreDate.get(k) ?? [];

    for (let t = 540; t < 1320; t += SLOT_MIN) {
      let cap = 0;
      const trainersAtSlot = new Set();
      for (const r of dayRows) {
        const s = toMinutes(r.start_local);
        const e = toMinutes(r.end_local);
        if (s <= t && t + SLOT_MIN <= e) {
          cap++;
          if (r.trainer_id) trainersAtSlot.add(r.trainer_id);
        }
      }
      if (cap === 0) continue;
      if (SINGLE_BOOTH.has(store)) cap = 1;

      let booked = 0;
      for (const res of dayRes) {
        if (!overlaps(t, t + SLOT_MIN, res.startMin, res.endMin)) continue;
        if (SINGLE_BOOTH.has(store)) {
          booked = 1;
          break;
        }
        if (res.trainer_id && trainersAtSlot.has(res.trainer_id)) booked++;
        else if (!res.trainer_id) booked++;
      }
      filled.set(store, (filled.get(store) ?? 0) + Math.min(cap, booked));
    }
  }

  return {
    filled: Object.fromEntries(filled),
    reservationCount: Object.fromEntries(reservationCount),
  };
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("DB未接続");
    process.exit(1);
  }

  const supabase = createClient(url, key, { auth: { persistSession: false } });

  const { data: storeRows } = await supabase.from("stores").select("id, name").in("name", STORES);
  const storeIdToName = Object.fromEntries((storeRows ?? []).map((s) => [s.id, s.name]));
  const storeNameToId = Object.fromEntries((storeRows ?? []).map((s) => [s.name, s.id]));

  const { data: dbShifts } = await supabase
    .from("trainer_shifts")
    .select("trainer_id, store_id, shift_date, start_local, end_local, status, is_break")
    .gte("shift_date", `${MONTH}-01`)
    .lte("shift_date", `${MONTH}-30`)
    .neq("status", "draft")
    .eq("is_break", false);

  const { data: trainers } = await supabase.from("trainers").select("id, display_name");
  const trainerNameById = Object.fromEntries((trainers ?? []).map((t) => [t.id, t.display_name]));

  const useDb = (dbShifts ?? []).length > 0;
  const shiftRows = useDb
    ? (dbShifts ?? []).map((s) => ({
        shift_date: s.shift_date,
        start_local: s.start_local,
        end_local: s.end_local,
        store_name: storeIdToName[s.store_id],
        trainer_id: s.trainer_id,
        trainer_name: trainerNameById[s.trainer_id],
      }))
    : buildRows().map((r) => ({
        ...r,
        trainer_id: null,
      }));

  const monthStart = `${MONTH}-01T00:00:00+09:00`;
  const monthEnd = `${MONTH}-30T23:59:59+09:00`;

  let { data: reservations, error } = await supabase
    .from("reservations")
    .select("store_id, trainer_id, start_at, end_at, status, blocks_capacity")
    .gte("start_at", monthStart)
    .lte("start_at", monthEnd);

  if (error?.message?.match(/blocks_capacity/i)) {
    const second = await supabase
      .from("reservations")
      .select("store_id, trainer_id, start_at, end_at, status")
      .gte("start_at", monthStart)
      .lte("start_at", monthEnd);
    reservations = second.data;
  }

  const active = (reservations ?? []).filter(
    (r) => String(r.status).toLowerCase() !== "cancelled" && r.blocks_capacity !== false,
  );

  const totalCap = totalCapacitySlots(shiftRows);
  const { filled, reservationCount } = filledSlotsByStore(shiftRows, active, storeIdToName);

  const byStore = STORES.map((name) => {
    const cap = totalCap[name] ?? 0;
    const book = filled[name] ?? 0;
    return {
      store: name,
      totalSlots: cap,
      bookedSlots: book,
      availableSlots: cap - book,
      fillRatePct: cap ? Math.round((book / cap) * 1000) / 10 : null,
      reservationCount: reservationCount[name] ?? 0,
    };
  });

  const grand = {
    totalSlots: byStore.reduce((s, x) => s + x.totalSlots, 0),
    bookedSlots: byStore.reduce((s, x) => s + x.bookedSlots, 0),
    reservationCount: byStore.reduce((s, x) => s + x.reservationCount, 0),
  };

  console.log(
    JSON.stringify(
      {
        month: MONTH,
        shiftSource: useDb ? "db_confirmed" : "buildRows_plan",
        slotUnit: "30分",
        note: "bookedSlots=シフト内で予約が入っている30分枠数（店舗キャパ上限内）。新宿・恵比寿は同時1枠。",
        stores: byStore,
        total: {
          ...grand,
          fillRatePct: grand.totalSlots ? Math.round((grand.bookedSlots / grand.totalSlots) * 1000) / 10 : null,
        },
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
