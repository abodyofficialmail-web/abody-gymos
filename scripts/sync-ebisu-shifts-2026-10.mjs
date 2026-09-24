import { createClient } from "@supabase/supabase-js";
import { fetchAllChecked } from "./lib/supabaseFetchAll.mjs";
import {
  buildRows as buildUenoPlan,
  UENO_MAX_BOOTHS,
  UENO_STORE_NAME,
} from "./sync-ueno-shifts-2026-10.mjs";
import { buildRows as buildShinjukuPlan, loadCrossStoreContext } from "./sync-shinjuku-shifts-2026-10.mjs";

/**
 * 2026-10 恵比寿店シフト（ひろむ4日・残りゆうと・週2休）
 *
 * - 目標枠: 約190（--slots= で上書き可）
 * - 土曜: 店舗休み
 * - 平日: 16:00–22:00
 * - 日曜: 10:00–16:00
 * - ひろむ: 月4日（上野・新宿と同日不可）
 * - 上野ひろむと同日の恵比寿は、ゆうとが週2休を維持できる場合はゆうとに変更
 * - ゆうと: 週2休。新宿平日9–13の日は同日16–22恵比寿可（ひろむ恵比寿日は除外）
 *
 * node scripts/sync-ebisu-shifts-2026-10.mjs --dry-run
 */
const MONTH = "2026-10";
const MONTH_LAST_DAY = "31";
const STORE_NAME = "恵比寿";
const TRAINER_HIROMU = "ひろむ";
const TRAINER_YUTO = "ゆうと";
const TRAINER_NAMES = [TRAINER_HIROMU, TRAINER_YUTO];
const SHIFT_STATUS = "confirmed";

const DEFAULT_TARGET_SLOTS = 190;
const HIROMU_EBISU_DAY_COUNT = 4;
const YUTO_OFF_PER_WEEK = 2;
const SLOTS_PER_OPEN_DAY = 12;

const SINGLE_BOOTH = new Set(["恵比寿", "新宿", "桜木町"]);

const WEEKDAY_TEMPLATE = { key: "weekday", segments: [["16:00", "22:00"]], breakMinutes: 0 };
const SUNDAY_TEMPLATE = { key: "sunday", segments: [["10:00", "16:00"]], breakMinutes: 0 };

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

function templateForDate(date) {
  return parseLocalDate(date).getDay() === 0 ? SUNDAY_TEMPLATE : WEEKDAY_TEMPLATE;
}

/** 新宿午前勤務と同日の恵比寿は常に16–22 */
function templateForYutoEbisu(date, yutoDualPmDays) {
  if (yutoDualPmDays.has(date)) return WEEKDAY_TEMPLATE;
  return templateForDate(date);
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

function openCandidateDates() {
  return allOctoberDates().filter((d) => parseLocalDate(d).getDay() !== 6);
}

function trainerDatesElsewhere(rows, trainer, excludeStore) {
  return new Set(
    rows.filter((r) => r.trainer_name === trainer && r.store_name !== excludeStore).map((r) => r.shift_date),
  );
}

function loadCrossStoreBusy(uenoActive, sakuraActive) {
  const cross = loadCrossStoreContext(uenoActive, sakuraActive);
  const ueno = buildUenoPlan(uenoActive * 12);
  const shinjuku = buildShinjukuPlan(390, cross);
  const hiromuUenoDates = trainerDatesElsewhere(ueno.rows, TRAINER_HIROMU, STORE_NAME);
  const hiromuBusy = new Set([
    ...hiromuUenoDates,
    ...trainerDatesElsewhere(shinjuku.rows, TRAINER_HIROMU, STORE_NAME),
  ]);
  const yutoShinjukuDates = [...trainerDatesElsewhere(shinjuku.rows, TRAINER_YUTO, STORE_NAME)].sort();
  return { hiromuBusy, hiromuUenoDates, yutoShinjukuDates, cross };
}

function hiromuEbisuPickScore(date) {
  const dow = parseLocalDate(date).getDay();
  let s = 0;
  if (dow >= 1 && dow <= 5) s += 10;
  if (dow === 0) s += 2;
  s += dayNum(date) / 100;
  return s;
}

/** 週ごとに1日ずつ優先し、上野/新宿と被らない日から最大4日 */
function pickHiromuEbisuDays(candidates, hiromuBusy, count = HIROMU_EBISU_DAY_COUNT) {
  const picked = [];
  const pickedSet = new Set();
  for (const weekDates of groupDatesByMondayWeek(candidates)) {
    if (picked.length >= count) break;
    const options = weekDates
      .filter((d) => !hiromuBusy.has(d) && !pickedSet.has(d))
      .sort((a, b) => hiromuEbisuPickScore(b) - hiromuEbisuPickScore(a));
    if (options.length) {
      picked.push(options[0]);
      pickedSet.add(options[0]);
    }
  }
  if (picked.length < count) {
    for (const d of candidates) {
      if (picked.length >= count) break;
      if (hiromuBusy.has(d) || pickedSet.has(d)) continue;
      picked.push(d);
      pickedSet.add(d);
    }
  }
  if (picked.length < count) {
    throw new Error(`ひろむ恵比寿 ${count} 日を確保できません（${picked.length} 日のみ）`);
  }
  return picked.sort();
}

function fillHiromuEbisuDays(hiromuDays, candidates, hiromuBusy, count = HIROMU_EBISU_DAY_COUNT) {
  const picked = [...hiromuDays];
  const pickedSet = new Set(picked);
  for (const d of candidates) {
    if (picked.length >= count) break;
    if (hiromuBusy.has(d) || pickedSet.has(d)) continue;
    picked.push(d);
    pickedSet.add(d);
  }
  if (picked.length < count) {
    throw new Error(`ひろむ恵比寿 ${count} 日を確保できません（${picked.length} 日のみ）`);
  }
  return picked.sort();
}

function weekPoolForDate(date, candidates) {
  for (const weekDates of groupDatesByMondayWeek(candidates)) {
    if (weekDates.includes(date)) return weekDates;
  }
  return [];
}

/**
 * 上野ひろむ日に恵比寿を開けるため、公休を別日にずらしてゆうと勤務に変更
 */
function trySwapYutoRestToEbisuWork(date, candidates, hiromuSet, yutoWork, yutoRest, shinjukuSet, yutoDualPmDays) {
  if (hiromuSet.has(date)) return false;
  if (yutoWork.has(date)) return true;

  const pool = weekPoolForDate(date, candidates);
  if (!pool.length) return false;

  const trialWork = new Set(yutoWork);
  const trialRest = new Set(yutoRest);
  trialWork.add(date);
  trialRest.delete(date);

  const offRequired = weekOffRequired(pool, hiromuSet);
  const countOff = () => pool.filter((d) => !hiromuSet.has(d) && !trialWork.has(d)).length;

  while (countOff() < offRequired) {
    const options = pool
      .filter((d) => !hiromuSet.has(d) && !trialWork.has(d) && !trialRest.has(d))
      .sort((a, b) => yutoRestPickScore(b, shinjukuSet) - yutoRestPickScore(a, shinjukuSet));
    if (!options.length) return false;
    trialRest.add(options[0]);
  }

  for (const d of pool) {
    if (hiromuSet.has(d)) continue;
    if (trialWork.has(d)) {
      yutoWork.add(d);
      yutoRest.delete(d);
    } else {
      yutoWork.delete(d);
      yutoRest.add(d);
    }
  }

  if (isYutoShinjukuWeekday(date, shinjukuSet, hiromuSet)) yutoDualPmDays.add(date);
  return true;
}

/** ひろむ恵比寿×上野ひろむの同日を解消（恵比寿はゆうとへ、週2休を維持できる場合のみ） */
function resolveHiromuUenoEbisuWithYuto(
  candidates,
  crossBusy,
  hiromuDays,
  yutoWorkDays,
  yutoRestDays,
  yutoDualPmDays,
  yutoShinjukuDates,
) {
  const hiromuUenoDates = crossBusy.hiromuUenoDates ?? new Set();
  const hiromuBusy = crossBusy.hiromuBusy ?? new Set();

  let hiromu = hiromuDays.filter((d) => !hiromuUenoDates.has(d));
  if (hiromu.length !== hiromuDays.length) {
    hiromu = fillHiromuEbisuDays(hiromu, candidates, hiromuBusy, HIROMU_EBISU_DAY_COUNT);
  }

  const yutoWork = new Set(yutoWorkDays);
  const yutoRest = new Set(yutoRestDays);
  const shinjukuSet = new Set(yutoShinjukuDates);
  const yutoOnHiromuUenoDays = [];

  for (const d of candidates) {
    if (!hiromuUenoDates.has(d)) continue;
    const hiromuSet = new Set(hiromu);
    if (hiromuSet.has(d)) continue;
    if (yutoWork.has(d)) {
      yutoOnHiromuUenoDays.push(d);
      continue;
    }
    if (!trySwapYutoRestToEbisuWork(d, candidates, hiromuSet, yutoWork, yutoRest, shinjukuSet, yutoDualPmDays)) {
      continue;
    }
    yutoOnHiromuUenoDays.push(d);
  }

  return {
    hiromuDays: hiromu,
    yutoWorkDays: [...yutoWork].sort(),
    yutoRestDays: [...yutoRest].sort(),
    yutoOnHiromuUenoDays: yutoOnHiromuUenoDays.sort(),
  };
}

function yutoRestPickScore(date, shinjukuSet) {
  const dow = parseLocalDate(date).getDay();
  let s = 0;
  if (!shinjukuSet.has(date)) s += 20;
  if (dow === 5) s += 8;
  if (dow === 1) s += 6;
  if (dow === 4) s += 4;
  if (dow === 0) s += 1;
  return s;
}

function weekOffRequired(pool, hiromuSet) {
  const yutoEligibleCount = pool.filter((d) => !hiromuSet.has(d)).length;
  return Math.min(YUTO_OFF_PER_WEEK, Math.max(0, yutoEligibleCount - 1));
}

function isYutoShinjukuWeekday(date, shinjukuSet, hiromuSet) {
  return shinjukuSet.has(date) && parseLocalDate(date).getDay() !== 6 && !hiromuSet.has(date);
}

/**
 * 週2休を先に確保 → 新宿平日は同日16–22恵比寿（ひろむ恵比寿日除外）
 */
function pickYutoEbisuWorkDays(candidates, hiromuDays, yutoShinjukuDates) {
  const hiromuSet = new Set(hiromuDays);
  const shinjukuSet = new Set(yutoShinjukuDates);
  const yutoRest = new Set();
  const yutoWork = new Set();
  const yutoDualPmDays = new Set();

  for (const weekDates of groupDatesByMondayWeek(candidates)) {
    const pool = weekDates.filter((d) => candidates.includes(d));
    const offRequired = weekOffRequired(pool, hiromuSet);
    const restCandidates = pool
      .filter((d) => !hiromuSet.has(d) && !yutoRest.has(d))
      .sort((a, b) => yutoRestPickScore(b, shinjukuSet) - yutoRestPickScore(a, shinjukuSet));
    for (let i = 0; i < offRequired && i < restCandidates.length; i++) {
      yutoRest.add(restCandidates[i]);
    }

    for (const d of pool) {
      if (!isYutoShinjukuWeekday(d, shinjukuSet, hiromuSet)) continue;
      if (yutoRest.has(d)) continue;
      yutoWork.add(d);
      yutoDualPmDays.add(d);
    }

    for (const d of pool) {
      if (hiromuSet.has(d)) continue;
      if (yutoRest.has(d)) continue;
      if (yutoWork.has(d)) continue;
      yutoWork.add(d);
    }
  }

  return {
    yutoWorkDays: [...yutoWork].sort(),
    yutoRestDays: [...yutoRest].sort(),
    yutoDualPmDays,
  };
}

function trimYutoDaysToTarget(yutoWorkDays, hiromuDays, targetSlots, protectedDays) {
  const openCount = hiromuDays.length + yutoWorkDays.length;
  const slots = openCount * SLOTS_PER_OPEN_DAY;
  if (slots <= targetSlots + SLOTS_PER_OPEN_DAY / 2) {
    return { yutoWorkDays, storeClosedExtra: [] };
  }
  const maxOpen = Math.ceil(targetSlots / SLOTS_PER_OPEN_DAY);
  const needRemove = openCount - maxOpen;
  const removable = yutoWorkDays.filter((d) => !protectedDays.has(d)).sort((a, b) => dayNum(b) - dayNum(a));
  const removed = removable.splice(0, needRemove);
  const kept = yutoWorkDays.filter((d) => !removed.includes(d));
  return { yutoWorkDays: kept.sort(), storeClosedExtra: removed.sort() };
}

function validateYutoWeeklyRest(candidates, hiromuDays, yutoWorkDays) {
  const hiromuSet = new Set(hiromuDays);
  const yutoWorkSet = new Set(yutoWorkDays);
  for (const weekDates of groupDatesByMondayWeek(candidates)) {
    const pool = weekDates.filter((d) => candidates.includes(d));
    if (!pool.length) continue;
    const yutoEligibleCount = pool.filter((d) => !hiromuSet.has(d)).length;
    const offRequired = Math.min(YUTO_OFF_PER_WEEK, Math.max(0, yutoEligibleCount - 1));
    const yutoOffEbisu = pool.filter((d) => !hiromuSet.has(d) && !yutoWorkSet.has(d)).length;
    if (yutoOffEbisu < offRequired) {
      throw new Error(`ゆうと週2休未達: week ${mondayWeekKey(pool[0])}`);
    }
  }
}

function buildRows(targetSlots, crossBusy) {
  const candidates = openCandidateDates();
  let hiromuDays = pickHiromuEbisuDays(candidates, crossBusy.hiromuBusy, HIROMU_EBISU_DAY_COUNT);
  let { yutoWorkDays, yutoRestDays, yutoDualPmDays } = pickYutoEbisuWorkDays(
    candidates,
    hiromuDays,
    crossBusy.yutoShinjukuDates,
  );
  const resolved = resolveHiromuUenoEbisuWithYuto(
    candidates,
    crossBusy,
    hiromuDays,
    yutoWorkDays,
    yutoRestDays,
    yutoDualPmDays,
    crossBusy.yutoShinjukuDates,
  );
  hiromuDays = resolved.hiromuDays;
  yutoWorkDays = resolved.yutoWorkDays;
  yutoRestDays = resolved.yutoRestDays;
  const yutoOnHiromuUenoDays = resolved.yutoOnHiromuUenoDays;

  const trim = trimYutoDaysToTarget(yutoWorkDays, hiromuDays, targetSlots, yutoDualPmDays);
  for (const d of trim.storeClosedExtra) {
    yutoDualPmDays.delete(d);
  }
  yutoWorkDays = trim.yutoWorkDays;
  const storeClosedExtra = trim.storeClosedExtra;
  yutoRestDays = [...new Set([...yutoRestDays, ...storeClosedExtra])].sort();

  validateYutoWeeklyRest(candidates, hiromuDays, yutoWorkDays);

  const owners = new Map();
  for (const d of hiromuDays) owners.set(d, TRAINER_HIROMU);
  for (const d of yutoWorkDays) owners.set(d, TRAINER_YUTO);

  const rows = [];
  for (const d of hiromuDays) rows.push(...rowsForTemplate(d, TRAINER_HIROMU, templateForDate(d)));
  for (const d of yutoWorkDays) {
    rows.push(...rowsForTemplate(d, TRAINER_YUTO, templateForYutoEbisu(d, yutoDualPmDays)));
  }

  const storeClosedDates = [
    ...allOctoberDates().filter((d) => parseLocalDate(d).getDay() === 6),
    ...candidates.filter((d) => !owners.has(d)),
  ].sort();

  return {
    rows,
    slots: countSlots(rows),
    targetSlots,
    candidates,
    hiromuDays,
    yutoWorkDays,
    yutoRestDays,
    yutoDualPmDays: [...yutoDualPmDays].sort(),
    yutoOnHiromuUenoDays,
    storeClosedDates,
    storeClosedExtra,
    owners,
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

function validateCrossStore(rows, crossBusy, yutoDualPmDays) {
  for (const r of rows) {
    if (r.trainer_name === TRAINER_HIROMU && crossBusy.hiromuBusy.has(r.shift_date)) {
      throw new Error(`ひろむ他店舗と同日: ${r.shift_date}`);
    }
    if (r.trainer_name === TRAINER_YUTO && crossBusy.yutoShinjukuDates.includes(r.shift_date)) {
      if (!yutoDualPmDays.has(r.shift_date)) {
        throw new Error(`ゆうと新宿勤務日に恵比寿未配置: ${r.shift_date}`);
      }
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
  const slotsOverride = parseSlotsOverride(process.argv);

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const supabase = url && key ? createClient(url, key, { auth: { persistSession: false } }) : null;

  let activeMembers = activeOverride ?? Math.round(DEFAULT_TARGET_SLOTS / 12);
  let uenoActive = 40;
  let sakuraActive = 35;
  if (supabase && activeOverride == null) {
    activeMembers = await loadActiveStoreCount(supabase, STORE_NAME);
    uenoActive = await loadActiveStoreCount(supabase, "上野");
    sakuraActive = await loadActiveStoreCount(supabase, "桜木町");
  }

  const crossBusy = loadCrossStoreBusy(uenoActive, sakuraActive);
  const targetSlots = slotsOverride ?? DEFAULT_TARGET_SLOTS;
  const plan = buildRows(targetSlots, crossBusy);
  validateNoTrainerOverlap(plan.rows);
  validateSingleBoothPerDay(plan.rows);
  validateCrossStore(plan.rows, crossBusy, new Set(plan.yutoDualPmDays));
  const summary = summarize(plan.rows, plan, targetSlots, activeMembers);

  const calendar = allOctoberDates().map((date) => {
    const dayRows = plan.rows.filter((r) => r.shift_date === date);
    const trainer = plan.owners.get(date) ?? null;
    const dow = parseLocalDate(date).getDay();
    const saturday = dow === 6;
    const closed = saturday || (!trainer && plan.candidates.includes(date));
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
      hiromuBusyDays: crossBusy.hiromuBusy.size,
      yutoShinjukuDays: crossBusy.yutoShinjukuDates.map((d) => dayNum(d)),
      yutoDualPmDays: plan.yutoDualPmDays.map((d) => dayNum(d)),
    },
    ...summary,
    plan: {
      targetSlots,
      hiromuEbisuDays: plan.hiromuDays.map((d) => dayNum(d)),
      yutoEbisuDays: plan.yutoWorkDays.map((d) => dayNum(d)),
      yutoEbisuDualPmDays: plan.yutoDualPmDays.map((d) => dayNum(d)),
      yutoRestDays: plan.yutoRestDays.map((d) => dayNum(d)),
      yutoEbisuOnHiromuUenoDays: plan.yutoOnHiromuUenoDays.map((d) => dayNum(d)),
      storeClosedDays: plan.storeClosedDates.map((d) => dayNum(d)),
      trimmedForSlots: plan.storeClosedExtra.map((d) => dayNum(d)),
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
  for (const n of TRAINER_NAMES) {
    if (!trainerIdByName.get(n)) throw new Error(`トレーナー未登録: ${n}`);
  }

  const trainerIds = TRAINER_NAMES.map((n) => trainerIdByName.get(n));
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
    const { error } = await supabase.from("trainer_shifts").delete().in("id", ids.slice(i, i + 200));
    if (error) throw error;
  }
  for (let i = 0; i < payload.length; i += 200) {
    const { error } = await supabase.from("trainer_shifts").insert(payload.slice(i, i + 200));
    if (error) throw error;
  }

  console.log(JSON.stringify({ done: true, deleted: ids.length, inserted: payload.length }, null, 2));
}

export {
  buildRows,
  loadCrossStoreBusy,
  openCandidateDates,
  pickHiromuEbisuDays,
  pickYutoEbisuWorkDays,
  validateYutoWeeklyRest,
};

import { pathToFileURL } from "url";
const isCli = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isCli) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
