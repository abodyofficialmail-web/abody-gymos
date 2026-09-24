import { createClient } from "@supabase/supabase-js";
import { fetchAllChecked } from "./lib/supabaseFetchAll.mjs";
import {
  buildRows as buildUenoPlan,
  UENO_MAX_BOOTHS,
  UENO_STORE_NAME,
} from "./sync-ueno-shifts-2026-10.mjs";
import { buildRows as buildSakuraPlan } from "./sync-sakuragicho-shifts-2026-10.mjs";
import {
  buildRows as buildEbisuPlan,
  openCandidateDates as ebisuOpenCandidateDates,
  pickYutoEbisuWorkDays,
} from "./sync-ebisu-shifts-2026-10.mjs";

/**
 * 2026-10 新宿店（ひろむ・りょう・ゆうと）
 *
 * - 目標枠: 約380（デフォルト380、--slots=）
 * - 1ブース（2ブースなし）
 * - りょう: 休み希望(1,7,14,20,26)・桜木町りょう日は不可・ひろむ新宿日は不可
 *   上記以外の日は新宿 9–14 / 17–22（枠増）
 * - ゆうと: 残り日・残り枠（枠調整は月末連休にならないよう分散削除）
 * - ひろむ: 上野休→新宿 7(9–14/17–22), 21(14–22), ほか2日+差替。該当日はゆうと新宿なし
 *
 * node --env-file=.env.local scripts/sync-shinjuku-shifts-2026-10.mjs --dry-run
 */
const MONTH = "2026-10";
const MONTH_LAST_DAY = "31";
const STORE_NAME = "新宿";
const TRAINER_HIROMU = "ひろむ";
const TRAINER_RYO = "りょう";
const TRAINER_YUTO = "ゆうと";
const TRAINER_NAMES = [TRAINER_HIROMU, TRAINER_RYO, TRAINER_YUTO];
const SHIFT_STATUS = "confirmed";

const HIROMU_SHINJUKU_DAY_COUNT = 2;
const HIROMU_OFF_PER_WEEK = 2;
/** 10月新宿の開放目標 */
const DEFAULT_TARGET_SLOTS = 390;
const TARGET_SLOTS_CEILING = 398;
const MAX_STORE_CLOSED_STREAK = 2;
/** 予約枠なしの店休日数（枠超過時のみ追加） */
const STORE_CLOSED_DAY_COUNT = 0;
/** 旧: 時間目標で日数制限。現在は eligible 全日を long で配置 */
const RYO_TARGET_WORK_HOURS = 130;

/** 桜木町・りょう休み希望（新宿も休み） */
const RYO_OFF_DAY_NUMS = new Set([1, 7, 14, 20, 26]);

const SINGLE_BOOTH = new Set(["恵比寿", "新宿", "桜木町"]);

/** 9–14 / 17–22（14–17は3時間中抜け・休憩枠なし） */
const HIROMU_SHINJUKU_SPLIT_TEMPLATE = {
  key: "split",
  segments: [
    ["09:00", "14:00"],
    ["17:00", "22:00"],
  ],
  breakMinutes: 0,
};
const HIROMU_SHINJUKU_TEMPLATES = [HIROMU_SHINJUKU_SPLIT_TEMPLATE];

/** 上野休→新宿（固定・ゆうと新宿なし） */
const HIROMU_UENO_HANDOFF_DAY_NUMS = new Set([7, 21]);
const HIROMU_SHINJUKU_PM1422_TEMPLATE = {
  key: "pm1422",
  segments: [
    ["14:00", "17:00"],
    ["18:00", "22:00"],
  ],
  breakMinutes: 60,
};

/** ゆうと新宿午前+恵比寿午後の候補（上野ひろむと被らない日を優先） */
const YUTO_DUAL_SWAP_CANDIDATE_DAY_NUMS = [12, 1, 8];

/** 差替日のひろむ新宿（10–14 / 17–22・中抜け3h） */
const HIROMU_SHINJUKU_DUAL_SWAP_TEMPLATE = {
  key: "dualSwap",
  segments: [
    ["10:00", "14:00"],
    ["17:00", "22:00"],
  ],
  breakMinutes: 0,
};

/** 10/10 固定（10:00–16:00） */
const RYO_DAY10_TEMPLATE = {
  key: "day10",
  segments: [["10:00", "16:00"]],
  breakMinutes: 0,
};

const RYO_SHINJUKU_TEMPLATES = [
  RYO_DAY10_TEMPLATE,
  { key: "long", segments: [["09:00", "14:00"], ["17:00", "22:00"]], breakMinutes: 0 },
  { key: "full", segments: [["09:00", "13:00"], ["16:00", "22:00"]], breakMinutes: 60 },
  { key: "med", segments: [["10:00", "13:00"], ["16:00", "21:00"]], breakMinutes: 60 },
  { key: "short", segments: [["14:00", "17:00"], ["18:00", "20:00"]], breakMinutes: 60 },
  { key: "mini", segments: [["16:00", "19:00"]], breakMinutes: 0 },
];

/** ゆうと: 恵比寿あり平日 9–13 / 恵比寿なし平日 16–22 / 土曜 9–15 */
const YUTO_WEEKDAY_TEMPLATE = {
  key: "am",
  segments: [["09:00", "13:00"]],
  breakMinutes: 0,
};
const YUTO_WEEKDAY_PM_TEMPLATE = {
  key: "pm",
  segments: [["16:00", "22:00"]],
  breakMinutes: 0,
};
const YUTO_SATURDAY_TEMPLATE = {
  key: "sat",
  segments: [["09:00", "15:00"]],
  breakMinutes: 0,
};
const YUTO_TEMPLATES = [YUTO_WEEKDAY_TEMPLATE, YUTO_WEEKDAY_PM_TEMPLATE, YUTO_SATURDAY_TEMPLATE];

function yutoTemplateForDate(date, plannedTemplate) {
  if (plannedTemplate) return plannedTemplate;
  if (parseLocalDate(date).getDay() === 6) return YUTO_SATURDAY_TEMPLATE;
  return YUTO_WEEKDAY_TEMPLATE;
}

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

function parseSlotsOverride(argv) {
  const a = argv.find((x) => x.startsWith("--slots="));
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

function parseLocalDate(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function mondayWeekKey(dateStr) {
  const d = parseLocalDate(dateStr);
  const diff = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - diff);
  const yy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
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

function workHoursForSegments(segments) {
  return segments.reduce((h, [s, e]) => h + (toMinutes(e) - toMinutes(s)) / 60, 0);
}

function templateWorkHours(template) {
  return workHoursForSegments(template.segments);
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

function hiromuUenoWorkDates(uenoPlan) {
  return new Set(
    uenoPlan.rows.filter((r) => r.trainer_name === TRAINER_HIROMU).map((r) => r.shift_date),
  );
}

function loadCrossStoreContext(uenoActive, sakuraActive) {
  const ueno = buildUenoPlan(500);
  const sakura = buildSakuraPlan(sakuraActive * 12);
  const hiromuUenoDates = hiromuUenoWorkDates(ueno);
  const sakuraRyoDates = new Set(sakura.ryoDays);
  return { hiromuUenoDates, sakuraRyoDates, ueno, sakura };
}

function hiromuRestScore(date, hiromuUenoDates) {
  if (hiromuUenoDates.has(date)) return -100;
  const dow = parseLocalDate(date).getDay();
  let s = 0;
  if (dow === 0 || dow === 6) s += 5;
  return s;
}

/** 上野勤務日以外で、週2休を確保 */
function pickHiromuRestDays(dates, hiromuUenoDates) {
  const rest = new Set();
  for (const weekDates of groupDatesByMondayWeek(dates)) {
    const candidates = weekDates.filter((d) => !hiromuUenoDates.has(d));
    const target = Math.min(HIROMU_OFF_PER_WEEK, candidates.length);
    const sorted = [...candidates].sort(
      (a, b) => hiromuRestScore(b, hiromuUenoDates) - hiromuRestScore(a, hiromuUenoDates),
    );
    for (let i = 0; i < target && i < sorted.length; i++) {
      rest.add(sorted[i]);
    }
  }
  return rest;
}

function hiromuShinjukuPickScore(date, hiromuUenoDates) {
  if (hiromuUenoDates.has(date)) return -1000;
  const n = dayNum(date);
  let s = 0;
  if (n >= 24 && n !== 26) s += 20;
  if (parseLocalDate(date).getDay() === 0 || parseLocalDate(date).getDay() === 6) s += 3;
  return s;
}

/** 上野勤務日・週2休以外から新宿2日（月末の店休を避けるため後半を優先） */
function mergeHiromuUenoHandoffDays(hiromuShinjukuDays) {
  const handoff = [...HIROMU_UENO_HANDOFF_DAY_NUMS].map((n) => octDate(n));
  return [...new Set([...hiromuShinjukuDays, ...handoff])].sort();
}

function pickHiromuShinjukuDays(dates, hiromuUenoDates, hiromuRestDays, sakuraRyoDates) {
  const candidates = dates.filter(
    (d) =>
      !HIROMU_UENO_HANDOFF_DAY_NUMS.has(dayNum(d)) &&
      !hiromuUenoDates.has(d) &&
      !hiromuRestDays.has(d) &&
      isRyoShinjukuEligible(d, sakuraRyoDates),
  );
  const sorted = [...candidates].sort(
    (a, b) => hiromuShinjukuPickScore(b, hiromuUenoDates) - hiromuShinjukuPickScore(a, hiromuUenoDates),
  );
  return sorted.slice(0, HIROMU_SHINJUKU_DAY_COUNT).sort();
}

function pickHiromuDualSwapDay(hiromuUenoDates) {
  for (const n of YUTO_DUAL_SWAP_CANDIDATE_DAY_NUMS) {
    const d = octDate(n);
    if (hiromuUenoDates.has(d)) continue;
    if (parseLocalDate(d).getDay() === 6) continue;
    return d;
  }
  return null;
}

function mergeHiromuDualSwapDay(hiromuShinjukuDays, swapDay) {
  const merged = [...new Set([...hiromuShinjukuDays.filter((d) => d !== swapDay), swapDay])].sort();
  return merged;
}

function hiromuShinjukuTemplateForDate(date, swapDay) {
  const n = dayNum(date);
  if (n === 21) return HIROMU_SHINJUKU_PM1422_TEMPLATE;
  if (HIROMU_UENO_HANDOFF_DAY_NUMS.has(n)) return HIROMU_SHINJUKU_SPLIT_TEMPLATE;
  return date === swapDay ? HIROMU_SHINJUKU_DUAL_SWAP_TEMPLATE : HIROMU_SHINJUKU_SPLIT_TEMPLATE;
}

function trailingClosedStreakAfterDrop(allDates, closedSet, dropDate) {
  const closed = new Set(closedSet);
  closed.add(dropDate);
  let streak = 0;
  for (let i = allDates.length - 1; i >= 0; i--) {
    const d = allDates[i];
    if (closed.has(d)) streak++;
    else break;
  }
  return streak;
}

function maxStoreClosedStreak(allDates, closedSet) {
  let max = 0;
  let cur = 0;
  for (const d of allDates) {
    if (closedSet.has(d)) {
      cur++;
      max = Math.max(max, cur);
    } else {
      cur = 0;
    }
  }
  return max;
}

function yutoDualPmDaysForShinjuku(yutoWorkDays) {
  const { yutoDualPmDays } = pickYutoEbisuWorkDays(ebisuOpenCandidateDates(), [], yutoWorkDays);
  return yutoDualPmDays;
}

/** 現在の新宿ゆうと日を前提にした恵比寿ゆうと勤務日 */
function yutoEbisuWorkDateSet(yutoShinjukuWorkDays, crossStore) {
  const crossBusy = {
    hiromuBusy: new Set(),
    yutoShinjukuDates: yutoShinjukuWorkDays,
    cross: crossStore,
  };
  const ebisu = buildEbisuPlan(190, crossBusy);
  return new Set(
    ebisu.rows.filter((r) => r.trainer_name === TRAINER_YUTO).map((r) => r.shift_date),
  );
}

/** 390枠向け: 恵比寿午後あり日を優先削除、店休3連続は避ける */
function pickYutoDayToDropForTrim(yutoWorkDays, storeClosedDates, allDates, yutoDualPmDays) {
  if (!yutoWorkDays.length) return null;
  const closedSet = new Set(storeClosedDates);
  const dualSet = yutoDualPmDays instanceof Set ? yutoDualPmDays : new Set(yutoDualPmDays);

  function pick(allowLongStreak) {
    let best = null;
    let bestScore = Infinity;
    for (const d of yutoWorkDays) {
      const nextClosed = new Set(closedSet);
      nextClosed.add(d);
      const streak = maxStoreClosedStreak(allDates, nextClosed);
      if (!allowLongStreak && streak > MAX_STORE_CLOSED_STREAK) continue;
      let score = streak * 200;
      if (!dualSet.has(d)) score += 500;
      const dow = parseLocalDate(d).getDay();
      score -= (dow === 6 ? 12 : 8) * 0.1;
      if (score < bestScore) {
        bestScore = score;
        best = d;
      }
    }
    return best;
  }

  return pick(false) ?? pick(true);
}

function isRyoShinjukuEligible(date, sakuraRyoDates) {
  const n = dayNum(date);
  if (RYO_OFF_DAY_NUMS.has(n)) return false;
  if (sakuraRyoDates.has(date)) return false;
  return true;
}

/** 約150hになるまで eligible 日にテンプレ付与（超過分はゆうとへ） */
function pickRyoShinjukuPlanByHours(eligibleDates, targetHours) {
  const full = RYO_SHINJUKU_TEMPLATES.find((t) => t.key === "full");
  const long = RYO_SHINJUKU_TEMPLATES.find((t) => t.key === "long");
  const med = RYO_SHINJUKU_TEMPLATES.find((t) => t.key === "med");
  if (!full || !long) throw new Error("りょうテンプレート未定義");

  const sorted = [...eligibleDates].sort();
  const plan = [];
  let hours = 0;

  for (const date of sorted) {
    if (hours >= targetHours - 1) break;
    const hLong = templateWorkHours(long);
    const hFull = templateWorkHours(full);
    let template = full;
    if (hours + hLong <= targetHours + 4) template = long;
    else if (hours + hFull <= targetHours + 6) template = full;
    else if (med && hours + templateWorkHours(med) <= targetHours + 4) template = med;
    else continue;
    plan.push({ date, template, key: template.key });
    hours += templateWorkHours(template);
  }

  let guard = 0;
  while (hours < targetHours - 2 && guard++ < 200) {
    let upgraded = false;
    for (let i = 0; i < plan.length; i++) {
      if (plan[i].key === "long") continue;
      const next = long;
      const delta = templateWorkHours(next) - templateWorkHours(plan[i].template);
      if (hours + delta <= targetHours + 6) {
        hours += delta;
        plan[i] = { date: plan[i].date, template: next, key: next.key };
        upgraded = true;
        break;
      }
    }
    if (!upgraded) break;
  }

  return { plan, ryoWorkHours: hours };
}

function ryoShinjukuTemplateForDate(date) {
  if (dayNum(date) === 10) return RYO_DAY10_TEMPLATE;
  const long = RYO_SHINJUKU_TEMPLATES.find((t) => t.key === "long");
  if (!long) throw new Error("りょう long テンプレ未定義");
  return long;
}

/** 希望休・桜木町・ひろむ新宿日を除く全日（10/10は10–16、他は9–14/17–22） */
function pickRyoShinjukuPlanMaxSlots(eligibleDates) {
  const plan = [...eligibleDates].sort().map((date) => {
    const template = ryoShinjukuTemplateForDate(date);
    return { date, template, key: template.key };
  });
  const ryoWorkHours = plan.reduce((h, p) => h + templateWorkHours(p.template), 0);
  return { plan, ryoWorkHours };
}

function pickStoreClosedDays(dates, hiromuShinjukuDays, sakuraRyoDates) {
  if (STORE_CLOSED_DAY_COUNT <= 0) return [];
  const hiromuSet = new Set(hiromuShinjukuDays);
  const candidates = dates.filter(
    (d) => isRyoShinjukuEligible(d, sakuraRyoDates) && !hiromuSet.has(d),
  );
  if (candidates.length <= STORE_CLOSED_DAY_COUNT) return [];

  const picked = [];
  const step = Math.max(1, Math.floor(candidates.length / (STORE_CLOSED_DAY_COUNT + 1)));
  for (let i = step - 1; i < candidates.length && picked.length < STORE_CLOSED_DAY_COUNT; i += step) {
    const d = candidates[i];
    if (picked.some((p) => Math.abs(dayNum(p) - dayNum(d)) <= 1)) continue;
    picked.push(d);
  }
  while (picked.length < STORE_CLOSED_DAY_COUNT) {
    const d = candidates.find((c) => !picked.includes(c));
    if (!d) break;
    picked.push(d);
  }
  return picked.sort();
}

function assignDayOwners(dates, hiromuShinjukuDays, ryoDates, storeClosedDates) {
  const hiromuSet = new Set(hiromuShinjukuDays);
  const ryoSet = new Set(ryoDates);
  const closedSet = new Set(storeClosedDates);
  const owners = new Map();
  for (const date of dates) {
    if (closedSet.has(date)) owners.set(date, null);
    else if (hiromuSet.has(date)) owners.set(date, TRAINER_HIROMU);
    else if (ryoSet.has(date)) owners.set(date, TRAINER_RYO);
    else owners.set(date, TRAINER_YUTO);
  }
  return owners;
}

function pickExtraStoreClosedDates(candidates, needCount) {
  if (needCount <= 0 || !candidates.length) return [];
  const picked = [];
  const step = Math.max(1, Math.floor(candidates.length / (needCount + 1)));
  for (let i = step - 1; i < candidates.length && picked.length < needCount; i += step) {
    picked.push(candidates[i]);
  }
  for (const d of candidates) {
    if (picked.length >= needCount) break;
    if (!picked.includes(d)) picked.push(d);
  }
  return picked.sort();
}

function pickTemplatesForDays(
  dayList,
  templates,
  slotsNeeded,
  { slotCeilingExtra = 4, minTemplateKey = null, maxTemplateKey = null } = {},
) {
  if (!dayList.length) return [];
  const opts = templates
    .map((t) => ({ template: t, slots: slotsForTemplate(t), workHours: templateWorkHours(t) }))
    .sort((a, b) => a.slots - b.slots);

  let startIdx = 0;
  if (minTemplateKey) {
    const i = opts.findIndex((o) => o.template.key === minTemplateKey);
    if (i >= 0) startIdx = i;
  }
  let endIdx = opts.length - 1;
  if (maxTemplateKey) {
    const i = opts.findIndex((o) => o.template.key === maxTemplateKey);
    if (i >= 0) endIdx = i;
  }
  const allowedOpts = opts.slice(startIdx, endIdx + 1);
  const base = allowedOpts[0] ?? opts[0];

  const plan = dayList.map((date) => ({
    date,
    template: base.template,
    slots: base.slots,
    key: base.template.key,
  }));
  let sum = plan.reduce((s, p) => s + p.slots, 0);

  let guard = 0;
  while (sum < slotsNeeded && guard++ < 800) {
    let upgraded = false;
    for (let i = 0; i < plan.length; i++) {
      for (const opt of allowedOpts) {
        if (opt.slots <= plan[i].slots) continue;
        const next = sum - plan[i].slots + opt.slots;
        if (next <= slotsNeeded + slotCeilingExtra) {
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
  while (sum > slotsNeeded && guard++ < 800) {
    let downgraded = false;
    for (let i = 0; i < plan.length; i++) {
      for (const opt of allowedOpts) {
        if (opt.slots >= plan[i].slots) continue;
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

  return plan;
}

function buildRows(targetSlots, crossStore) {
  const dates = allOctoberDates();
  const { hiromuUenoDates, sakuraRyoDates } = crossStore;

  const hiromuRestDays = pickHiromuRestDays(dates, hiromuUenoDates);
  const plannedHiromuShinjuku = [];
  const hiromuHandoffToRyo = [];
  const hiromuDualSwapDay = pickHiromuDualSwapDay(hiromuUenoDates);
  let hiromuShinjukuDays = pickHiromuShinjukuDays(dates, hiromuUenoDates, hiromuRestDays, sakuraRyoDates);
  hiromuShinjukuDays = mergeHiromuUenoHandoffDays(hiromuShinjukuDays);
  if (hiromuDualSwapDay) {
    hiromuShinjukuDays = mergeHiromuDualSwapDay(hiromuShinjukuDays, hiromuDualSwapDay);
  }
  let storeClosedDates = pickStoreClosedDays(dates, hiromuShinjukuDays, sakuraRyoDates);
  const hiromuSet = new Set(hiromuShinjukuDays);
  const isClosed = (d) => storeClosedDates.includes(d);

  const ryoEligible = dates.filter(
    (d) => !isClosed(d) && !hiromuSet.has(d) && isRyoShinjukuEligible(d, sakuraRyoDates),
  );
  let { plan: ryoPlan, ryoWorkHours } = pickRyoShinjukuPlanMaxSlots(ryoEligible);
  let ryoDates = ryoPlan.map((p) => p.date);

  let yutoWorkDays = dates.filter((d) => !isClosed(d) && !hiromuSet.has(d) && !ryoDates.includes(d));
  let owners = assignDayOwners(dates, hiromuShinjukuDays, ryoDates, storeClosedDates);

  let hiromuRows = hiromuShinjukuDays.flatMap((d) =>
    rowsForTemplate(d, TRAINER_HIROMU, hiromuShinjukuTemplateForDate(d, hiromuDualSwapDay)),
  );
  let hiromuSlots = countSlots(hiromuRows);

  function rebuildHiromuRows() {
    hiromuRows = hiromuShinjukuDays.flatMap((d) =>
      rowsForTemplate(d, TRAINER_HIROMU, hiromuShinjukuTemplateForDate(d, hiromuDualSwapDay)),
    );
    hiromuSlots = countSlots(hiromuRows);
  }

  let ryoRows = ryoPlan.flatMap(({ date, template }) => rowsForTemplate(date, TRAINER_RYO, template));
  let ryoSlots = countSlots(ryoRows);

  let yutoPlan = yutoPlanAmOnly();
  let yutoRows = yutoPlan.flatMap(({ date, template }) =>
    rowsForTemplate(date, TRAINER_YUTO, yutoTemplateForDate(date, template)),
  );
  let yutoSlots = countSlots(yutoRows);
  let rows;

  function yutoPlanAmOnly() {
    return yutoWorkDays.map((date) => {
      const sat = parseLocalDate(date).getDay() === 6;
      const template = sat ? YUTO_SATURDAY_TEMPLATE : YUTO_WEEKDAY_TEMPLATE;
      return { date, template, key: template.key };
    });
  }

  /** 390枠調整後: 恵比寿なし平日は新宿16–22、恵比寿ありは9–13 */
  function yutoPlanAfterEbisuSplit() {
    const ebisuSet = yutoEbisuWorkDateSet(yutoWorkDays, crossStore);
    return yutoWorkDays.map((date) => {
      if (ebisuSet.has(date)) return { date, template: YUTO_WEEKDAY_TEMPLATE, key: "am" };
      return { date, template: YUTO_WEEKDAY_PM_TEMPLATE, key: "pm" };
    });
  }

  function rebuildYuto(useEbisuSplit = false) {
    yutoPlan = useEbisuSplit ? yutoPlanAfterEbisuSplit() : yutoPlanAmOnly();
    yutoRows = yutoPlan.flatMap(({ date, template }) =>
      rowsForTemplate(date, TRAINER_YUTO, yutoTemplateForDate(date, template)),
    );
    yutoSlots = countSlots(yutoRows);
    rebuildHiromuRows();
    rows = [...hiromuRows, ...ryoRows, ...yutoRows];
    return countSlots(rows);
  }

  let slots = rebuildYuto(false);

  function trimOneYutoDay() {
    const dualPm = yutoDualPmDaysForShinjuku(yutoWorkDays);
    const drop = pickYutoDayToDropForTrim(yutoWorkDays, storeClosedDates, dates, dualPm);
    if (!drop) return false;
    yutoWorkDays = yutoWorkDays.filter((d) => d !== drop);
    storeClosedDates.push(drop);
    storeClosedDates.sort();
    owners = assignDayOwners(dates, hiromuShinjukuDays, ryoDates, storeClosedDates);
    slots = rebuildYuto(false);
    return true;
  }

  let guardTrim = 0;
  /** 8コマ刻みのため 390±2 コマ（392まで）で打ち止め */
  while (slots > targetSlots + 2 && yutoWorkDays.length > 0 && guardTrim++ < 40) {
    if (!trimOneYutoDay()) break;
  }

  slots = rebuildYuto(true);

  const yutoDates = dates.filter((d) => owners.get(d) === TRAINER_YUTO);
  const yutoOffDays = yutoDates.filter((d) => !yutoWorkDays.includes(d));
  const storeClosedAll = [...new Set([...storeClosedDates, ...yutoOffDays])].sort();

  return {
    rows,
    slots,
    targetSlots,
    hiromuShinjukuDays,
    hiromuDualSwapDay,
    hiromuHandoffToRyo,
    plannedHiromuShinjuku,
    hiromuRestDays: [...hiromuRestDays].sort(),
    hiromuUenoDates: [...hiromuUenoDates].sort(),
    storeClosedDates: storeClosedAll,
    yutoOffDays,
    ryoDates,
    yutoDates,
    yutoWorkDays,
    owners,
    ryoPlan,
    yutoPlan,
    ryoWorkHours,
    hiromuSlots,
    ryoSlots,
    yutoSlots,
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
    trainers: [...byTrainer.entries()].map(([name, v]) => ({
      name,
      days: v.days.size,
      workHours: Math.round((v.workMinutes / 60) * 10) / 10,
      breakHours: Math.round((v.breakMinutes / 60) * 10) / 10,
    })),
  };
}

async function loadActiveStoreCount(supabase, storeName) {
  const [membersResult, storesResult] = await Promise.all([
    fetchAllChecked(supabase, "members", "id, store_id, is_active, membership_status", undefined, "members"),
    fetchAllChecked(supabase, "stores", "id, name", undefined, "stores"),
  ]);
  const storeId = storesResult.rows.find((s) => s.name === storeName)?.id;
  if (!storeId) throw new Error(`${storeName} が見つかりません`);
  return membersResult.rows.filter((m) => m.store_id === storeId && isActiveMember(m)).length;
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const activeOverride = parseActiveOverride(process.argv);

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const supabase = url && key ? createClient(url, key, { auth: { persistSession: false } }) : null;

  const slotsOverride = parseSlotsOverride(process.argv);
  let activeMembers = activeOverride ?? Math.round(DEFAULT_TARGET_SLOTS / 12);
  let uenoActive = 40;
  let sakuraActive = 35;
  if (supabase && activeOverride == null) {
    activeMembers = await loadActiveStoreCount(supabase, STORE_NAME);
    uenoActive = await loadActiveStoreCount(supabase, "上野");
    sakuraActive = await loadActiveStoreCount(supabase, "桜木町");
  }

  const crossStore = loadCrossStoreContext(uenoActive, sakuraActive);
  const targetSlots = slotsOverride ?? DEFAULT_TARGET_SLOTS;
  const plan = buildRows(targetSlots, crossStore);
  validateNoTrainerOverlap(plan.rows);
  validateSingleBoothPerDay(plan.rows);
  for (const d of plan.hiromuShinjukuDays) {
    if (crossStore.hiromuUenoDates.has(d)) {
      throw new Error(`ひろむ新宿日が上野勤務と重複: ${d}`);
    }
  }
  const summary = summarize(plan.rows, plan, targetSlots, activeMembers);

  const calendar = allOctoberDates().map((date) => {
    const dayRows = plan.rows.filter((r) => r.shift_date === date);
    const trainer = plan.owners.get(date) ?? null;
    const closed = plan.storeClosedDates.includes(date);
    return {
      date,
      trainer,
      closed: closed || undefined,
      blocks: dayRows.map((r) => `${r.start_local.slice(0, 5)}-${r.end_local.slice(0, 5)}`),
    };
  });

  const output = {
    dryRun,
    month: MONTH,
    status: SHIFT_STATUS,
    crossStore: {
      uenoActiveMembers: uenoActive,
      sakuraActiveMembers: sakuraActive,
      hiromuUenoDays: crossStore.ueno.hiromuDates.length,
      sakuraRyoDays: crossStore.sakura.ryoDays.length,
    },
    ...summary,
    plan: {
      targetSlots,
      hiromuShinjukuDays: plan.hiromuShinjukuDays.length,
      hiromuShinjukuDayNums: plan.hiromuShinjukuDays.map((d) => dayNum(d)),
      hiromuDualSwapDayNum: plan.hiromuDualSwapDay ? dayNum(plan.hiromuDualSwapDay) : null,
      hiromuHandoffToRyo: plan.hiromuHandoffToRyo.map((d) => dayNum(d)),
      hiromuRestDays: plan.hiromuRestDays.map((d) => dayNum(d)),
      storeClosedDays: plan.storeClosedDates.map((d) => dayNum(d)),
      yutoOffDays: plan.yutoOffDays.map((d) => dayNum(d)),
      ryoShinjukuDays: plan.ryoDates.length,
      yutoDays: plan.yutoDates.length,
      ryoWorkHours: plan.ryoWorkHours,
      slotSplit: {
        hiromu: plan.hiromuSlots,
        ryo: plan.ryoSlots,
        yuto: plan.yutoSlots,
      },
      ryoTemplates: plan.ryoPlan.map(({ date, key }) => ({ date, template: key })),
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

export { buildRows, loadCrossStoreContext };

import { pathToFileURL } from "url";
const isCli = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isCli) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
