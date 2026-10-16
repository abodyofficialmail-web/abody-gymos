/**
 * ともき・ゆうと・ひろむの30分オンライン面談
 * 2026-10-16〜22（JST）で3人ともシフト内かつ、いま予約が入っていない開始時刻
 * node scripts/find-oct16-22-online-mtg.mjs
 */
import { createClient } from "@supabase/supabase-js";
import { fetchAllChecked } from "./lib/supabaseFetchAll.mjs";

const NAMES = ["ともき", "ゆうと", "ひろむ"];
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

  const [shiftsResult, reservationsResult, eventsResult] = await Promise.all([
    fetchAllChecked(
      supabase,
      "trainer_shifts",
      "id, trainer_id, shift_date, start_local, end_local, status, is_break",
      (q) =>
        q
          .in("trainer_id", trainerIds)
          .gte("shift_date", RANGE_START)
          .lte("shift_date", RANGE_END)
          .neq("status", "draft")
          .eq("is_break", false),
      "trainer_shifts.oct16-22",
    ),
    fetchAllChecked(
      supabase,
      "reservations",
      "trainer_id, start_at, end_at, status",
      (q) =>
        q
          .in("trainer_id", trainerIds)
          .gte("start_at", RANGE_START_ISO)
          .lt("start_at", RANGE_END_EXCLUSIVE)
          .neq("status", "cancelled"),
      "reservations.oct16-22",
    ),
    fetchAllChecked(
      supabase,
      "trainer_events",
      "trainer_id, event_date, start_local, end_local, title, block_booking",
      (q) => q.in("trainer_id", trainerIds).gte("event_date", RANGE_START).lte("event_date", RANGE_END),
      "trainer_events.oct16-22",
    ),
  ]);

  const yutoIds = named.filter((t) => t.display_name === "ゆうと").map((t) => t.id);
  const yutoDay = await fetchAllChecked(
    supabase,
    "reservations",
    "id, trainer_id, member_id, store_id, start_at, end_at, status, blocks_capacity, session_type",
    (q) =>
      q
        .in("trainer_id", yutoIds.length ? yutoIds : ["00000000-0000-0000-0000-000000000000"])
        .gte("start_at", "2026-10-18T00:00:00+09:00")
        .lt("start_at", "2026-10-19T00:00:00+09:00"),
    "reservations.yuto.oct18",
  );
  const tenAm = await fetchAllChecked(
    supabase,
    "reservations",
    "id, trainer_id, member_id, store_id, start_at, end_at, status, blocks_capacity, session_type",
    (q) =>
      q
        .gte("start_at", "2026-10-18T09:30:00+09:00")
        .lt("start_at", "2026-10-18T11:00:00+09:00")
        .neq("status", "cancelled"),
    "reservations.oct18.0930-1100",
  );
  const tenTrainerIds = [...new Set(tenAm.rows.map((r) => r.trainer_id).filter(Boolean))];
  const tenTrainers = tenTrainerIds.length
    ? await fetchAllChecked(
        supabase,
        "trainers",
        "id, display_name, is_active",
        (q) => q.in("id", tenTrainerIds),
        "trainers.oct18.morning",
      )
    : { rows: [] };
  const tenName = Object.fromEntries(tenTrainers.rows.map((t) => [t.id, t.display_name]));
  console.log(
    JSON.stringify(
      {
        yutoTrainers: named.filter((t) => t.display_name === "ゆうと"),
        chosenYutoId: idByName["ゆうと"],
        yutoOct18Reservations: yutoDay.rows.map((r) => ({
          ...r,
          jst: `${isoToJstParts(r.start_at).ymd} ${fmtHm(isoToJstParts(r.start_at).min)}-${fmtHm(isoToJstParts(r.end_at).min)}`,
        })),
        oct18_0930_1100: tenAm.rows.map((r) => ({
          trainer: tenName[r.trainer_id] ?? r.trainer_id,
          status: r.status,
          blocks_capacity: r.blocks_capacity,
          session_type: r.session_type,
          start_at: r.start_at,
          end_at: r.end_at,
          jst: `${fmtHm(isoToJstParts(r.start_at).min)}-${fmtHm(isoToJstParts(r.end_at).min)}`,
        })),
      },
      null,
      2,
    ),
  );

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

  const shiftsByNameDate = new Map();
  for (const s of shiftsResult.rows) {
    const name = nameById[s.trainer_id];
    const key = `${name}|${s.shift_date}`;
    const list = shiftsByNameDate.get(key) ?? [];
    list.push({ startMin: toMinutes(s.start_local), endMin: toMinutes(s.end_local) });
    shiftsByNameDate.set(key, list);
  }

  const busyByNameDate = new Map();
  for (const r of reservationsResult.rows) {
    const name = nameById[r.trainer_id];
    if (!name) continue;
    const start = isoToJstParts(r.start_at);
    const end = isoToJstParts(r.end_at);
    const endMin = end.ymd === start.ymd && end.min > start.min ? end.min : start.min + 30;
    const key = `${name}|${start.ymd}`;
    const list = busyByNameDate.get(key) ?? [];
    list.push({ startMin: start.min, endMin, kind: "reservation" });
    busyByNameDate.set(key, list);
  }
  for (const b of breaksResult.rows) {
    const shift = shiftById[b.shift_id];
    const name = shift ? nameById[shift.trainer_id] : null;
    if (!name || !shift) continue;
    const key = `${name}|${shift.shift_date}`;
    const list = busyByNameDate.get(key) ?? [];
    list.push({
      startMin: toMinutes(b.start_time),
      endMin: toMinutes(b.end_time),
      kind: "break",
    });
    busyByNameDate.set(key, list);
  }
  for (const e of eventsResult.rows) {
    if (e.block_booking === false) continue;
    const name = nameById[e.trainer_id];
    const key = `${name}|${e.event_date}`;
    const list = busyByNameDate.get(key) ?? [];
    list.push({
      startMin: toMinutes(e.start_local),
      endMin: toMinutes(e.end_local),
      kind: "event",
    });
    busyByNameDate.set(key, list);
  }

  function onShift(name, ymd, start, end) {
    return (shiftsByNameDate.get(`${name}|${ymd}`) ?? []).some((i) => covers(i.startMin, i.endMin, start, end));
  }

  function busyHits(ymd, start, end) {
    const hits = [];
    for (const name of NAMES) {
      for (const b of busyByNameDate.get(`${name}|${ymd}`) ?? []) {
        if (overlaps(b.startMin, b.endMin, start, end)) hits.push({ name, kind: b.kind });
      }
    }
    return hits;
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
      const missingShift = NAMES.filter((name) => !onShift(name, ymd, start, end));
      if (missingShift.length) continue;
      const hits = busyHits(ymd, start, end);
      const reservationHits = hits.filter((h) => h.kind === "reservation");
      const row = {
        date: ymd,
        dow: dayOfWeek(ymd),
        time: formatRange(start, end),
        startMin: start,
        other: hits.filter((h) => h.kind !== "reservation"),
      };
      if (reservationHits.length) booked.push({ ...row, reservations: reservationHits });
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
      const intervals = shiftsByNameDate.get(`${name}|${ymd}`) ?? [];
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
        criteria: "3人ともシフト内で、キャンセル以外の予約が重なっていない",
        searchWindow: "08:00-21:00開始",
        openCount: open.length,
        byDate,
        bookedWhileAllOnShift: booked.map((s) => ({
          date: s.date,
          time: s.time,
          reservations: s.reservations,
        })),
        openButBreakOrEvent: open
          .filter((s) => s.other.length)
          .map((s) => ({ date: s.date, time: s.time, other: s.other })),
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
