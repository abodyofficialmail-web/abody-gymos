/**
 * 9月: 1時間オンラインMTG候補
 * - 参加者: こうへい以外（コア6名）
 * - 条件: 参加者のうちだいき以外（ゆうと・たけはる・ひろむ・せいや・りょう）が全員シフトイン
 *
 * node --env-file=.env.local scripts/find-mtg-slots-2026-09.mjs
 */
import { createClient } from "@supabase/supabase-js";
import { fetchAllChecked } from "./lib/supabaseFetchAll.mjs";

const MONTH = "2026-09";
const TZ = "Asia/Tokyo";
const SLOT_STEP_MIN = 30;
const MTG_DURATION_MIN = 60;
const SEARCH_START = 9 * 60; // 09:00
const SEARCH_END = 21 * 60; // 21:00開始まで

/** コア従業員（シフト設計と同期） */
const CORE_EMPLOYEES = ["ゆうと", "たけはる", "ひろむ", "せいや", "りょう", "こうへい", "だいき"];
/** MTG参加者: こうへい除く */
const MTG_PARTICIPANTS = CORE_EMPLOYEES.filter((n) => n !== "こうへい");
/** シフトイン必須: 参加者のうちだいき除く（5名） */
const SHIFT_REQUIRED = MTG_PARTICIPANTS.filter((n) => n !== "だいき");

const MONTH_START = `${MONTH}-01T00:00:00+09:00`;
const MONTH_END = "2026-10-01T00:00:00+09:00";

function toMinutes(hhmm) {
  const [h, m] = String(hhmm).slice(0, 5).split(":").map(Number);
  return h * 60 + m;
}

function covers(startMin, endMin, slotStart, slotEnd) {
  return startMin <= slotStart && endMin >= slotEnd;
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

  const trainersResult = await fetchAllChecked(
    supabase,
    "trainers",
    "id, display_name",
    (q) => q.in("display_name", CORE_EMPLOYEES),
    "trainers.core",
  );
  const trainers = trainersResult.rows;
  const trainerNameById = Object.fromEntries(trainers.map((t) => [t.id, t.display_name]));
  const trainerIds = trainers.map((t) => t.id);

  const missing = CORE_EMPLOYEES.filter((n) => !trainers.some((t) => t.display_name === n));
  if (missing.length) {
    throw new Error(`DBに未登録の従業員: ${missing.join(", ")}`);
  }

  const shiftsResult = await fetchAllChecked(
    supabase,
    "trainer_shifts",
    "trainer_id, shift_date, start_local, end_local, status, is_break",
    (q) =>
      q
        .gte("shift_date", `${MONTH}-01`)
        .lte("shift_date", `${MONTH}-30`)
        .in("trainer_id", trainerIds)
        .neq("status", "draft")
        .eq("is_break", false),
    "trainer_shifts.september",
  );

  /** key: name|date -> { startMin, endMin }[] */
  const shiftsByNameDate = new Map();
  for (const s of shiftsResult.rows) {
    const name = trainerNameById[s.trainer_id];
    if (!name) continue;
    const key = `${name}|${s.shift_date}`;
    const list = shiftsByNameDate.get(key) ?? [];
    list.push({
      startMin: toMinutes(s.start_local),
      endMin: toMinutes(s.end_local),
    });
    shiftsByNameDate.set(key, list);
  }

  function isShiftedIn(name, ymd, slotStart, slotEnd) {
    const key = `${name}|${ymd}`;
    const intervals = shiftsByNameDate.get(key) ?? [];
    return intervals.some((i) => covers(i.startMin, i.endMin, slotStart, slotEnd));
  }

  const slots = [];
  for (let day = 1; day <= 30; day++) {
    const ymd = `${MONTH}-${String(day).padStart(2, "0")}`;
    for (let start = SEARCH_START; start + MTG_DURATION_MIN <= 22 * 60; start += SLOT_STEP_MIN) {
      if (start > SEARCH_END) break;
      const end = start + MTG_DURATION_MIN;
      const allShiftedIn = SHIFT_REQUIRED.every((name) => isShiftedIn(name, ymd, start, end));
      if (allShiftedIn) {
        slots.push({
          date: ymd,
          dow: dayOfWeek(ymd),
          time: formatRange(start, end),
          startMin: start,
        });
      }
    }
  }

  const uniqueSlots = [];
  const seen = new Set();
  for (const s of slots) {
    const k = `${s.date}|${s.time}`;
    if (seen.has(k)) continue;
    seen.add(k);
    uniqueSlots.push({ date: s.date, dow: s.dow, time: s.time });
  }

  const nowJst = new Date(new Date().toLocaleString("en-US", { timeZone: TZ }));
  const todayYmd = new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(nowJst);
  const nowMin = nowJst.getHours() * 60 + nowJst.getMinutes();

  const futureSlots = uniqueSlots.filter((s) => {
    if (s.date > todayYmd) return true;
    if (s.date < todayYmd) return false;
    return toMinutes(s.time.split("-")[0]) >= nowMin;
  });

  const byDate = {};
  for (const s of futureSlots) {
    const key = `${s.date} (${s.dow})`;
    if (!byDate[key]) byDate[key] = [];
    if (!byDate[key].includes(s.time)) byDate[key].push(s.time);
  }

  const nearMiss = [];
  for (let day = 1; day <= 30; day++) {
    const ymd = `${MONTH}-${String(day).padStart(2, "0")}`;
    let best = { count: 0, time: null, missing: SHIFT_REQUIRED };
    for (let start = SEARCH_START; start + MTG_DURATION_MIN <= 22 * 60; start += SLOT_STEP_MIN) {
      if (start > SEARCH_END) break;
      const end = start + MTG_DURATION_MIN;
      const on = SHIFT_REQUIRED.filter((name) => isShiftedIn(name, ymd, start, end));
      const missing = SHIFT_REQUIRED.filter((name) => !isShiftedIn(name, ymd, start, end));
      if (on.length > best.count) {
        best = { count: on.length, time: formatRange(start, end), missing };
      }
    }
    if (best.count > 0) {
      nearMiss.push({ date: ymd, dow: dayOfWeek(ymd), ...best });
    }
  }
  nearMiss.sort((a, b) => b.count - a.count || a.date.localeCompare(b.date));

  console.log(
    JSON.stringify(
      {
        month: MONTH,
        criteria: {
          participants: MTG_PARTICIPANTS,
          shiftRequired: SHIFT_REQUIRED,
          shiftExcluded: ["だいき"],
          participantExcluded: ["こうへい"],
          duration: "1時間",
        },
        fetched: {
          trainers: { count: trainersResult.count, fetched: trainersResult.fetched },
          shifts: { count: shiftsResult.count, fetched: shiftsResult.fetched },
        },
        shiftSource: "db_confirmed",
        searchWindow: "09:00-21:00開始 (1時間枠)",
        totalSlotOptions: uniqueSlots.length,
        futureSlotOptions: futureSlots.length,
        nearMissTop10: nearMiss.slice(0, 10),
        slots: futureSlots,
        byDate,
      },
      null,
      2,
    ),
  );

  console.log("\n--- 候補日時（参加者5名シフトイン・だいき/こうへいは条件外・今日以降） ---");
  for (const [dateLabel, times] of Object.entries(byDate)) {
    console.log(`\n### ${dateLabel}`);
    for (const t of times) console.log(`- ${t}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
