/**
 * ゆうと・たけはる・ともきの30分オンライン面談
 * 2026-10-16〜22（JST）で3人ともシフト内かつ、店舗の未割当予約を残しても抜けられる開始時刻
 * node scripts/find-oct16-22-online-mtg.mjs
 */
import { createClient } from "@supabase/supabase-js";
import { fetchAllChecked } from "./lib/supabaseFetchAll.mjs";

const NAMES = ["ゆうと", "たけはる", "ともき"];
const RANGE_START = "2026-10-16";
const RANGE_END = "2026-10-22";
const RANGE_END_EXCLUSIVE = "2026-10-23T00:00:00+09:00";
const RANGE_START_ISO = "2026-10-16T00:00:00+09:00";
const TZ = "Asia/Tokyo";
const SLOT_STEP_MIN = 30;
const MTG_DURATION_MIN = 30;
const SEARCH_START = 8 * 60;
const SEARCH_END = 21 * 60;

function toMinutes(hhmm) {
  const [h, m] = String(hhmm).slice(0, 5).split(":").map(Number);
  return h * 60 + m;
}

function covers(startMin, endMin, slotStart, slotEnd) {
  return startMin <= slotStart && endMin >= slotEnd;
}

function overlaps(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && bStart < aEnd;
}

function fmtHm(min) {
  return `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
}

function formatRange(startMin, endMin) {
  return `${fmtHm(startMin)}-${fmtHm(endMin)}`;
}

function dayOfWeek(ymd) {
  const [y, m, d] = ymd.split("-").map(Number);
  return ["日", "月", "火", "水", "木", "金", "土"][new Date(y, m - 1, d).getDay()];
}

function eachDate() {
  const out = [];
  const start = new Date(`${RANGE_START}T00:00:00+09:00`);
  const end = new Date(`${RANGE_END}T00:00:00+09:00`);
  for (let t = start.getTime(); t <= end.getTime(); t += 24 * 60 * 60 * 1000) {
    out.push(new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date(t)));
  }
  return out;
}

function isoToJstParts(iso) {
  const d = new Date(iso);
  const ymd = new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(d);
  const hm = new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
  return { ymd, min: toMinutes(hm) };
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("DB未接続");
    process.exit(1);
  }
  const supabase = createClient(url, key, { auth: { persistSession: false } });

  const trainersResult = await fetchAllChecked(
    supabase,
    "trainers",
    "id, display_name, is_active",
    (q) => q.in("display_name", NAMES),
    "trainers.mtg3",
  );
  const named = trainersResult.rows.filter((t) => NAMES.includes(t.display_name));
  const trainers = [];
  for (const name of NAMES) {
    const matches = named.filter((t) => t.display_name === name);
    const active = matches.filter((t) => t.is_active);
    const chosen = active.length ? active : matches;
    if (!chosen.length) continue;
    if (chosen.length > 1) {
      throw new Error(`${name} が複数います: ${chosen.map((t) => t.id).join(", ")}`);
    }
    trainers.push(chosen[0]);
  }
  const missing = NAMES.filter((n) => !trainers.some((t) => t.display_name === n));
  if (missing.length) throw new Error(`未登録: ${missing.join(", ")}`);
  const nameById = Object.fromEntries(trainers.map((t) => [t.id, t.display_name]));
  const idByName = Object.fromEntries(trainers.map((t) => [t.display_name, t.id]));
  const trainerIds = trainers.map((t) => t.id);

  const ownShifts = await fetchAllChecked(
    supabase,
    "trainer_shifts",
    "id, trainer_id, store_id, shift_date, start_local, end_local, status, is_break",
    (q) =>
      q
        .in("trainer_id", trainerIds)
        .gte("shift_date", RANGE_START)
        .lte("shift_date", RANGE_END)
        .neq("status", "draft")
        .eq("is_break", false),
    "trainer_shifts.oct16-22.own",
  );
  const storeIds = [...new Set(ownShifts.rows.map((s) => s.store_id).filter(Boolean))];
  const [storeRows, floorShifts] = await Promise.all([
    fetchAllChecked(supabase, "stores", "id, name", (q) => q.in("id", storeIds), "stores.mtg"),
    fetchAllChecked(
      supabase,
      "trainer_shifts",
      "id, trainer_id, store_id, shift_date, start_local, end_local, status, is_break",
      (q) =>
        q
          .in("store_id", storeIds)
          .gte("shift_date", RANGE_START)
          .lte("shift_date", RANGE_END)
          .neq("status", "draft")
          .eq("is_break", false),
      "trainer_shifts.oct16-22.floor",
    ),
  ]);
  const storeNameById = Object.fromEntries(storeRows.rows.map((s) => [s.id, s.name]));
  const floorTrainerIds = [...new Set(floorShifts.rows.map((s) => s.trainer_id))];
  const [reservationsResult, eventsResult] = await Promise.all([
    fetchAllChecked(
      supabase,
      "reservations",
      "trainer_id, store_id, start_at, end_at, status, blocks_capacity",
      (q) =>
        q
          .in("store_id", storeIds)
          .gte("start_at", RANGE_START_ISO)
          .lt("start_at", RANGE_END_EXCLUSIVE)
          .neq("status", "cancelled"),
      "reservations.oct16-22.stores",
    ),
    fetchAllChecked(
      supabase,
      "trainer_events",
      "trainer_id, event_date, start_local, end_local, block_booking",
      (q) => q.in("trainer_id", floorTrainerIds).gte("event_date", RANGE_START).lte("event_date", RANGE_END),
      "trainer_events.oct16-22.floor",
    ),
  ]);
  const shiftsResult = floorShifts;
  const shiftIds = shiftsResult.rows.map((s) => s.id);
  const breaksResult = shiftIds.length
    ? await fetchAllChecked(
        supabase,
        "trainer_shift_breaks",
        "shift_id, start_time, end_time",
        (q) => q.in("shift_id", shiftIds),
        "trainer_shift_breaks.oct16-22",
      )
    : { rows: [], count: 0 };
  const shiftById = Object.fromEntries(shiftsResult.rows.map((s) => [s.id, s]));

  function reservationWindow(r) {
    const start = isoToJstParts(r.start_at);
    const end = isoToJstParts(r.end_at);
    const endMin = end.ymd === start.ymd && end.min > start.min ? end.min : start.min + 30;
    return { ymd: start.ymd, startMin: start.min, endMin };
  }

  const ownByNameDate = new Map();
  for (const s of ownShifts.rows) {
    const name = nameById[s.trainer_id];
    const key = `${name}|${s.shift_date}`;
    const list = ownByNameDate.get(key) ?? [];
    list.push({
      startMin: toMinutes(s.start_local),
      endMin: toMinutes(s.end_local),
      storeId: s.store_id,
    });
    ownByNameDate.set(key, list);
  }

  const floorByStoreDate = new Map();
  for (const s of shiftsResult.rows) {
    const key = `${s.store_id}|${s.shift_date}`;
    const list = floorByStoreDate.get(key) ?? [];
    list.push({
      trainerId: s.trainer_id,
      startMin: toMinutes(s.start_local),
      endMin: toMinutes(s.end_local),
    });
    floorByStoreDate.set(key, list);
  }

  const personalBusy = new Map();
  function addBusy(trainerId, ymd, startMin, endMin) {
    if (!trainerId || !ymd) return;
    const key = `${trainerId}|${ymd}`;
    const list = personalBusy.get(key) ?? [];
    list.push({ startMin, endMin });
    personalBusy.set(key, list);
  }
  const unassignedByStoreDate = new Map();
  for (const r of reservationsResult.rows) {
    if (r.blocks_capacity === false) continue;
    const w = reservationWindow(r);
    if (!r.trainer_id) {
      const key = `${r.store_id}|${w.ymd}`;
      const list = unassignedByStoreDate.get(key) ?? [];
      list.push({ startMin: w.startMin, endMin: w.endMin });
      unassignedByStoreDate.set(key, list);
      continue;
    }
    addBusy(r.trainer_id, w.ymd, w.startMin, w.endMin);
  }
  for (const b of breaksResult.rows) {
    const shift = shiftById[b.shift_id];
    if (!shift) continue;
    addBusy(shift.trainer_id, shift.shift_date, toMinutes(b.start_time), toMinutes(b.end_time));
  }
  for (const e of eventsResult.rows) {
    if (e.block_booking === false) continue;
    addBusy(e.trainer_id, e.event_date, toMinutes(e.start_local), toMinutes(e.end_local));
  }

  function isPersonallyBusy(trainerId, ymd, start, end) {
    return (personalBusy.get(`${trainerId}|${ymd}`) ?? []).some((b) => overlaps(b.startMin, b.endMin, start, end));
  }

  function coveringShift(name, ymd, start, end) {
    return (ownByNameDate.get(`${name}|${ymd}`) ?? []).find((i) => covers(i.startMin, i.endMin, start, end)) ?? null;
  }

  function canLeave(name, ymd, start, end) {
    const shift = coveringShift(name, ymd, start, end);
    if (!shift) return { ok: false, reason: "shift" };
    const trainerId = idByName[name];
    if (isPersonallyBusy(trainerId, ymd, start, end)) return { ok: false, reason: "busy" };
    const others = (floorByStoreDate.get(`${shift.storeId}|${ymd}`) ?? []).filter(
      (s) =>
        s.trainerId !== trainerId &&
        covers(s.startMin, s.endMin, start, end) &&
        !isPersonallyBusy(s.trainerId, ymd, start, end),
    );
    const unassigned = (unassignedByStoreDate.get(`${shift.storeId}|${ymd}`) ?? []).filter((b) =>
      overlaps(b.startMin, b.endMin, start, end),
    ).length;
    const storeName = storeNameById[shift.storeId] ?? "";
    const cover = storeName === "新宿" ? (others.length > 0 ? 1 : 0) : others.length;
    if (cover < unassigned) {
      return { ok: false, reason: "store", store: storeName, unassigned };
    }
    return { ok: true, store: storeName };
  }

  const nowJst = new Date(new Date().toLocaleString("en-US", { timeZone: TZ }));
  const todayYmd = new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(nowJst);
  const nowMin = nowJst.getHours() * 60 + nowJst.getMinutes();

  const open = [];
  const booked = [];
  for (const ymd of eachDate()) {
    for (let start = SEARCH_START; start <= SEARCH_END; start += SLOT_STEP_MIN) {
      const end = start + MTG_DURATION_MIN;
      if (ymd < todayYmd) continue;
      if (ymd === todayYmd && start < nowMin) continue;
      const decisions = NAMES.map((name) => ({ name, ...canLeave(name, ymd, start, end) }));
      if (decisions.some((d) => d.reason === "shift")) continue;
      const held = decisions.filter((d) => !d.ok);
      const row = { date: ymd, dow: dayOfWeek(ymd), time: formatRange(start, end), startMin: start };
      if (held.length) booked.push({ ...row, held: held.map((d) => ({ name: d.name, reason: d.reason, store: d.store })) });
      else open.push(row);
    }
  }

  const byDate = {};
  for (const s of open) {
    const key = `${s.date} (${s.dow})`;
    if (!byDate[key]) byDate[key] = [];
    byDate[key].push(s.time);
  }

  const shiftSummary = {};
  for (const name of NAMES) {
    shiftSummary[name] = {};
    for (const ymd of eachDate()) {
      const intervals = ownByNameDate.get(`${name}|${ymd}`) ?? [];
      shiftSummary[name][ymd] = intervals
        .sort((a, b) => a.startMin - b.startMin)
        .map((i) => formatRange(i.startMin, i.endMin));
    }
  }

  console.log(
    JSON.stringify(
      {
        participants: NAMES.map((name) => ({
          name,
          id: idByName[name],
          active: trainers.find((t) => t.display_name === name)?.is_active ?? null,
        })),
        period: `${RANGE_START}〜${RANGE_END}`,
        duration: "30分",
        criteria: "3人ともシフト内。担当予約・休憩・予定がなく、店舗の未割当予約は残った人数で埋まる",
        searchWindow: "08:00-21:00開始",
        openCount: open.length,
        byDate,
        blockedWhileAllOnShift: booked,
        shiftSummary,
        fetched: {
          shifts: shiftsResult.count,
          reservations: reservationsResult.count,
          events: eventsResult.count,
          breaks: breaksResult.count,
        },
      },
      null,
      2,
    ),
  );

  console.log("\n--- 予約が入っていない30分 ---");
  if (!open.length) console.log("該当なし");
  for (const [label, times] of Object.entries(byDate)) {
    console.log(`\n### ${label}`);
    for (const t of times) console.log(`- ${t}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
