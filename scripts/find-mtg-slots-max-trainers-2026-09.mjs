/**
 * 9月MTG: 予約・シフトを踏まえ参加可能トレーナーが最多の1時間枠を探索
 * node scripts/find-mtg-slots-max-trainers-2026-09.mjs（JST当日以降を探索）
 */
import { createClient } from "@supabase/supabase-js";
import { fetchAllChecked } from "./lib/supabaseFetchAll.mjs";

const MONTH = "2026-09";
const TZ = "Asia/Tokyo";
const SLOT_STEP_MIN = 30;
const MTG_DURATION_MIN = 60;
const SEARCH_START = 8 * 60;
const SEARCH_END = 21 * 60;

const MONTH_START = `${MONTH}-01T00:00:00+09:00`;
const MONTH_END = "2026-10-01T00:00:00+09:00";

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

function formatRange(startMin, endMin) {
  const fmt = (m) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  return `${fmt(startMin)}-${fmt(endMin)}`;
}

function dayOfWeek(ymd) {
  const [y, m, d] = ymd.split("-").map(Number);
  return ["日", "月", "火", "水", "木", "金", "土"][new Date(y, m - 1, d).getDay()];
}

function isoToJstParts(iso) {
  const d = new Date(iso);
  const ymd = new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(d);
  const hm = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false }).format(d);
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

  const [trainersResult, shiftsResult, reservationsResult, eventsResult] = await Promise.all([
    fetchAllChecked(
      supabase,
      "trainers",
      "id, display_name, store_id, is_active",
      (q) => q.eq("is_active", true),
      "trainers.active",
    ),
    fetchAllChecked(
      supabase,
      "trainer_shifts",
      "trainer_id, shift_date, start_local, end_local, status, is_break",
      (q) =>
        q
          .gte("shift_date", `${MONTH}-01`)
          .lte("shift_date", `${MONTH}-30`)
          .neq("status", "draft")
          .eq("is_break", false),
      "trainer_shifts.september",
    ),
    fetchAllChecked(
      supabase,
      "reservations",
      "trainer_id, start_at, end_at, status",
      (q) =>
        q
          .gte("start_at", MONTH_START)
          .lt("start_at", MONTH_END)
          .neq("status", "cancelled")
          .not("trainer_id", "is", null),
      "reservations.september",
    ),
    fetchAllChecked(
      supabase,
      "trainer_events",
      "trainer_id, event_date, start_local, end_local, title",
      (q) => q.gte("event_date", `${MONTH}-01`).lte("event_date", `${MONTH}-30`),
      "trainer_events.september",
    ),
  ]);

  const trainers = trainersResult.rows;
  const trainerNameById = Object.fromEntries(trainers.map((t) => [t.id, t.display_name]));

  const shiftsByTrainerDate = new Map();
  for (const s of shiftsResult.rows) {
    const key = `${s.trainer_id}|${s.shift_date}`;
    const list = shiftsByTrainerDate.get(key) ?? [];
    list.push({ startMin: toMinutes(s.start_local), endMin: toMinutes(s.end_local) });
    shiftsByTrainerDate.set(key, list);
  }

  const reservationsByTrainer = new Map();
  for (const r of reservationsResult.rows) {
    const list = reservationsByTrainer.get(r.trainer_id) ?? [];
    list.push(r);
    reservationsByTrainer.set(r.trainer_id, list);
  }

  const eventsByTrainerDate = new Map();
  for (const e of eventsResult.rows) {
    const key = `${e.trainer_id}|${e.event_date}`;
    const list = eventsByTrainerDate.get(key) ?? [];
    list.push({ startMin: toMinutes(e.start_local), endMin: toMinutes(e.end_local), title: e.title });
    eventsByTrainerDate.set(key, list);
  }

  function hasReservationConflict(trainerId, ymd, slotStart, slotEnd) {
    const list = reservationsByTrainer.get(trainerId) ?? [];
    for (const r of list) {
      const { ymd: rYmd, min: rStart } = isoToJstParts(r.start_at);
      const { min: rEnd } = isoToJstParts(r.end_at);
      if (rYmd !== ymd) continue;
      if (overlaps(slotStart, slotEnd, rStart, rEnd)) return true;
    }
    return false;
  }

  function hasEventConflict(trainerId, ymd, slotStart, slotEnd) {
    const list = eventsByTrainerDate.get(`${trainerId}|${ymd}`) ?? [];
    return list.some((e) => overlaps(slotStart, slotEnd, e.startMin, e.endMin));
  }

  function isOnShift(trainerId, ymd, slotStart, slotEnd) {
    const list = shiftsByTrainerDate.get(`${trainerId}|${ymd}`) ?? [];
    return list.some((i) => covers(i.startMin, i.endMin, slotStart, slotEnd));
  }

  function hasShiftOnDay(trainerId, ymd) {
    return (shiftsByTrainerDate.get(`${trainerId}|${ymd}`) ?? []).length > 0;
  }

  function evaluateSlot(ymd, slotStart, slotEnd) {
    const available = [];
    const blocked = [];
    const notOnShift = [];
    for (const t of trainers) {
      const name = t.display_name ?? t.id;
      const onShift = isOnShift(t.id, ymd, slotStart, slotEnd);
      const reasons = [];
      if (hasReservationConflict(t.id, ymd, slotStart, slotEnd)) reasons.push("reservation");
      if (hasEventConflict(t.id, ymd, slotStart, slotEnd)) reasons.push("event");
      if (!onShift) notOnShift.push(name);
      if (reasons.length) {
        blocked.push({ name, reasons, onShift });
        continue;
      }
      available.push({
        name,
        onShift,
        hasShiftOnDay: hasShiftOnDay(t.id, ymd),
      });
    }
    const n = trainers.length;
    const allOnShift = notOnShift.length === 0;
    const allOnShiftAndFree = allOnShift && blocked.length === 0 && available.length === n;
    return {
      availableCount: available.length,
      onShiftCount: available.filter((a) => a.onShift).length,
      offDayCount: available.filter((a) => !a.hasShiftOnDay).length,
      allOnShift,
      allOnShiftAndFree,
      notOnShift,
      available,
      blocked,
    };
  }

  const ranked = [];
  for (let day = 1; day <= 30; day++) {
    const ymd = `${MONTH}-${String(day).padStart(2, "0")}`;
    for (let start = SEARCH_START; start + MTG_DURATION_MIN <= 22 * 60; start += SLOT_STEP_MIN) {
      if (start > SEARCH_END) break;
      const end = start + MTG_DURATION_MIN;
      const ev = evaluateSlot(ymd, start, end);
      ranked.push({
        date: ymd,
        dow: dayOfWeek(ymd),
        time: formatRange(start, end),
        ...ev,
      });
    }
  }

  ranked.sort(
    (a, b) =>
      b.availableCount - a.availableCount ||
      b.onShiftCount - a.onShiftCount ||
      a.date.localeCompare(b.date) ||
      a.time.localeCompare(b.time),
  );

  const nowJst = new Date(new Date().toLocaleString("en-US", { timeZone: TZ }));
  const todayYmd = new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(nowJst);
  const nowMin = nowJst.getHours() * 60 + nowJst.getMinutes();

  const futureRanked = ranked.filter((s) => {
    if (s.date > todayYmd) return true;
    if (s.date < todayYmd) return false;
    return toMinutes(s.time.split("-")[0]) >= nowMin;
  });

  const top = futureRanked.slice(0, 15);
  const maxCount = top[0]?.availableCount ?? 0;
  const best = futureRanked.filter((s) => s.availableCount === maxCount);

  const fullShiftAndFree = futureRanked.filter((s) => s.allOnShiftAndFree);
  const fullShiftOnly = futureRanked.filter((s) => s.allOnShift);
  /** セッション予約・トレーナーeventと重ならず全員参加可（シフトは不問） */
  const allAvailable = futureRanked.filter((s) => s.availableCount === trainers.length);
  const allAvailableByDate = {};
  for (const s of allAvailable) {
    const key = `${s.date} (${s.dow})`;
    if (!allAvailableByDate[key]) allAvailableByDate[key] = [];
    allAvailableByDate[key].push(s.time);
  }

  console.log(
    JSON.stringify(
      {
        month: MONTH,
        activeTrainerCount: trainers.length,
        activeTrainers: trainers.map((t) => t.display_name).sort(),
        criteria: {
          duration: "60分",
          slotStep: "30分",
          searchStart: "08:00",
          searchEnd: "21:00開始まで",
          available: "予約・トレーナー予定（event）と重ならない active トレーナー",
          onShiftNote: "シフトイン中の人数は参考（当日シフト内の空き）",
        },
        fetched: {
          shifts: shiftsResult.count,
          reservations: reservationsResult.count,
          events: eventsResult.count,
        },
        checkedFromJst: todayYmd,
        maxAvailableCount: maxCount,
        fullShiftAndFreeCount: fullShiftAndFree.length,
        fullShiftAndFreeSlots: fullShiftAndFree.map((s) => ({
          date: s.date,
          dow: s.dow,
          time: s.time,
        })),
        fullShiftOnlyCount: fullShiftOnly.length,
        bestSlots: best.slice(0, 20),
        top15: top.map((s) => ({
          date: s.date,
          dow: s.dow,
          time: s.time,
          availableCount: s.availableCount,
          onShiftCount: s.onShiftCount,
          offDayCount: s.offDayCount,
          availableNames: s.available.map((a) => a.name),
          blockedNames: s.blocked.map((b) => `${b.name}(${b.reasons.join("+")})`),
        })),
      },
      null,
      2,
    ),
  );

  console.log("\n--- 全員シフトイン＆予約/eventなし（1時間MTG可） ---");
  console.log(`該当: ${fullShiftAndFree.length}枠 / アクティブ ${trainers.length}名\n`);
  for (const s of fullShiftAndFree.slice(0, 40)) {
    console.log(`${s.date} (${s.dow}) ${s.time}`);
  }
  if (fullShiftAndFree.length === 0 && fullShiftOnly.length > 0) {
    console.log("\n（参考）全員シフトインだが予約/eventと重なる枠のみ:");
    for (const s of fullShiftOnly.slice(0, 8)) {
      console.log(
        `${s.date} (${s.dow}) ${s.time} → 不可: ${s.blocked.map((b) => `${b.name}[${b.reasons.join("+")}]`).join("、")}`,
      );
    }
  }

  console.log("\n--- おすすめ（参加可能人数が最多） ---");
  console.log(`アクティブトレーナー: ${trainers.length}名 / 最多参加可能: ${maxCount}名\n`);
  for (const s of best.slice(0, 12)) {
    console.log(
      `${s.date} (${s.dow}) ${s.time} → 参加可 ${s.availableCount}名（シフト中 ${s.onShiftCount} / 休み ${s.offDayCount}）`,
    );
    console.log(`  可: ${s.available.map((a) => a.name).join("、")}`);
    if (s.blocked.length) console.log(`  不可: ${s.blocked.map((b) => `${b.name}[${b.reasons.join("+")}]`).join("、")}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
