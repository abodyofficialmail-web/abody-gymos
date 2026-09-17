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
/** 予約枠（booking-v2 と同じ 30 分） */
const SESSION_SLOT_MIN = 30;

/** 以前提案した MTG 候補（監査用・JST） */
const PREVIOUSLY_SUGGESTED_WINDOWS = [
  { date: "2026-09-17", fromMin: 18 * 60, toMin: 20 * 60, label: "9/17 18:00-20:00" },
  { date: "2026-09-25", fromMin: 16 * 60, toMin: 21 * 60, label: "9/25 16:00-21:00" },
  { date: "2026-09-29", fromMin: 16 * 60, toMin: 19 * 60 + 30, label: "9/29 16:00-19:30" },
];

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

function fmtHm(min) {
  return `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
}

function slotIntervalMs(ymd, slotStartMin, slotEndMin) {
  const startMs = Date.parse(`${ymd}T${fmtHm(slotStartMin)}:00+09:00`);
  const endMs = Date.parse(`${ymd}T${fmtHm(slotEndMin)}:00+09:00`);
  return { startMs, endMs };
}

function reservationIntervalMs(r) {
  const startMs = Date.parse(r.start_at);
  if (!Number.isFinite(startMs)) return null;
  let endMs = Date.parse(r.end_at);
  if (!Number.isFinite(endMs) || endMs <= startMs) {
    endMs = startMs + SESSION_SLOT_MIN * 60 * 1000;
  }
  return { startMs, endMs };
}

function overlapsMs(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && bStart < aEnd;
}

/** 予約の JST 上の開始日・分（終了は同日補正） */
function reservationJstWindow(r) {
  const start = isoToJstParts(r.start_at);
  const endRaw = isoToJstParts(r.end_at);
  let endMin = endRaw.min;
  if (endRaw.ymd === start.ymd && endMin > start.min) {
    // ok
  } else if (endRaw.ymd !== start.ymd) {
    endMin = Math.min(22 * 60, start.min + SESSION_SLOT_MIN);
  } else {
    endMin = start.min + SESSION_SLOT_MIN;
  }
  return { ymd: start.ymd, startMin: start.min, endMin };
}

function isBlockingReservation(r) {
  if (r.status === "cancelled") return false;
  if (r.blocks_capacity === false) return false;
  return Boolean(r.member_id || r.trainer_id);
}

async function fetchSeptemberReservations(supabase) {
  const applyOverlap = (q) =>
    q
      .lt("start_at", MONTH_END)
      .gt("end_at", MONTH_START)
      .neq("status", "cancelled");

  try {
    return await fetchAllChecked(
      supabase,
      "reservations",
      "trainer_id, store_id, member_id, start_at, end_at, status, blocks_capacity",
      applyOverlap,
      "reservations.september.overlap",
    );
  } catch (e) {
    const msg = String(e?.message ?? e);
    if (!/blocks_capacity|does not exist|column/i.test(msg)) throw e;
    return fetchAllChecked(
      supabase,
      "reservations",
      "trainer_id, store_id, member_id, start_at, end_at, status",
      applyOverlap,
      "reservations.september.overlap.noBlocksCapacity",
    );
  }
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
    fetchSeptemberReservations(supabase),
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
  const trainerStoreById = Object.fromEntries(trainers.map((t) => [t.id, t.store_id]));

  const blockingReservations = reservationsResult.rows.filter(isBlockingReservation);
  const reservationsAssigned = blockingReservations.filter((r) => r.trainer_id).length;
  const reservationsUnassigned = blockingReservations.length - reservationsAssigned;

  const shiftsByTrainerDate = new Map();
  for (const s of shiftsResult.rows) {
    const key = `${s.trainer_id}|${s.shift_date}`;
    const list = shiftsByTrainerDate.get(key) ?? [];
    list.push({ startMin: toMinutes(s.start_local), endMin: toMinutes(s.end_local) });
    shiftsByTrainerDate.set(key, list);
  }

  const eventsByTrainerDate = new Map();
  for (const e of eventsResult.rows) {
    const key = `${e.trainer_id}|${e.event_date}`;
    const list = eventsByTrainerDate.get(key) ?? [];
    list.push({ startMin: toMinutes(e.start_local), endMin: toMinutes(e.end_local), title: e.title });
    eventsByTrainerDate.set(key, list);
  }

  function reservationConflictDetail(trainerId, ymd, slotStart, slotEnd) {
    const storeId = trainerStoreById[trainerId];
    const slot = slotIntervalMs(ymd, slotStart, slotEnd);
    for (const r of blockingReservations) {
      const iv = reservationIntervalMs(r);
      if (!iv || !overlapsMs(slot.startMs, slot.endMs, iv.startMs, iv.endMs)) continue;

      if (r.trainer_id === trainerId) {
        const w = reservationJstWindow(r);
        return {
          kind: "assigned",
          startAt: r.start_at,
          endAt: r.end_at,
          window: formatRange(w.startMin, w.endMin),
        };
      }

      if (!r.trainer_id && r.store_id && storeId && r.store_id === storeId) {
        const w = reservationJstWindow(r);
        if (w.ymd === ymd && isOnShift(trainerId, ymd, w.startMin, w.endMin)) {
          return {
            kind: "unassigned_on_shift",
            startAt: r.start_at,
            endAt: r.end_at,
            window: formatRange(w.startMin, w.endMin),
          };
        }
      }
    }
    return null;
  }

  function hasReservationConflict(trainerId, ymd, slotStart, slotEnd) {
    return reservationConflictDetail(trainerId, ymd, slotStart, slotEnd) != null;
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

  const previouslySuggestedAudit = PREVIOUSLY_SUGGESTED_WINDOWS.map((win) => {
    const slots = [];
    for (let start = win.fromMin; start + MTG_DURATION_MIN <= win.toMin; start += SLOT_STEP_MIN) {
      const end = start + MTG_DURATION_MIN;
      const ev = evaluateSlot(win.date, start, end);
      const reservationBlocked = [];
      for (const t of trainers) {
        const detail = reservationConflictDetail(t.id, win.date, start, end);
        if (detail) {
          reservationBlocked.push({
            name: t.display_name ?? t.id,
            ...detail,
          });
        }
      }
      slots.push({
        time: formatRange(start, end),
        availableCount: ev.availableCount,
        blockedByReservation: reservationBlocked,
        blockedByEvent: ev.blocked.filter((b) => b.reasons.includes("event")).map((b) => b.name),
      });
    }
    return { label: win.label, date: win.date, slots };
  });

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
          available:
            "セッション予約（cancelled除外）・トレーナーeventと重ならない active トレーナー全員",
          onShiftNote: "シフトイン中の人数は参考（MTGは休み日参加も可の前提）",
        },
        allAvailableSlotCount: allAvailable.length,
        allAvailableByDate,
        fetched: {
          shifts: shiftsResult.count,
          reservations: reservationsResult.count,
          blockingReservations: blockingReservations.length,
          reservationsAssigned,
          reservationsUnassigned,
          events: eventsResult.count,
        },
        previouslySuggestedAudit,
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

  console.log("\n--- 以前提案した時間帯の予約重なり監査 ---");
  for (const win of previouslySuggestedAudit) {
    console.log(`\n### ${win.label}`);
    for (const s of win.slots) {
      const names = s.blockedByReservation.map((b) => `${b.name}(${b.kind} ${b.window})`);
      console.log(
        `${s.time} → 参加可 ${s.availableCount}/${trainers.length}名` +
          (names.length ? ` / 予約重なり: ${names.join("、")}` : " / 予約重なりなし") +
          (s.blockedByEvent.length ? ` / event: ${s.blockedByEvent.join("、")}` : ""),
      );
    }
  }

  console.log("\n--- 全員参加可（セッション予約・eventなし・シフト不問） ---");
  console.log(`該当: ${allAvailable.length}枠 / アクティブ ${trainers.length}名\n`);
  for (const [dateLabel, times] of Object.entries(allAvailableByDate)) {
    console.log(`### ${dateLabel}`);
    for (const t of times) console.log(`- ${t}`);
  }

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
