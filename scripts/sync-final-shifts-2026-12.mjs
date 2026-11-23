import path from "node:path";
import { pathToFileURL } from "node:url";

/**
 * 2026-12 東京4店舗のシフト（恵比寿・上野・新宿・桜木町）
 *
 * 福岡は触らない。会員画面は下書きを出さない。--apply は下書きで入れる。
 * 12月の東京4店舗に予約が1件でもあれば書き込まない。
 *
 *   node scripts/sync-final-shifts-2026-12.mjs
 *   node --env-file=.env.local scripts/sync-final-shifts-2026-12.mjs --dry-run
 *   node --env-file=.env.local scripts/sync-final-shifts-2026-12.mjs --apply
 */
const MONTH = "2026-12";
const MONTH_START = "2026-12-01";
const MONTH_END = "2026-12-31";
const NEXT_MONTH_START = "2027-01-01T00:00:00+09:00";
const MONTH_START_ISO = "2026-12-01T00:00:00+09:00";
const STORE_NAMES = ["恵比寿", "上野", "新宿", "桜木町"];
const SINGLE_BOOTH = new Set(["恵比寿", "新宿"]);
const REVENUE_YEN = 3_870_000;
const LABOR_CAP_YEN = 1_354_500;
const EXPECT_SLOTS = 1332;
const EXPECT_PAY_YEN = 1_257_248;
/** 指定予算。時給が30分・新宿往復が900円単位のため、この額ちょうどにはならない。 */
const LABOR_BUDGET_YEN = 1_257_329;
/** 全店冬季休館。公開枠にも人件費にも入れない。 */
const WINTER_CLOSED_DAYS = new Set([30, 31]);
const SHIFT_STATUS = "draft";

const SEIYA_SHIFTS = [
  ["2026-12-01", "09:00", "22:00"],
  ["2026-12-05", "09:00", "18:00"],
  ["2026-12-07", "09:00", "22:00"],
  ["2026-12-08", "14:00", "22:00"],
  ["2026-12-12", "09:00", "18:00"],
  ["2026-12-14", "09:00", "22:00"],
  ["2026-12-15", "10:00", "22:00"],
  ["2026-12-19", "09:00", "18:00"],
  ["2026-12-21", "09:00", "22:00"],
  ["2026-12-22", "14:00", "22:00"],
  ["2026-12-26", "09:00", "18:00"],
  ["2026-12-28", "09:00", "22:00"],
];

/** [date, start, end, trainer, store] 分割は別行 */
const SHIFTS = [
  ["2026-12-01", "10:00", "13:00", "ゆうと", "新宿"],
  ["2026-12-01", "16:00", "22:00", "ひろむ", "新宿"],
  ["2026-12-01", "09:00", "22:00", "せいや", "上野"],
  ["2026-12-01", "09:00", "13:00", "たけはる", "桜木町"],
  ["2026-12-01", "16:00", "22:00", "たけはる", "桜木町"],

  ["2026-12-02", "16:00", "22:00", "ゆうと", "恵比寿"],
  ["2026-12-02", "16:00", "22:00", "ひろむ", "新宿"],
  ["2026-12-02", "09:00", "16:00", "りょう", "新宿"],

  ["2026-12-03", "16:00", "22:00", "ゆうと", "恵比寿"],
  ["2026-12-03", "16:00", "22:00", "ひろむ", "新宿"],
  ["2026-12-03", "09:00", "15:00", "りょう", "新宿"],
  ["2026-12-03", "09:00", "13:00", "たけはる", "桜木町"],
  ["2026-12-03", "16:00", "21:00", "たけはる", "桜木町"],

  ["2026-12-04", "11:00", "13:00", "ゆうと", "新宿"],
  ["2026-12-04", "16:00", "22:00", "ゆうと", "新宿"],
  ["2026-12-04", "14:00", "22:00", "ひろむ", "上野"],
  ["2026-12-04", "09:00", "11:00", "りょう", "桜木町"],
  ["2026-12-04", "16:00", "21:00", "りょう", "桜木町"],
  ["2026-12-04", "09:00", "13:00", "たけはる", "桜木町"],
  ["2026-12-04", "16:00", "21:00", "たけはる", "桜木町"],

  ["2026-12-05", "13:00", "19:00", "ひろむ", "新宿"],
  ["2026-12-05", "09:00", "18:00", "せいや", "上野"],
  ["2026-12-05", "09:00", "14:30", "りょう", "桜木町"],

  ["2026-12-06", "09:00", "15:00", "ゆうと", "恵比寿"],
  ["2026-12-06", "10:00", "16:00", "りょう", "新宿"],
  ["2026-12-06", "09:00", "17:00", "たけはる", "桜木町"],

  ["2026-12-07", "16:00", "22:00", "ゆうと", "恵比寿"],
  ["2026-12-07", "13:00", "22:00", "ひろむ", "新宿"],
  ["2026-12-07", "09:00", "22:00", "せいや", "上野"],

  ["2026-12-08", "16:00", "22:00", "ひろむ", "新宿"],
  ["2026-12-08", "14:00", "22:00", "せいや", "上野"],
  ["2026-12-08", "09:00", "13:00", "たけはる", "桜木町"],
  ["2026-12-08", "16:00", "22:00", "たけはる", "桜木町"],

  ["2026-12-09", "16:00", "22:00", "ゆうと", "恵比寿"],
  ["2026-12-09", "13:00", "18:00", "ひろむ", "上野"],
  ["2026-12-09", "10:00", "13:00", "りょう", "新宿"],
  ["2026-12-09", "16:00", "21:30", "りょう", "新宿"],
  ["2026-12-09", "10:00", "13:00", "たけはる", "桜木町"],
  ["2026-12-09", "16:00", "21:30", "たけはる", "桜木町"],

  ["2026-12-10", "16:00", "22:00", "ゆうと", "恵比寿"],
  ["2026-12-10", "10:00", "13:00", "りょう", "新宿"],
  ["2026-12-10", "16:00", "21:30", "りょう", "新宿"],
  ["2026-12-10", "09:00", "13:00", "たけはる", "桜木町"],
  ["2026-12-10", "16:00", "22:00", "たけはる", "桜木町"],

  ["2026-12-11", "10:00", "20:00", "ひろむ", "上野"],
  ["2026-12-11", "10:00", "13:00", "りょう", "新宿"],
  ["2026-12-11", "16:00", "21:30", "りょう", "新宿"],
  ["2026-12-11", "16:00", "22:00", "たけはる", "桜木町"],

  ["2026-12-12", "13:00", "19:00", "ひろむ", "新宿"],
  ["2026-12-12", "09:00", "18:00", "せいや", "上野"],
  ["2026-12-12", "09:00", "14:30", "りょう", "桜木町"],

  ["2026-12-13", "10:00", "16:00", "ゆうと", "恵比寿"],
  ["2026-12-13", "10:00", "16:00", "りょう", "新宿"],
  ["2026-12-13", "19:00", "22:00", "りょう", "桜木町"],

  ["2026-12-14", "16:00", "22:00", "ゆうと", "恵比寿"],
  ["2026-12-14", "13:00", "22:00", "ひろむ", "新宿"],
  ["2026-12-14", "09:00", "22:00", "せいや", "上野"],
  ["2026-12-14", "09:00", "14:30", "たけはる", "桜木町"],

  ["2026-12-15", "16:00", "22:00", "ひろむ", "新宿"],
  ["2026-12-15", "10:00", "22:00", "せいや", "上野"],
  ["2026-12-15", "09:00", "13:00", "たけはる", "桜木町"],
  ["2026-12-15", "16:00", "22:00", "たけはる", "桜木町"],

  ["2026-12-16", "16:00", "22:00", "ゆうと", "恵比寿"],
  ["2026-12-16", "10:00", "13:00", "りょう", "新宿"],
  ["2026-12-16", "16:00", "21:30", "りょう", "新宿"],
  ["2026-12-16", "10:00", "14:30", "たけはる", "桜木町"],

  ["2026-12-17", "16:00", "22:00", "ゆうと", "恵比寿"],
  ["2026-12-17", "13:00", "18:00", "ひろむ", "上野"],
  ["2026-12-17", "10:00", "13:00", "りょう", "新宿"],
  ["2026-12-17", "16:00", "21:30", "りょう", "新宿"],
  ["2026-12-17", "09:00", "13:00", "たけはる", "桜木町"],
  ["2026-12-17", "16:00", "22:00", "たけはる", "桜木町"],

  ["2026-12-18", "16:00", "22:00", "ゆうと", "新宿"],
  ["2026-12-18", "10:00", "18:00", "ひろむ", "上野"],
  ["2026-12-18", "10:00", "13:00", "りょう", "新宿"],
  ["2026-12-18", "10:00", "14:30", "たけはる", "桜木町"],

  ["2026-12-19", "13:00", "19:00", "ひろむ", "新宿"],
  ["2026-12-19", "09:00", "18:00", "せいや", "上野"],
  ["2026-12-19", "10:00", "14:30", "りょう", "桜木町"],
  ["2026-12-19", "16:00", "21:30", "りょう", "桜木町"],

  ["2026-12-20", "10:00", "16:00", "ゆうと", "恵比寿"],
  ["2026-12-20", "10:00", "16:00", "りょう", "新宿"],
  ["2026-12-20", "19:00", "22:00", "りょう", "桜木町"],

  ["2026-12-21", "16:00", "22:00", "ゆうと", "恵比寿"],
  ["2026-12-21", "16:00", "22:00", "ひろむ", "新宿"],
  ["2026-12-21", "09:00", "22:00", "せいや", "上野"],
  ["2026-12-21", "10:00", "14:00", "りょう", "新宿"],
  ["2026-12-21", "09:00", "14:30", "たけはる", "桜木町"],

  ["2026-12-22", "16:00", "22:00", "ひろむ", "新宿"],
  ["2026-12-22", "14:00", "22:00", "せいや", "上野"],
  ["2026-12-22", "10:00", "14:00", "りょう", "新宿"],
  ["2026-12-22", "09:00", "13:00", "たけはる", "桜木町"],
  ["2026-12-22", "16:00", "22:00", "たけはる", "桜木町"],

  ["2026-12-23", "16:00", "22:00", "ゆうと", "恵比寿"],
  ["2026-12-23", "13:00", "21:00", "ひろむ", "上野"],
  ["2026-12-23", "10:00", "13:00", "りょう", "新宿"],
  ["2026-12-23", "16:00", "21:30", "りょう", "新宿"],
  ["2026-12-23", "10:00", "14:30", "たけはる", "桜木町"],

  ["2026-12-24", "16:00", "22:00", "ゆうと", "恵比寿"],
  ["2026-12-24", "09:00", "17:00", "ひろむ", "上野"],
  ["2026-12-24", "10:00", "13:00", "りょう", "新宿"],
  ["2026-12-24", "16:00", "21:30", "りょう", "新宿"],

  ["2026-12-25", "09:00", "13:00", "たけはる", "桜木町"],
  ["2026-12-25", "16:00", "22:00", "たけはる", "桜木町"],

  ["2026-12-26", "10:00", "16:00", "ひろむ", "新宿"],
  ["2026-12-26", "09:00", "18:00", "せいや", "上野"],
  ["2026-12-26", "09:00", "13:00", "りょう", "桜木町"],

  ["2026-12-27", "10:00", "16:00", "ゆうと", "恵比寿"],
  ["2026-12-27", "10:00", "16:00", "りょう", "新宿"],
  ["2026-12-27", "09:00", "14:30", "たけはる", "桜木町"],

  ["2026-12-28", "16:00", "22:00", "ゆうと", "恵比寿"],
  ["2026-12-28", "13:00", "22:00", "ひろむ", "新宿"],
  ["2026-12-28", "09:00", "22:00", "せいや", "上野"],
  ["2026-12-28", "09:00", "14:30", "たけはる", "桜木町"],

  ["2026-12-29", "16:00", "22:00", "ゆうと", "新宿"],
  ["2026-12-29", "13:00", "18:00", "ひろむ", "上野"],
  ["2026-12-29", "10:00", "14:00", "りょう", "新宿"],
  ["2026-12-29", "09:00", "13:00", "たけはる", "桜木町"],
  ["2026-12-29", "16:00", "22:00", "たけはる", "桜木町"],
];

function mins(hhmm) {
  const [h, m] = String(hhmm).slice(0, 5).split(":").map(Number);
  return h * 60 + m;
}

function hours(start, end) {
  return (mins(end) - mins(start)) / 60;
}

function ymd(day) {
  return `${MONTH}-${String(day).padStart(2, "0")}`;
}

function weekday(date) {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

function breakCovers(start, end, breakStart, breakEnd) {
  return mins(start) <= mins(breakStart) && mins(end) >= mins(breakEnd);
}

function hhmmss(total) {
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00`;
}

function bookableSlotStarts(start, end) {
  const slots = [];
  const first = Math.ceil(mins(start) / 30) * 30;
  for (let t = first; t + 30 <= mins(end); t += 30) slots.push(t);
  return slots;
}

function centerBreak(slots) {
  if (slots.length === 0) return null;
  const t = slots[Math.floor(slots.length / 2)];
  return { start: hhmmss(t), end: hhmmss(t + 30) };
}

function centeredSegmentBreaks(start, end) {
  const slots = bookableSlotStarts(start, end);
  if (slots.length === 0) return [];
  if (mins(start) >= 16 * 60) {
    const one = centerBreak(slots);
    return one ? [one] : [];
  }
  if (mins(end) > 16 * 60 && slots.length >= 2) {
    const mid = Math.floor(slots.length / 2);
    return [centerBreak(slots.slice(0, mid)), centerBreak(slots.slice(mid))].filter(Boolean);
  }
  const one = centerBreak(slots);
  return one ? [one] : [];
}

function twoCenteredBreaks(start, end) {
  const slots = bookableSlotStarts(start, end);
  if (slots.length < 2) return [];
  const mid = Math.floor(slots.length / 2);
  return [centerBreak(slots.slice(0, mid)), centerBreak(slots.slice(mid))].filter(Boolean);
}

function breaksForShift(trainerName, start, end) {
  if (trainerName === "ひろむ") {
    const breaks = [];
    if (breakCovers(start, end, "12:30", "13:00")) breaks.push({ start: "12:30:00", end: "13:00:00" });
    if (breakCovers(start, end, "20:00", "20:30")) breaks.push({ start: "20:00:00", end: "20:30:00" });
    return breaks;
  }
  if (trainerName === "ゆうと" || trainerName === "たけはる") {
    if (hours(start, end) < 7) return [];
    return twoCenteredBreaks(start, end);
  }
  if (trainerName === "せいや" || trainerName === "りょう") return centeredSegmentBreaks(start, end);
  return [];
}

function rowsFromShifts() {
  return SHIFTS.map(([shift_date, start, end, trainer_name, store_name]) => {
    const breaks = breaksForShift(trainer_name, start, end);
    return {
      shift_date,
      start_local: `${start}:00`,
      end_local: `${end}:00`,
      trainer_name,
      store_name,
      breaks,
      break_minutes: breaks.reduce((sum, b) => sum + (mins(b.end) - mins(b.start)), 0),
      training: false,
    };
  });
}

function countSlots(rows) {
  const by = new Map();
  for (const r of rows) {
    const k = `${r.store_name}|${r.shift_date}`;
    if (!by.has(k)) by.set(k, []);
    by.get(k).push(r);
  }
  const per = {};
  let total = 0;
  for (const [k, dayRows] of by) {
    const store = k.split("|")[0];
    let day = 0;
    for (let t = 9 * 60; t < 22 * 60; t += 30) {
      let cap = 0;
      for (const r of dayRows) {
        const s = mins(r.start_local);
        const e = mins(r.end_local);
        const onBreak = (r.breaks ?? []).some((b) => t < mins(b.end) && t + 30 > mins(b.start));
        if (s <= t && t + 30 <= e && !onBreak) cap += 1;
      }
      if (SINGLE_BOOTH.has(store)) cap = cap > 0 ? 1 : 0;
      day += cap;
    }
    per[store] = (per[store] ?? 0) + day;
    total += day;
  }
  return { total, per };
}

function accountedDayHours(segs) {
  const sorted = segs.slice().sort((a, b) => mins(a.start_local) - mins(b.start_local));
  let raw = 0;
  let hasGap = false;
  let workFromGaps = 0;
  for (let i = 0; i < sorted.length; i++) {
    raw += hours(sorted[i].start_local, sorted[i].end_local);
    if (i + 1 >= sorted.length) continue;
    const gapMin = mins(sorted[i + 1].start_local) - mins(sorted[i].end_local);
    if (gapMin <= 0) continue;
    hasGap = true;
    if (gapMin >= 180) workFromGaps += 1;
  }
  if (hasGap) return raw + workFromGaps;
  if (raw >= 7) return raw - 1;
  return raw;
}

function estimatePayroll(rows) {
  const by = new Map();
  for (const r of rows) {
    if (!by.has(r.trainer_name)) by.set(r.trainer_name, []);
    by.get(r.trainer_name).push(r);
  }
  function stats(name) {
    const list = by.get(name) ?? [];
    const days = new Set(list.map((r) => r.shift_date));
    const byDay = new Map();
    for (const r of list) {
      if (!byDay.has(r.shift_date)) byDay.set(r.shift_date, []);
      byDay.get(r.shift_date).push(r);
    }
    const useAccounted = name === "ゆうと" || name === "たけはる";
    let totalH = 0;
    let bonusDays = 0;
    for (const segs of byDay.values()) {
      const sorted = segs.slice().sort((a, b) => mins(a.start_local) - mins(b.start_local));
      totalH += useAccounted
        ? accountedDayHours(sorted)
        : sorted.reduce((h, r) => h + hours(r.start_local, r.end_local), 0);
      for (let i = 0; i + 1 < sorted.length; i++) {
        if (mins(sorted[i + 1].start_local) - mins(sorted[i].end_local) >= 180) {
          bonusDays += 1;
          break;
        }
      }
    }
    return { days: days.size, hours: Math.round(totalH * 10) / 10, bonusDays };
  }
  const ryo = stats("りょう");
  const hiromu = stats("ひろむ");
  const seiya = stats("せいや");
  const yuto = stats("ゆうと");
  const take = stats("たけはる");
  const ryoShinjukuDays = new Set(
    (by.get("りょう") ?? []).filter((r) => r.store_name === "新宿").map((r) => r.shift_date),
  ).size;
  const money = {
    ゆうと: 280_000 + 13_120,
    たけはる: 260_000 + 15_388,
    りょう: Math.round(ryo.hours * 1500) + ryo.bonusDays * 1500 + ryoShinjukuDays * 900,
    ひろむ: Math.round(hiromu.hours * 1500) + hiromu.bonusDays * 1500 + 18_030,
    せいや: Math.round(seiya.hours * 1400) + seiya.bonusDays * 1400 + seiya.days * 880,
  };
  const total = Object.values(money).reduce((s, n) => s + n, 0);
  return {
    trainers: { ゆうと: yuto, たけはる: take, りょう: ryo, ひろむ: hiromu, せいや: seiya },
    money,
    total,
    pct: Math.round((total / REVENUE_YEN) * 1000) / 10,
    ryoShinjukuDays,
  };
}

function overlaps(a, b) {
  return mins(a.start_local) < mins(b.end_local) && mins(a.end_local) > mins(b.start_local);
}

function validate(rows) {
  const errors = [];
  const byTrainerDay = new Map();
  for (const r of rows) {
    const k = `${r.trainer_name}|${r.shift_date}`;
    if (!byTrainerDay.has(k)) byTrainerDay.set(k, []);
    byTrainerDay.get(k).push(r);
  }
  for (const [k, list] of byTrainerDay) {
    const sorted = list.slice().sort((a, b) => mins(a.start_local) - mins(b.start_local));
    for (let i = 0; i < sorted.length; i++) {
      for (let j = i + 1; j < sorted.length; j++) {
        if (overlaps(sorted[i], sorted[j])) errors.push(`同一トレーナーが重なっています: ${k}`);
      }
    }
    for (let i = 0; i + 1 < sorted.length; i++) {
      if (sorted[i].store_name !== sorted[i + 1].store_name) {
        const gap = mins(sorted[i + 1].start_local) - mins(sorted[i].end_local);
        if (gap < 180) errors.push(`店舗間が3時間未満です: ${k} ${gap}分`);
      }
    }
  }

  const byStoreDay = new Map();
  for (const r of rows) {
    const k = `${r.store_name}|${r.shift_date}`;
    if (!byStoreDay.has(k)) byStoreDay.set(k, []);
    byStoreDay.get(k).push(r);
    if (r.trainer_name === "たけはる" && r.store_name !== "桜木町") errors.push(`たけはるが桜木町以外です: ${r.shift_date} ${r.store_name}`);
    if (["こうへい", "あいと", "だいき"].includes(r.trainer_name)) errors.push(`希望がない人を入れています: ${r.trainer_name}`);
    const closes1430 = !(r.shift_date === "2026-12-06" && r.trainer_name === "たけはる");
    if (closes1430 && r.store_name === "桜木町" && mins(r.start_local) < 15 * 60 + 30 && mins(r.end_local) > 14 * 60 + 30) {
      errors.push(`桜木町の14:30–15:30が開いています: ${r.shift_date} ${r.trainer_name}`);
    }
  }
  for (const [k, list] of byStoreDay) {
    const store = k.split("|")[0];
    if (store !== "上野" && store !== "新宿") continue;
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        if (list[i].trainer_name !== list[j].trainer_name && overlaps(list[i], list[j])) {
          errors.push(`${store}が同時2人です: ${k}`);
        }
      }
    }
  }

  for (const [date, list] of byTrainerDay) {
    const [name, day] = date.split("|");
    if (name !== "せいや" && name !== "ひろむ") continue;
    const other = name === "せいや" ? "ひろむ" : "せいや";
    const otherRows = byTrainerDay.get(`${other}|${day}`) ?? [];
    if (!otherRows.length) continue;
    const stores = new Set(list.map((r) => r.store_name));
    for (const r of otherRows) {
      if (stores.has(r.store_name)) errors.push(`せいやとひろむが同じ店です: ${day} ${r.store_name}`);
    }
  }

  for (const r of rows) {
    if (r.trainer_name !== "せいや" && r.trainer_name !== "りょう") continue;
    const startMin = mins(r.start_local);
    const endMin = mins(r.end_local);
    const expected = startMin < 16 * 60 && endMin > 16 * 60 ? 2 : 1;
    if ((r.breaks ?? []).length !== expected) {
      errors.push(`${r.trainer_name}の休憩回数が${expected}ではありません: ${r.shift_date} ${r.start_local} ${(r.breaks ?? []).length}`);
    }
  }
  for (const r of rows) {
    if (r.trainer_name !== "ゆうと" && r.trainer_name !== "たけはる") continue;
    const expected = hours(r.start_local, r.end_local) >= 7 ? 2 : 0;
    if ((r.breaks ?? []).length !== expected) {
      errors.push(`${r.trainer_name}の休憩回数が${expected}ではありません: ${r.shift_date} ${r.start_local} ${(r.breaks ?? []).length}`);
    }
  }

  const seiyaKey = (date, start, end) => `${date}|${start}|${end}`;
  const expectedSeiya = new Set(SEIYA_SHIFTS.map(([date, start, end]) => seiyaKey(date, start, end)));
  const actualSeiya = rows.filter((r) => r.trainer_name === "せいや");
  if (actualSeiya.length !== expectedSeiya.size) errors.push(`せいやの勤務が12件ではありません: ${actualSeiya.length}`);
  for (const r of actualSeiya) {
    const key = seiyaKey(r.shift_date, r.start_local.slice(0, 5), r.end_local.slice(0, 5));
    if (!expectedSeiya.has(key) || r.store_name !== "上野") errors.push(`せいやの希望と違います: ${key} ${r.store_name}`);
  }

  const off = (name, days) => {
    for (const day of days) {
      if (rows.some((r) => r.shift_date === ymd(day) && r.trainer_name === name)) errors.push(`${name}の休みです: ${ymd(day)}`);
    }
  };
  off("ひろむ", [25]);
  off("たけはる", [2, 5, 7, 12, 13, 19, 20, 24, 26, 31]);
  off("りょう", [1, 7, 14, 25]);
  off("ゆうと", [5, 8, 11, 12, 15, 19, 22, 25, 26]);

  const yuto6 = rows.filter((r) => r.shift_date === ymd(6) && r.trainer_name === "ゆうと");
  if (yuto6.length !== 1 || yuto6[0].store_name !== "恵比寿" || yuto6[0].start_local.slice(0, 5) !== "09:00" || yuto6[0].end_local.slice(0, 5) !== "15:00") {
    errors.push("ゆうとの12/6は恵比寿09:00–15:00ではありません");
  }
  const hiromu24 = rows.filter((r) => r.shift_date === ymd(24) && r.trainer_name === "ひろむ");
  if (hiromu24.length !== 1 || hiromu24[0].store_name !== "上野" || hiromu24[0].start_local.slice(0, 5) !== "09:00" || hiromu24[0].end_local.slice(0, 5) !== "17:00") {
    errors.push("ひろむの12/24は上野09:00–17:00ではありません");
  }
  const ryoMust = [
    [2, "09:00", "16:00"],
    [3, "09:00", "15:00"],
    [26, "09:00", "13:00"],
  ];
  for (const [day, start, end] of ryoMust) {
    const hit = rows.some(
      (r) => r.shift_date === ymd(day) && r.trainer_name === "りょう" && r.start_local.slice(0, 5) === start && r.end_local.slice(0, 5) === end,
    );
    if (!hit) errors.push(`りょうの必須勤務がありません: ${ymd(day)} ${start}-${end}`);
  }
  const take6 = rows.filter((r) => r.shift_date === ymd(6) && r.trainer_name === "たけはる");
  if (take6.length !== 1 || take6[0].start_local.slice(0, 5) !== "09:00" || take6[0].end_local.slice(0, 5) !== "17:00") {
    errors.push("たけはるの12/6は09:00–17:00ではありません");
  }

  const hiromuDays = [...new Set(rows.filter((r) => r.trainer_name === "ひろむ").map((r) => r.shift_date))].sort();
  for (let i = 1; i < hiromuDays.length; i++) {
    const prev = hiromuDays[i - 1];
    const cur = hiromuDays[i];
    const prevDate = new Date(`${prev}T00:00:00Z`);
    const curDate = new Date(`${cur}T00:00:00Z`);
    if ((curDate - prevDate) / 86400000 !== 1) continue;
    const prevStore = rows.find((r) => r.trainer_name === "ひろむ" && r.shift_date === prev).store_name;
    const curRows = rows.filter((r) => r.trainer_name === "ひろむ" && r.shift_date === cur);
    const curStore = curRows[0].store_name;
    if (prevStore === curStore) continue;
    const start = Math.min(...curRows.map((r) => mins(r.start_local)));
    if (start < 12 * 60 || start > 14 * 60) errors.push(`ひろむの店舗変更で開始が2〜4時間遅れではありません: ${cur} ${curStore}`);
  }

  for (let day = 1; day <= 31; day++) {
    const date = ymd(day);
    const dow = weekday(date);
    if (dow === 0 || dow === 6 || day === 25 || WINTER_CLOSED_DAYS.has(day)) continue;
    const night = rows.some(
      (r) => r.shift_date === date && r.store_name === "新宿" && mins(r.start_local) <= 16 * 60 && mins(r.end_local) >= 21 * 60 + 30,
    );
    if (!night) errors.push(`平日の新宿の夜がありません: ${date}`);
    if (dow === 5) {
      const fri = rows.some(
        (r) => r.shift_date === date && r.store_name === "上野" && mins(r.start_local) <= 17 * 60 && mins(r.end_local) >= 18 * 60,
      );
      if (!fri) errors.push(`金曜の上野17時がありません: ${date}`);
    }
    if (dow === 1) {
      const late = rows.some((r) => r.shift_date === date && r.store_name === "桜木町" && mins(r.end_local) > 16 * 60);
      if (late) errors.push(`桜木町の月曜の夜が開いています: ${date}`);
      if (day !== 7) {
        const morning = rows.some(
          (r) => r.shift_date === date && r.store_name === "桜木町" && mins(r.start_local) <= 9 * 60 && mins(r.end_local) > 9 * 60,
        );
        if (!morning) errors.push(`桜木町の月曜9時がありません: ${date}`);
      }
    }
  }

  for (const day of [4, 11, 18, 25]) {
    const date = ymd(day);
    const present = (t0, t1) => {
      const names = new Set();
      for (const r of rows) {
        if (r.shift_date !== date || r.store_name !== "桜木町") continue;
        if (mins(r.start_local) <= t0 && mins(r.end_local) >= t1) names.add(r.trainer_name);
      }
      return names.size;
    };
    if (day === 4) {
      if (present(9 * 60, 11 * 60) !== 2) errors.push("12/4 09:00–11:00が2人ではありません");
      if (present(11 * 60, 13 * 60) !== 1) errors.push("12/4 11:00–13:00が1人ではありません");
      if (present(16 * 60, 21 * 60) !== 2) errors.push("12/4 16:00–21:00が2人ではありません");
    } else if (present(9 * 60, 11 * 60) > 1 || present(16 * 60, 21 * 60) > 1) {
      errors.push(`桜木町の金曜2人が12/4以外にあります: ${date}`);
    }
  }

  const takeDays = [...new Set(rows.filter((r) => r.trainer_name === "たけはる").map((r) => r.shift_date))].sort();
  for (let i = 1; i < takeDays.length; i++) {
    const prev = takeDays[i - 1];
    const cur = takeDays[i];
    const prevEnd = Math.max(...rows.filter((r) => r.trainer_name === "たけはる" && r.shift_date === prev).map((r) => mins(r.end_local)));
    const curStart = Math.min(...rows.filter((r) => r.trainer_name === "たけはる" && r.shift_date === cur).map((r) => mins(r.start_local)));
    const gapDays = (new Date(`${cur}T00:00:00Z`) - new Date(`${prev}T00:00:00Z`)) / 86400000;
    if (gapDays === 1 && prevEnd >= 22 * 60 && curStart < 10 * 60) {
      errors.push(`たけはるの翌日が10時より前です: ${prev} → ${cur}`);
    }
  }

  const weekOf = (date) => {
    const [y, m, d] = date.split("-").map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    dt.setUTCDate(dt.getUTCDate() - ((dt.getUTCDay() + 6) % 7));
    return dt.toISOString().slice(0, 10);
  };
  for (const name of ["ひろむ", "ゆうと", "たけはる"]) {
    const weeks = new Map();
    for (const r of rows) {
      if (r.trainer_name !== name) continue;
      if (!weeks.has(weekOf(r.shift_date))) weeks.set(weekOf(r.shift_date), new Set());
      weeks.get(weekOf(r.shift_date)).add(r.shift_date);
    }
    for (const [week, days] of weeks) {
      if (days.size > 5) errors.push(`${name}が週5日を超えています: ${week} ${days.size}日`);
    }
  }

  const offDaysOf = (name) => {
    const worked = new Set(rows.filter((r) => r.trainer_name === name).map((r) => Number(r.shift_date.slice(8))));
    const days = [];
    for (let day = 1; day <= 31; day++) if (!worked.has(day)) days.push(day);
    return days;
  };
  const expectOffs = (name, days) => {
    const actual = offDaysOf(name).join(",");
    const expected = days.join(",");
    if (actual !== expected) errors.push(`${name}の所定公休が11日と一致しません: ${actual}`);
  };
  expectOffs("ゆうと", [5, 8, 11, 12, 15, 19, 22, 25, 26, 30, 31]);
  expectOffs("たけはる", [2, 5, 7, 12, 13, 19, 20, 24, 26, 30, 31]);

  if (errors.length) throw new Error(errors.join("\n"));
}

function calendar(rows) {
  const wd = "日月火水木金土";
  const by = new Map();
  for (const r of rows) {
    if (!by.has(r.shift_date)) by.set(r.shift_date, []);
    by.get(r.shift_date).push(`${r.store_name} ${r.trainer_name} ${r.start_local.slice(0, 5)}–${r.end_local.slice(0, 5)}`);
  }
  const lines = [];
  for (let day = 1; day <= 31; day++) {
    const date = ymd(day);
    const items = by.get(date) ?? ["休み"];
    const grouped = new Map();
    for (const item of items) {
      if (item === "休み") continue;
      const [store, ...rest] = item.split(" ");
      if (!grouped.has(store)) grouped.set(store, []);
      grouped.get(store).push(rest.join(" "));
    }
    const text = grouped.size
      ? [...grouped.entries()].map(([store, people]) => `${store} ${people.join("、")}`).join(" / ")
      : "休み";
    lines.push(`${date}(${wd[weekday(date)]}) ${text}`);
  }
  return lines;
}

async function countDecemberReservations(supabase, storeIds, fetchAllChecked) {
  const { count, fetched } = await fetchAllChecked(
    supabase,
    "reservations",
    "id",
    (q) =>
      q
        .in("store_id", storeIds)
        .gte("start_at", MONTH_START_ISO)
        .lt("start_at", NEXT_MONTH_START)
        .neq("status", "cancelled"),
    "reservations.2026-12.tokyo",
  );
  return { count, fetched };
}

function assertPlan(rows) {
  const slots = countSlots(rows);
  const pay = estimatePayroll(rows);
  if (pay.total > LABOR_BUDGET_YEN) throw new Error(`人件費が予算を超えています: ${pay.total}`);
  if (pay.total > LABOR_CAP_YEN) throw new Error(`人件費が35%を超えています: ${pay.total}`);
  if (pay.total !== EXPECT_PAY_YEN) throw new Error(`人件費見積がずれています: ${pay.total} ${JSON.stringify(pay.trainers)} ${JSON.stringify(pay.money)}`);
  if (pay.trainers["ゆうと"].days !== 20 || pay.trainers["ゆうと"].hours !== 120) {
    throw new Error(`ゆうとが20日・120時間ではありません: ${JSON.stringify(pay.trainers["ゆうと"])}`);
  }
  if (pay.trainers["たけはる"].days !== 20 || pay.trainers["たけはる"].hours !== 166) {
    throw new Error(`たけはるが20日・166時間ではありません: ${JSON.stringify(pay.trainers["たけはる"])}`);
  }
  if (slots.total !== EXPECT_SLOTS) throw new Error(`公開枠が${EXPECT_SLOTS}ではありません: ${slots.total} ${JSON.stringify(slots.per)}`);
  if (slots.per["新宿"] !== 420) throw new Error(`新宿が420枠ではありません: ${slots.per["新宿"]}`);
  if ((slots.per["桜木町"] ?? 0) >= 419) throw new Error(`桜木町が11月の419枠以上です: ${slots.per["桜木町"]}`);
  for (const day of WINTER_CLOSED_DAYS) {
    if (rows.some((r) => r.shift_date === ymd(day))) throw new Error(`冬季休館に勤務があります: ${ymd(day)}`);
  }
  return { slots, pay };
}

export async function applyDecemberTokyoShifts(supabase) {
  const rows = rowsFromShifts();
  validate(rows);
  assertPlan(rows);
  const { fetchAllChecked } = await import("./lib/supabaseFetchAll.mjs");
  const storesResult = await fetchAllChecked(supabase, "stores", "id, name", (q) => q.in("name", STORE_NAMES), "stores.tokyo");
  const storeIdByName = new Map(storesResult.rows.map((s) => [s.name, s.id]));
  for (const name of STORE_NAMES) {
    if (!storeIdByName.get(name)) throw new Error(`店舗がありません: ${name}`);
  }
  const storeIds = STORE_NAMES.map((name) => storeIdByName.get(name));
  const reservations = await countDecemberReservations(supabase, storeIds, fetchAllChecked);
  if (reservations.count !== 0) {
    throw new Error(`12月の東京4店舗に予約が${reservations.count}件あります。--apply を中止しました。`);
  }
  const trainerNames = [...new Set(rows.map((r) => r.trainer_name))];
  const trainersResult = await fetchAllChecked(
    supabase,
    "trainers",
    "id, display_name",
    (q) => q.in("display_name", trainerNames),
    "trainers.dec",
  );
  const trainerIdByName = new Map(trainersResult.rows.map((t) => [t.display_name, t.id]));
  for (const name of trainerNames) {
    if (!trainerIdByName.get(name)) throw new Error(`トレーナーがありません: ${name}`);
  }
  const existing = await fetchAllChecked(
    supabase,
    "trainer_shifts",
    "id",
    (q) => q.in("store_id", storeIds).gte("shift_date", MONTH_START).lte("shift_date", MONTH_END),
    "trainer_shifts.2026-12.tokyo",
  );
  const payload = rows.map((r) => ({
    trainer_id: trainerIdByName.get(r.trainer_name),
    store_id: storeIdByName.get(r.store_name),
    shift_date: r.shift_date,
    start_local: r.start_local,
    end_local: r.end_local,
    break_minutes: r.break_minutes,
    status: SHIFT_STATUS,
    is_break: false,
  }));
  const ids = existing.rows.map((r) => r.id);
  for (let i = 0; i < ids.length; i += 200) {
    const { error } = await supabase.from("trainer_shifts").delete().in("id", ids.slice(i, i + 200));
    if (error) throw error;
  }
  const inserted = [];
  for (let i = 0; i < payload.length; i += 200) {
    const { data, error } = await supabase.from("trainer_shifts").insert(payload.slice(i, i + 200)).select("id, trainer_id, store_id, shift_date, start_local, end_local");
    if (error) throw error;
    inserted.push(...(data ?? []));
  }
  const breakRows = [];
  for (const insertedRow of inserted) {
    const src = rows.find(
      (r) =>
        trainerIdByName.get(r.trainer_name) === insertedRow.trainer_id &&
        storeIdByName.get(r.store_name) === insertedRow.store_id &&
        r.shift_date === insertedRow.shift_date &&
        mins(r.start_local) === mins(insertedRow.start_local) &&
        mins(r.end_local) === mins(insertedRow.end_local),
    );
    for (const b of src?.breaks ?? []) breakRows.push({ shift_id: insertedRow.id, start_time: b.start, end_time: b.end });
  }
  for (let i = 0; i < breakRows.length; i += 200) {
    const { error } = await supabase.from("trainer_shift_breaks").insert(breakRows.slice(i, i + 200));
    if (error) throw error;
  }
  return { applied: true, shiftStatus: SHIFT_STATUS, deleted: ids.length, inserted: inserted.length, breaks: breakRows.length, decemberReservations: reservations.count };
}

async function main() {
  const apply = process.argv.includes("--apply");
  const dryRun = !apply || process.argv.includes("--dry-run");
  const rows = rowsFromShifts();
  validate(rows);
  const { slots, pay } = assertPlan(rows);
  const summary = {
    month: MONTH,
    willApply: !dryRun,
    shiftStatus: SHIFT_STATUS,
    stores: STORE_NAMES,
    fukuoka: "変更なし",
    slots: slots.total,
    slotsByStore: slots.per,
    payrollYen: pay.total,
    payrollPct: pay.pct,
    payrollCapYen: LABOR_CAP_YEN,
    revenueYen: REVENUE_YEN,
    trainers: pay.trainers,
    money: pay.money,
    calendar: calendar(rows),
  };
  console.log(JSON.stringify(summary, null, 2));
  if (dryRun) return;
  const { createClient } = await import("@supabase/supabase-js");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY が未設定です。");
  const supabase = createClient(url, key, { auth: { persistSession: false } });
  console.log(JSON.stringify(await applyDecemberTokyoShifts(supabase), null, 2));
}

const invokedDirectly = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (invokedDirectly) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
