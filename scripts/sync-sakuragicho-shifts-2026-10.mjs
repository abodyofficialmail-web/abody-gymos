import { createClient } from "@supabase/supabase-js";
import { fetchAllChecked } from "./lib/supabaseFetchAll.mjs";
import { UENO_MAX_BOOTHS, UENO_STORE_NAME } from "./sync-ueno-shifts-2026-10.mjs";

/**
 * 2026-10 桜木町店（たけはる・りょう）
 *
 * - 目標枠: アクティブ会員×12
 * - 同時1ブース
 * - たけはる 178h / 月（平日16–22・土日10–19）、週2休、残り日・枠はりょう
 * - りょう: 土日 10:00–19:00（10/10 のみ 10–16）、10/19 は休み
 * - たけはる土日（10/10除く）: 10:00–19:00（13–14 休憩1h）
 *
 * node --env-file=.env.local scripts/sync-sakuragicho-shifts-2026-10.mjs --dry-run
 */
const MONTH = "2026-10";
const MONTH_LAST_DAY = "31";
const STORE_NAME = "桜木町";
const TRAINER_TAKE = "たけはる";
const TRAINER_RYO = "りょう";
const TRAINER_NAMES = [TRAINER_TAKE, TRAINER_RYO];
const SHIFT_STATUS = "confirmed";
const TAKE_TARGET_WORK_HOURS = 178;
/** たけはる: 月〜日の週あたり休み日数 */
const TAKE_OFF_PER_WEEK = 2;
/** たけはる: 連勤上限（超えたら追加休み） */
const TAKE_MAX_CONSECUTIVE_WORK = 5;

const SINGLE_BOOTH = new Set(["恵比寿", "新宿", "桜木町"]);

const RYO_OFF_DAYS = new Set([1, 7, 14, 19, 20, 26]);
/** 10/6・10/8 休み、10/15 は研修でシフトアウト */
const TAKE_OFF_DAYS = new Set([6, 8, 15]);
/** たけはる不在日はりょうがフルにカバー */
const RYO_COVER_FULL_DAYS = new Set([15]);
/** たけはる休み（6・8）— りょうはフル不可 */
const RYO_TAKE_OFF_COVER_DAYS = new Set([6, 8]);

/** 10-13 / 15-16（中抜け1h勤務）/ 16-22 */
const TAKE_PM_BASE = "22:00";
const TAKE_PM_MAX = "22:00";
const TAKE_TEMPLATE = {
  segments: [
    ["10:00", "13:00"],
    ["15:00", "16:00"],
    ["16:00", TAKE_PM_BASE],
  ],
  breakMinutes: 0,
};

/** 10/10 りょうのみ 10:00–16:00 */
const RYO_DAY10_TEMPLATE = {
  key: "day10",
  segments: [["10:00", "16:00"]],
  breakMinutes: 0,
};

/** 土日（10/10除く）10:00–19:00（13–14 休憩1h） */
const RYO_WEEKEND_1019_TEMPLATE = {
  key: "weekend1019",
  segments: [
    ["10:00", "13:00"],
    ["14:00", "19:00"],
  ],
  breakMinutes: 60,
};

/** たけはる土日（10/10除く） */
const TAKE_WEEKEND_1019_TEMPLATE = {
  segments: [
    ["10:00", "13:00"],
    ["14:00", "19:00"],
  ],
  breakMinutes: 60,
};

const RYO_DAY10_NUM = 10;

function isWeekendDate(date) {
  const dow = parseLocalDate(date).getDay();
  return dow === 0 || dow === 6;
}

function isWeekendExceptDay10(date) {
  return isWeekendDate(date) && dayNum(date) !== RYO_DAY10_NUM;
}

/** 10/10 りょう 10–16 固定 */
function ryoWeekendDay10FixedDate(date) {
  return dayNum(date) === RYO_DAY10_NUM;
}

function takeWeekend1019Date(date) {
  return isWeekendExceptDay10(date);
}

const RYO_TEMPLATES = [
  { key: "full", segments: [["09:00", "13:00"], ["16:00", "22:00"]], breakMinutes: 60 },
  { key: "med", segments: [["10:00", "13:00"], ["16:00", "21:00"]], breakMinutes: 60 },
  { key: "pm", segments: [["14:00", "17:00"], ["18:00", "21:30"]], breakMinutes: 60 },
  { key: "short", segments: [["14:00", "17:00"], ["18:00", "20:00"]], breakMinutes: 60 },
  { key: "miniLong2", segments: [["16:00", "21:00"]], breakMinutes: 0 },
  { key: "miniLong", segments: [["16:00", "20:00"]], breakMinutes: 0 },
  { key: "mini", segments: [["16:00", "19:00"]], breakMinutes: 0 },
];

function isActiveMember(m) {
  const ms = String(m.membership_status ?? "").toLowerCase();
  if (ms === "active") return true;
  if (ms === "hiatus" || ms === "withdrawn") return false;
  return m.is_active === true;
}

function parseActiveOverride(argv) {
  const a = argv.find((x) => x.startsWith("--active="));
  if (!a) return null;
  const n = Number(a.split("=")[1]);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
}

function norm(s) {
  return String(s ?? "").replace(/\u3000/g, " ").trim();
}

function toHHMMSS(hhmm) {
  const s = norm(hhmm);
  if (!/^\d{2}:\d{2}$/u.test(s)) throw new Error(`時刻形式が不正です: ${hhmm}`);
  return `${s}:00`;
}

function toMinutes(hhmm) {
  const [hh, mm] = norm(hhmm).slice(0, 5).split(":").map(Number);
  return hh * 60 + mm;
}

function row(date, start, end, trainer, break_minutes = 0) {
  return {
    shift_date: date,
    start_local: toHHMMSS(start),
    end_local: toHHMMSS(end),
    trainer_name: trainer,
    store_name: STORE_NAME,
    break_minutes,
  };
}

function octDate(dayNum) {
  return `${MONTH}-${String(dayNum).padStart(2, "0")}`;
}

function allOctoberDates() {
  const out = [];
  for (let d = 1; d <= 31; d++) out.push(octDate(d));
  return out;
}

function dayNum(date) {
  return Number(date.slice(-2));
}

function workHoursForSegments(segments) {
  return segments.reduce((h, [s, e]) => h + (toMinutes(e) - toMinutes(s)) / 60, 0);
}

function rowsForTemplate(date, trainer, template) {
  const br = template.breakMinutes ?? 0;
  return template.segments.map(([s, e], i) => row(date, s, e, trainer, i === 0 ? br : 0));
}

function effectiveStoreSlots(rows) {
  const byStoreDate = new Map();
  for (const r of rows) {
    const k = `${r.store_name}|${r.shift_date}`;
    if (!byStoreDate.has(k)) byStoreDate.set(k, []);
    byStoreDate.get(k).push(r);
  }
  let total = 0;
  for (const [, dayRows] of byStoreDate) {
    let daySlots = 0;
    for (let t = 540; t < 1320; t += 30) {
      let cap = 0;
      for (const r of dayRows) {
        const s = toMinutes(r.start_local);
        const e = toMinutes(r.end_local);
        if (s <= t && t + 30 <= e) cap++;
      }
      const store = dayRows[0]?.store_name;
      if (store === UENO_STORE_NAME) cap = Math.min(cap, UENO_MAX_BOOTHS);
      else if (SINGLE_BOOTH.has(store)) cap = cap > 0 ? 1 : 0;
      daySlots += cap;
    }
    total += daySlots;
  }
  return total;
}

function countSlots(rows) {
  return effectiveStoreSlots(rows);
}

function slotsForTemplate(template) {
  return countSlots(rowsForTemplate("2000-01-01", "x", template));
}

function takeStandardHours() {
  return workHoursForSegments(TAKE_TEMPLATE.segments);
}

function templateWorkHours(template) {
  return workHoursForSegments(template.segments);
}

function takeHoursForPmEnd(pmEnd) {
  const pmMin = toMinutes(pmEnd);
  if (pmMin <= 16 * 60) return 4;
  return workHoursForSegments([
    ["10:00", "13:00"],
    ["15:00", "16:00"],
    ["16:00", pmEnd],
  ]);
}

function takeHoursForDate(date, pmEnd) {
  if (takeWeekend1019Date(date)) {
    return (
      workHoursForSegments(TAKE_WEEKEND_1019_TEMPLATE.segments) -
      (TAKE_WEEKEND_1019_TEMPLATE.breakMinutes ?? 0) / 60
    );
  }
  return takeHoursForPmEnd(pmEnd);
}

function parseLocalDate(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function formatLocalDate(d) {
  const yy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

function mondayWeekKey(dateStr) {
  const d = parseLocalDate(dateStr);
  const diff = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - diff);
  return formatLocalDate(d);
}

function groupDatesByMondayWeek(dates) {
  const byWeek = new Map();
  for (const date of dates) {
    const k = mondayWeekKey(date);
    if (!byWeek.has(k)) byWeek.set(k, []);
    byWeek.get(k).push(date);
  }
  return [...byWeek.values()].sort((a, b) => a[0].localeCompare(b[0]));
}

function takeWorksOnDay(day, takeOffDays) {
  if (RYO_OFF_DAYS.has(day)) return true;
  return !takeOffDays.has(day);
}

function maxTakeWorkStreak(dates, takeOffDays) {
  let max = 0;
  let cur = 0;
  for (const date of dates) {
    const n = dayNum(date);
    if (takeWorksOnDay(n, takeOffDays)) {
      cur++;
      max = Math.max(max, cur);
    } else {
      cur = 0;
    }
  }
  return max;
}

function takeOffCountInWeek(weekDates, takeOffDays) {
  return weekDates.filter((d) => takeOffDays.has(dayNum(d))).length;
}

function weekOffTarget(weekDates) {
  const eligible = weekDates.filter((d) => !RYO_OFF_DAYS.has(dayNum(d)));
  if (eligible.length <= 1) return eligible.length;
  return Math.min(TAKE_OFF_PER_WEEK, eligible.length);
}

function scoreTakeOffCandidate(date, dates, takeOffDays) {
  const n = dayNum(date);
  const dow = parseLocalDate(date).getDay();
  let score = 0;
  if (dow === 0 || dow === 6) score += 3;
  const idx = dates.indexOf(date);
  const prevWork = idx > 0 && takeWorksOnDay(dayNum(dates[idx - 1]), takeOffDays);
  const nextWork = idx < dates.length - 1 && takeWorksOnDay(dayNum(dates[idx + 1]), takeOffDays);
  if (prevWork && nextWork) score += 5;
  return score;
}

function tryAddTakeOff(date, takeOffDays, dates) {
  const n = dayNum(date);
  if (RYO_OFF_DAYS.has(n) || takeOffDays.has(n)) return false;
  takeOffDays.add(n);
  return true;
}

function assignTrainerDays(dates) {
  const takeOffDays = new Set(TAKE_OFF_DAYS);

  for (const weekDates of groupDatesByMondayWeek(dates)) {
    const target = weekOffTarget(weekDates);
    let offCount = takeOffCountInWeek(weekDates, takeOffDays);
    const candidates = weekDates.filter(
      (d) => !RYO_OFF_DAYS.has(dayNum(d)) && !takeOffDays.has(dayNum(d)),
    );
    while (offCount < target && candidates.length) {
      candidates.sort(
        (a, b) => scoreTakeOffCandidate(b, dates, takeOffDays) - scoreTakeOffCandidate(a, dates, takeOffDays),
      );
      const pick = candidates.shift();
      takeOffDays.add(dayNum(pick));
      offCount++;
    }
  }

  const targetTakeWorkDays = Math.max(1, Math.round(TAKE_TARGET_WORK_HOURS / takeStandardHours()));
  let takeWorkDays = dates.filter((d) => takeWorksOnDay(dayNum(d), takeOffDays)).length;

  const weeksGrouped = groupDatesByMondayWeek(dates);

  while (takeWorkDays > targetTakeWorkDays) {
    let best = null;
    let bestScore = -1;
    for (const date of dates) {
      const n = dayNum(date);
      if (!takeWorksOnDay(n, takeOffDays)) continue;
      if (TAKE_OFF_DAYS.has(n)) continue;
      const weekDates = weeksGrouped.find((w) => w.includes(date));
      if (!weekDates) continue;
      const offInWeek = takeOffCountInWeek(weekDates, takeOffDays);
      if (offInWeek !== 2) continue;
      const sc = scoreTakeOffCandidate(date, dates, takeOffDays);
      if (sc > bestScore) {
        bestScore = sc;
        best = date;
      }
    }
    if (!best || !tryAddTakeOff(best, takeOffDays, dates)) break;
    takeWorkDays--;
  }

  let guard = 0;
  while (maxTakeWorkStreak(dates, takeOffDays) > TAKE_MAX_CONSECUTIVE_WORK && guard++ < 31) {
    let best = null;
    let bestScore = -1;
    for (const date of dates) {
      const n = dayNum(date);
      if (!takeWorksOnDay(n, takeOffDays)) continue;
      if (TAKE_OFF_DAYS.has(n)) continue;
      const weekDates = weeksGrouped.find((w) => w.includes(date));
      if (!weekDates) continue;
      if (takeOffCountInWeek(weekDates, takeOffDays) >= 3) continue;
      const sc = scoreTakeOffCandidate(date, dates, takeOffDays);
      if (sc > bestScore) {
        bestScore = sc;
        best = date;
      }
    }
    if (!best || !tryAddTakeOff(best, takeOffDays, dates)) break;
  }

  const takeDays = dates.filter((d) => takeWorksOnDay(dayNum(d), takeOffDays));
  const ryoDays = dates.filter((d) => !takeWorksOnDay(dayNum(d), takeOffDays));
  return { takeDays, ryoDays, takeOffDays: [...takeOffDays].sort((a, b) => a - b) };
}

function buildTakeRows(date, pmEnd = TAKE_PM_BASE) {
  if (takeWeekend1019Date(date)) {
    return rowsForTemplate(date, TRAINER_TAKE, TAKE_WEEKEND_1019_TEMPLATE);
  }
  const segments = [
    ["10:00", "13:00"],
    ["15:00", "16:00"],
  ];
  if (toMinutes(pmEnd) > 16 * 60) segments.push(["16:00", pmEnd]);
  return rowsForTemplate(date, TRAINER_TAKE, { segments, breakMinutes: 0 });
}

function tuneTakeHours(takeDays) {
  if (!takeDays.length) return { rows: [], totalTakeHours: 0, scheduledTakeDays: 0 };

  const pmEnds = takeDays.map(() => TAKE_PM_BASE);
  let totalH = takeDays.reduce((s, d, i) => s + takeHoursForDate(d, pmEnds[i]), 0);

  let guard = 0;
  while (totalH < TAKE_TARGET_WORK_HOURS - 0.01 && guard++ < 500) {
    let bumped = false;
    for (let i = 0; i < pmEnds.length; i++) {
      if (toMinutes(pmEnds[i]) >= toMinutes(TAKE_PM_MAX)) continue;
      const nextPm = TAKE_PM_MAX;
      const delta = takeHoursForDate(takeDays[i], nextPm) - takeHoursForDate(takeDays[i], pmEnds[i]);
      if (totalH + delta > TAKE_TARGET_WORK_HOURS + 0.01) continue;
      pmEnds[i] = nextPm;
      totalH += delta;
      bumped = true;
      break;
    }
    if (!bumped) break;
  }

  guard = 0;
  while (totalH > TAKE_TARGET_WORK_HOURS + 0.01 && guard++ < 500) {
    let trimmed = false;
    for (let i = pmEnds.length - 1; i >= 0; i--) {
      if (toMinutes(pmEnds[i]) <= toMinutes(TAKE_PM_BASE)) continue;
      const prevPm = TAKE_PM_BASE;
      const delta = takeHoursForDate(takeDays[i], pmEnds[i]) - takeHoursForDate(takeDays[i], prevPm);
      pmEnds[i] = prevPm;
      totalH -= delta;
      trimmed = true;
      break;
    }
    if (!trimmed) break;
  }

  const rows = takeDays.flatMap((d, i) => buildTakeRows(d, pmEnds[i]));
  return {
    rows,
    totalTakeHours: Math.round(totalH * 10) / 10,
    scheduledTakeDays: takeDays.length,
  };
}

function ryoWorkHoursTarget(ryoDays, scheduledTakeDays) {
  const mini = RYO_TEMPLATES.find((t) => t.key === "mini");
  const full = RYO_TEMPLATES.find((t) => t.key === "full");
  const miniH = templateWorkHours(mini);
  const fullH = templateWorkHours(full);
  let target = 0;
  for (const date of ryoDays) {
    target += RYO_COVER_FULL_DAYS.has(dayNum(date)) ? fullH : miniH;
  }
  target += scheduledTakeDays;
  return Math.round(target * 10) / 10;
}

function planRyoWorkHours(plan) {
  return plan.reduce((s, p) => s + templateWorkHours(p.template), 0);
}

function minRyoTemplateKeyForDate(date) {
  const day = dayNum(date);
  if (ryoWeekendDay10FixedDate(date)) return "day10";
  if (isWeekendExceptDay10(date)) return "weekend1019";
  if (day === 6) return "short";
  return "mini";
}

function maxRyoTemplateKeyForDate(date) {
  const day = dayNum(date);
  if (ryoWeekendDay10FixedDate(date)) return "day10";
  if (isWeekendExceptDay10(date)) return "weekend1019";
  if (RYO_COVER_FULL_DAYS.has(day)) return "full";
  if (RYO_TAKE_OFF_COVER_DAYS.has(day)) return "miniLong";
  if (day >= 21) return "short";
  return "miniLong2";
}

function templateRank(key) {
  const order = ["day10", "weekend1019", "mini", "miniLong", "miniLong2", "short", "pm", "med", "full"];
  const i = order.indexOf(key);
  return i >= 0 ? i : order.length;
}

function ryoUpgradeDayPriority(date) {
  const d = dayNum(date);
  if (d >= 21) return 0;
  if (RYO_TAKE_OFF_COVER_DAYS.has(d)) return 2;
  return 1;
}

function pickRyoTemplates(ryoDays, slotsNeeded, scheduledTakeDays) {
  if (!ryoDays.length) return [];
  const opts = RYO_TEMPLATES.map((t) => ({
    template: t,
    slots: slotsForTemplate(t),
    workHours: templateWorkHours(t),
  })).sort((a, b) => a.slots - b.slots);
  const fullOpt = opts.find((o) => o.template.key === "full") ?? opts[opts.length - 1];
  const workHoursTarget = ryoWorkHoursTarget(ryoDays, scheduledTakeDays);

  const shortOpt = opts.find((o) => o.template.key === "short") ?? opts[Math.min(2, opts.length - 1)];

  const day10Slots = slotsForTemplate(RYO_DAY10_TEMPLATE);
  const weekend1019Slots = slotsForTemplate(RYO_WEEKEND_1019_TEMPLATE);

  const plan = ryoDays.map((date) => {
    const day = dayNum(date);
    if (ryoWeekendDay10FixedDate(date)) {
      return { date, template: RYO_DAY10_TEMPLATE, slots: day10Slots, key: "day10" };
    }
    if (isWeekendExceptDay10(date)) {
      return {
        date,
        template: RYO_WEEKEND_1019_TEMPLATE,
        slots: weekend1019Slots,
        key: "weekend1019",
      };
    }
    if (RYO_COVER_FULL_DAYS.has(day)) {
      return { date, template: fullOpt.template, slots: fullOpt.slots, key: fullOpt.template.key };
    }
    if (day === 6) {
      return { date, template: shortOpt.template, slots: shortOpt.slots, key: shortOpt.template.key };
    }
    return {
      date,
      template: opts[0].template,
      slots: opts[0].slots,
      key: opts[0].template.key,
    };
  });

  let sum = plan.reduce((s, p) => s + p.slots, 0);

  let guard = 0;
  while (sum < slotsNeeded && guard++ < 500) {
    let upgraded = false;
    for (let i = 0; i < plan.length; i++) {
      if (ryoWeekendDay10FixedDate(plan[i].date) || isWeekendExceptDay10(plan[i].date)) continue;
      if (RYO_COVER_FULL_DAYS.has(dayNum(plan[i].date))) continue;
      for (const opt of opts) {
        if (opt.slots <= plan[i].slots) continue;
        const next = sum - plan[i].slots + opt.slots;
        if (next <= slotsNeeded + 4) {
          sum = next;
          plan[i] = { date: plan[i].date, template: opt.template, slots: opt.slots, key: opt.template.key };
          upgraded = true;
          break;
        }
      }
      if (upgraded) break;
    }
    if (!upgraded) break;
  }

  guard = 0;
  while (sum > slotsNeeded && guard++ < 500) {
    let downgraded = false;
    for (let i = 0; i < plan.length; i++) {
      const day = dayNum(plan[i].date);
      if (ryoWeekendDay10FixedDate(plan[i].date) || isWeekendExceptDay10(plan[i].date)) continue;
      if (RYO_COVER_FULL_DAYS.has(day)) continue;
      const minKey = minRyoTemplateKeyForDate(plan[i].date);
      for (const opt of opts) {
        if (opt.slots >= plan[i].slots) continue;
        if (templateRank(opt.template.key) < templateRank(minKey)) continue;
        const next = sum - plan[i].slots + opt.slots;
        if (next >= slotsNeeded - 2) {
          sum = next;
          plan[i] = { date: plan[i].date, template: opt.template, slots: opt.slots, key: opt.template.key };
          downgraded = true;
          break;
        }
      }
      if (downgraded) break;
    }
    if (!downgraded) break;
  }

  /** 10/15フル＋短日延長分（枠はやや上振れ可） */
  const slotCeiling = slotsNeeded + 46;

  guard = 0;
  while (planRyoWorkHours(plan) < workHoursTarget - 0.01 && guard++ < 500) {
    const order = plan
      .map((p, i) => i)
      .sort((a, b) => ryoUpgradeDayPriority(plan[a].date) - ryoUpgradeDayPriority(plan[b].date));

    let upgraded = false;
    for (const i of order) {
      if (ryoWeekendDay10FixedDate(plan[i].date) || isWeekendExceptDay10(plan[i].date)) continue;
      if (RYO_COVER_FULL_DAYS.has(dayNum(plan[i].date))) continue;
      const day = dayNum(plan[i].date);
      const maxKey = maxRyoTemplateKeyForDate(plan[i].date);
      const curWh = templateWorkHours(plan[i].template);
      const nextOpt = opts
        .filter(
          (o) =>
            o.workHours > curWh + 0.01 && templateRank(o.template.key) <= templateRank(maxKey),
        )
        .sort((a, b) => a.workHours - b.workHours)[0];
      if (!nextOpt) continue;
      const nextSum = sum - plan[i].slots + nextOpt.slots;
      if (nextSum > slotCeiling) continue;
      sum = nextSum;
      plan[i] = {
        date: plan[i].date,
        template: nextOpt.template,
        slots: nextOpt.slots,
        key: nextOpt.template.key,
      };
      upgraded = true;
      break;
    }
    if (!upgraded) break;
  }

  return plan;
}

function buildRows(targetSlots) {
  const dates = allOctoberDates();
  const { takeDays, ryoDays } = assignTrainerDays(dates);

  const { rows: takeRows, totalTakeHours, scheduledTakeDays } = tuneTakeHours(takeDays);
  const takeSlots = countSlots(takeRows);
  const needRyoSlots = Math.max(0, targetSlots - takeSlots);

  const ryoPlan = pickRyoTemplates(ryoDays, needRyoSlots, scheduledTakeDays);
  const ryoRows = ryoPlan.flatMap(({ date, template }) => rowsForTemplate(date, TRAINER_RYO, template));

  const rows = [...takeRows, ...ryoRows];
  return {
    rows,
    slots: countSlots(rows),
    targetSlots,
    takeDays,
    ryoDays,
    totalTakeHours,
    takeSlots,
    ryoSlots: countSlots(ryoRows),
    ryoPlan: ryoPlan.map(({ date, template, slots }) => ({
      date,
      template: template.key,
      slots,
    })),
  };
}

function validateNoTrainerOverlap(rows) {
  const byTrainerDay = new Map();
  for (const r of rows) {
    const key = `${r.trainer_name}|${r.shift_date}`;
    const list = byTrainerDay.get(key) ?? [];
    list.push(r);
    byTrainerDay.set(key, list);
  }
  for (const [, list] of byTrainerDay) {
    const sorted = list.slice().sort((a, b) => toMinutes(a.start_local) - toMinutes(b.start_local));
    for (let i = 0; i < sorted.length; i++) {
      for (let j = i + 1; j < sorted.length; j++) {
        if (
          toMinutes(sorted[i].start_local) < toMinutes(sorted[j].end_local) &&
          toMinutes(sorted[i].end_local) > toMinutes(sorted[j].start_local)
        ) {
          throw new Error(`同一トレーナー重複: ${sorted[i].shift_date} ${sorted[i].trainer_name}`);
        }
      }
    }
  }
}

function validateSingleBoothPerDay(rows) {
  const byDate = new Map();
  for (const r of rows) {
    const list = byDate.get(r.shift_date) ?? [];
    list.push(r);
    byDate.set(r.shift_date, list);
  }
  for (const [date, dayRows] of byDate) {
    const trainers = new Set(dayRows.map((r) => r.trainer_name));
    if (trainers.size > 1) {
      throw new Error(`同日複数トレーナー: ${date} ${[...trainers].join("+")}`);
    }
  }
}

function summarize(rows, plan, targetSlots, activeMembers) {
  const byTrainer = new Map();
  for (const r of rows) {
    const t = byTrainer.get(r.trainer_name) ?? { days: new Set(), workMinutes: 0, breakMinutes: 0 };
    t.days.add(r.shift_date);
    t.workMinutes += toMinutes(r.end_local) - toMinutes(r.start_local);
    t.breakMinutes += r.break_minutes ?? 0;
    byTrainer.set(r.trainer_name, t);
  }
  return {
    store: STORE_NAME,
    activeMembers,
    targetSlots,
    slots: plan.slots,
    slotPctOfTarget: targetSlots ? Math.round((plan.slots / targetSlots) * 1000) / 10 : null,
    takeTargetWorkHours: TAKE_TARGET_WORK_HOURS,
    takeActualWorkHours: plan.totalTakeHours,
    trainers: [...byTrainer.entries()].map(([name, v]) => ({
      name,
      days: v.days.size,
      workHours: Math.round((v.workMinutes / 60) * 10) / 10,
      breakHours: Math.round((v.breakMinutes / 60) * 10) / 10,
    })),
  };
}

async function loadActiveStoreCount(supabase) {
  const [membersResult, storesResult] = await Promise.all([
    fetchAllChecked(supabase, "members", "id, store_id, is_active, membership_status", undefined, "members"),
    fetchAllChecked(supabase, "stores", "id, name", undefined, "stores"),
  ]);
  const storeId = storesResult.rows.find((s) => s.name === STORE_NAME)?.id;
  if (!storeId) throw new Error(`${STORE_NAME} が見つかりません`);
  return membersResult.rows.filter((m) => m.store_id === storeId && isActiveMember(m)).length;
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const activeOverride = parseActiveOverride(process.argv);

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const supabase = url && key ? createClient(url, key, { auth: { persistSession: false } }) : null;

  let activeMembers = activeOverride ?? 35;
  if (supabase && activeOverride == null) {
    activeMembers = await loadActiveStoreCount(supabase);
  }

  const targetSlots = activeMembers * 12;
  const plan = buildRows(targetSlots);
  validateNoTrainerOverlap(plan.rows);
  validateSingleBoothPerDay(plan.rows);
  const takeOffForMetrics = new Set(
    allOctoberDates()
      .filter((d) => !plan.takeDays.includes(d))
      .map((d) => dayNum(d)),
  );
  const maxTakeStreak = maxTakeWorkStreak(allOctoberDates(), takeOffForMetrics);
  const summary = summarize(plan.rows, plan, targetSlots, activeMembers);

  const ownerByDate = Object.fromEntries([
    ...plan.takeDays.map((d) => [d, TRAINER_TAKE]),
    ...plan.ryoDays.map((d) => [d, TRAINER_RYO]),
  ]);

  const calendar = allOctoberDates().map((date) => {
    const dayRows = plan.rows.filter((r) => r.shift_date === date);
    const trainer = ownerByDate[date] ?? null;
    const note =
      dayNum(date) === 15 && !plan.takeDays.includes(date)
        ? "たけはる研修（シフトアウト）"
        : undefined;
    return {
      date,
      trainer,
      note,
      blocks: dayRows.map((r) => `${r.start_local.slice(0, 5)}-${r.end_local.slice(0, 5)}`),
    };
  });

  const output = {
    dryRun,
    month: MONTH,
    status: SHIFT_STATUS,
    ...summary,
    plan: {
      takeDays: plan.takeDays.length,
      ryoDays: plan.ryoDays.length,
      takeOffDays: [...takeOffForMetrics].sort((a, b) => a - b),
      maxTakeConsecutiveWork: maxTakeStreak,
      takeSlots: plan.takeSlots,
      ryoSlots: plan.ryoSlots,
      ryoTemplates: plan.ryoPlan,
    },
    calendar,
    rowCount: plan.rows.length,
  };

  console.log(JSON.stringify(output, null, 2));

  if (dryRun || !supabase) return;

  const { data: storeRow, error: storeErr } = await supabase
    .from("stores")
    .select("id,name")
    .eq("name", STORE_NAME)
    .maybeSingle();
  if (storeErr) throw storeErr;
  if (!storeRow?.id) throw new Error("store_id 未取得");

  const { data: trainers } = await supabase.from("trainers").select("id,display_name").in("display_name", TRAINER_NAMES);
  const trainerIdByName = new Map((trainers ?? []).map((t) => [t.display_name, t.id]));

  const trainerIds = TRAINER_NAMES.map((n) => trainerIdByName.get(n)).filter(Boolean);
  const { data: existing } = await supabase
    .from("trainer_shifts")
    .select("id")
    .eq("store_id", storeRow.id)
    .in("trainer_id", trainerIds)
    .gte("shift_date", `${MONTH}-01`)
    .lte("shift_date", `${MONTH}-${MONTH_LAST_DAY}`);

  const payload = plan.rows.map((r) => ({
    trainer_id: trainerIdByName.get(r.trainer_name),
    store_id: storeRow.id,
    shift_date: r.shift_date,
    start_local: r.start_local,
    end_local: r.end_local,
    status: SHIFT_STATUS,
    is_break: false,
    break_minutes: r.break_minutes ?? 0,
  }));

  const ids = (existing ?? []).map((r) => r.id);
  for (let i = 0; i < ids.length; i += 200) {
    await supabase.from("trainer_shifts").delete().in("id", ids.slice(i, i + 200));
  }
  for (let i = 0; i < payload.length; i += 200) {
    await supabase.from("trainer_shifts").insert(payload.slice(i, i + 200));
  }

  console.log(JSON.stringify({ done: true, deleted: ids.length, inserted: payload.length }, null, 2));
}

export { buildRows, TAKE_TARGET_WORK_HOURS };

import { pathToFileURL } from "url";
const isCli = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isCli) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
