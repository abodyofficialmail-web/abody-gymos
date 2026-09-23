import { createClient } from "@supabase/supabase-js";
import { fetchAllChecked } from "./lib/supabaseFetchAll.mjs";

/**
 * 2026-10 上野店シフト（ひろむ・せいやのみ）
 *
 * - 目標枠: 約500（--slots= / --active= で上書き可）
 * - 同時最大2ブース（上野のみ）
 * - せいや希望日: 平日 9–13 / 16–22、土曜 9–17（13–14 休憩1h）
 * - せいや出勤日のうち週1日: ひろむ 16–22 を追加（夕方2ブース）
 * - ひろむ: 日曜は 10–18（13–14 休憩1h）
 * - ひろむ 9–18 日の半分は中抜け 9–14 / 17–22
 * - ひろむ 10/29: 10–22（14–17 中抜け）
 * - その他単独日: 9–18 または 14–21（従来・休憩1h）
 * - 10月はひろむ単独日を2日省略
 *
 * node --env-file=.env.local scripts/sync-ueno-shifts-2026-10.mjs --dry-run
 */
const MONTH = "2026-10";
const MONTH_LAST_DAY = "31";
const STORE_NAME = "上野";
const TRAINER_NAMES = ["ひろむ", "せいや"];
const SHIFT_STATUS = "confirmed";
const HIROMU_BREAK_MINUTES = 60;
const DEFAULT_TARGET_SLOTS = 500;
const UENO_MAX_BOOTHS = 2;

const SINGLE_BOOTH = new Set(["恵比寿", "新宿"]);

const SEIYA_DAY_NUMBERS = new Set([5, 6, 10, 12, 13, 17, 19, 20, 24, 26, 27, 31]);

/** 上野・ひろむ稼働なし（予約枠なし）の日数 */
const HIROMU_STORE_CLOSED_COUNT = 2;

/** 9:00〜18:00（13–14 休憩1h）→ 予約16コマ */
const HIROMU_EARLY = {
  kind: "early",
  label: "9-18",
  segments: [
    ["09:00", "13:00"],
    ["14:00", "18:00"],
  ],
  slotsPerDay: 16,
};

/** 14:00〜21:00（17–18 休憩1h）→ 予約12コマ */
const HIROMU_LATE = {
  kind: "late",
  label: "14-21",
  segments: [
    ["14:00", "17:00"],
    ["18:00", "21:00"],
  ],
  slotsPerDay: 12,
};

/** 日曜 10:00〜18:00（13–14 休憩1h） */
const HIROMU_SUNDAY = {
  kind: "sunday",
  label: "10-18",
  segments: [
    ["10:00", "13:00"],
    ["14:00", "18:00"],
  ],
  slotsPerDay: 16,
  breakOnFirstSegment: true,
};

/** 9–14 / 17–22（14–17 中抜け3h・休憩枠なし） */
const HIROMU_SPLIT = {
  kind: "split",
  label: "9-14/17-22",
  segments: [
    ["09:00", "14:00"],
    ["17:00", "22:00"],
  ],
  slotsPerDay: 20,
  breakOnFirstSegment: false,
};

/** 10/29 10–22（14–17 中抜け3h） */
const HIROMU_OCT29 = {
  kind: "oct29",
  label: "10-22",
  segments: [
    ["10:00", "14:00"],
    ["17:00", "22:00"],
  ],
  slotsPerDay: 20,
  breakOnFirstSegment: false,
};

const HIROMU_OCT29_DAY_NUM = 29;

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

function dayOwner(dayNum) {
  return SEIYA_DAY_NUMBERS.has(dayNum) ? "せいや" : "ひろむ";
}

function buildSeiyaDayRows(date) {
  const dow = parseLocalDate(date).getDay();
  if (dow === 6) {
    return [row(date, "09:00", "13:00", "せいや", 0), row(date, "14:00", "17:00", "せいや", 0)];
  }
  return [row(date, "09:00", "13:00", "せいや", 0), row(date, "16:00", "22:00", "せいや", 0)];
}

function buildHiromuPmDualRows(date) {
  return [row(date, "16:00", "22:00", "ひろむ", 0)];
}

/** せいや出勤日から、週1日ずつ夕方2ブース用にひろむ16–22を選ぶ */
function pickSeiyaHiromuDualDays(seiyaDates) {
  const picked = [];
  for (const weekDates of groupDatesByMondayWeek(seiyaDates)) {
    const sorted = [...weekDates].sort((a, b) => a.localeCompare(b));
    if (sorted.length) picked.push(sorted[0]);
  }
  return picked.sort();
}

function buildSeiyaDayRowsForPlan(date, dualDays) {
  const rows = buildSeiyaDayRows(date);
  if (dualDays.includes(date)) rows.push(...buildHiromuPmDualRows(date));
  return rows;
}

function buildHiromuDayRows(date, pattern) {
  const useBreak = pattern.breakOnFirstSegment !== false && pattern.kind !== "split" && pattern.kind !== "oct29";
  return pattern.segments.map(([s, e], i) =>
    row(date, s, e, "ひろむ", i === 0 && useBreak ? HIROMU_BREAK_MINUTES : 0),
  );
}

function isSunday(date) {
  return parseLocalDate(date).getDay() === 0;
}

/** 日曜10–18 / 10/29 固定。残りひろむ日の半分を split、他は early/late で枠調整 */
function assignHiromuPatternsWithRules(hiromuDates, needHiromuSlots) {
  const fixed = new Map();
  const flexible = [];

  for (const d of hiromuDates) {
    if (hiromuDayNum(d) === HIROMU_OCT29_DAY_NUM) {
      fixed.set(d, HIROMU_OCT29);
    } else if (isSunday(d)) {
      fixed.set(d, HIROMU_SUNDAY);
    } else {
      flexible.push(d);
    }
  }

  const patternSlots = (p) => p.slotsPerDay ?? countSlots(buildHiromuDayRows("2000-01-01", p));

  const fixedSlots = [...fixed.values()].reduce((sum, p) => sum + patternSlots(p), 0);
  const splitCount = Math.floor(flexible.length / 2);
  const splitDates = new Set(flexible.slice(0, splitCount));
  const splitSlots = splitCount * patternSlots(HIROMU_SPLIT);
  const remainDates = flexible.filter((d) => !splitDates.has(d));
  const needRemain = Math.max(0, needHiromuSlots - fixedSlots - splitSlots);
  const baseAssign = assignHiromuPatterns(remainDates, needRemain);

  const typeByDate = new Map(fixed);
  for (const d of flexible) {
    if (splitDates.has(d)) typeByDate.set(d, HIROMU_SPLIT);
    else typeByDate.set(d, baseAssign.get(d));
  }
  return typeByDate;
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
      if (store === STORE_NAME) cap = Math.min(cap, UENO_MAX_BOOTHS);
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

function seiyaSlotsPerDay() {
  return countSlots(buildSeiyaDayRows("2000-01-01"));
}

function solveHiromuEarlyLateCounts(needHiromuSlots, dayCount) {
  let early = Math.floor(
    (needHiromuSlots - HIROMU_LATE.slotsPerDay * dayCount) / (HIROMU_EARLY.slotsPerDay - HIROMU_LATE.slotsPerDay),
  );
  early = Math.max(0, Math.min(dayCount, early));
  let late = dayCount - early;
  let slots = early * HIROMU_EARLY.slotsPerDay + late * HIROMU_LATE.slotsPerDay;
  while (slots > needHiromuSlots && early > 0) {
    early -= 1;
    late += 1;
    slots = early * HIROMU_EARLY.slotsPerDay + late * HIROMU_LATE.slotsPerDay;
  }
  while (slots < needHiromuSlots && early < dayCount) {
    early += 1;
    late -= 1;
    slots = early * HIROMU_EARLY.slotsPerDay + late * HIROMU_LATE.slotsPerDay;
  }
  return { early, late, slots };
}

function hiromuDayNum(date) {
  return Number(date.slice(-2));
}

function datesAreConsecutive(a, b) {
  return Math.abs(hiromuDayNum(a) - hiromuDayNum(b)) === 1;
}

/** 省略2日: 月末寄りを優先しつつ、カレンダー上連日にしない */
function pickHiromuClosedDates(hiromuCandidates) {
  if (HIROMU_STORE_CLOSED_COUNT <= 0) return [];
  const need = HIROMU_STORE_CLOSED_COUNT;
  if (hiromuCandidates.length <= need) {
    throw new Error("ひろむ候補日が休み日数より少ないです");
  }

  const picked = [];
  for (const d of [...hiromuCandidates].reverse()) {
    if (picked.length >= need) break;
    if (picked.some((p) => datesAreConsecutive(p, d))) continue;
    picked.push(d);
  }
  if (picked.length < need) {
    for (const d of hiromuCandidates) {
      if (picked.includes(d)) continue;
      if (picked.some((p) => datesAreConsecutive(p, d))) continue;
      picked.push(d);
      if (picked.length >= need) break;
    }
  }
  if (picked.length < need) {
    throw new Error("非連続の休み日を確保できませんでした");
  }
  return picked.sort();
}

/** 交互に early/late を割当し、目標コマ数に合わせて early 日数を調整 */
function assignHiromuPatterns(hiromuDates, needHiromuSlots) {
  const { early: earlyTarget } = solveHiromuEarlyLateCounts(needHiromuSlots, hiromuDates.length);
  const typeByDate = new Map();
  let earlyAssigned = 0;
  for (let i = 0; i < hiromuDates.length; i++) {
    const d = hiromuDates[i];
    const preferEarly = i % 2 === 0;
    if (preferEarly && earlyAssigned < earlyTarget) {
      typeByDate.set(d, HIROMU_EARLY);
      earlyAssigned += 1;
    } else {
      typeByDate.set(d, HIROMU_LATE);
    }
  }
  for (const d of hiromuDates) {
    if (earlyAssigned >= earlyTarget) break;
    if (typeByDate.get(d) === HIROMU_LATE) {
      typeByDate.set(d, HIROMU_EARLY);
      earlyAssigned += 1;
    }
  }
  return typeByDate;
}

function buildRows(targetSlots) {
  const seiyaDates = [...SEIYA_DAY_NUMBERS].sort((a, b) => a - b).map(octDate);
  const seiyaHiromuDualDays = pickSeiyaHiromuDualDays(seiyaDates);
  const hiromuCandidates = allOctoberDates().filter((d) => !seiyaDates.includes(d)).sort();
  const hiromuClosedDates = pickHiromuClosedDates(hiromuCandidates);
  const hiromuDates = hiromuCandidates.filter((d) => !hiromuClosedDates.includes(d));

  let seiyaTotal = 0;
  for (const d of seiyaDates) {
    seiyaTotal += countSlots(buildSeiyaDayRowsForPlan(d, seiyaHiromuDualDays));
  }
  const needHiromu = Math.max(0, targetSlots - seiyaTotal);

  const hiromuPatternByDate = assignHiromuPatternsWithRules(hiromuDates, needHiromu);

  const rows = [];
  for (const d of seiyaDates) rows.push(...buildSeiyaDayRowsForPlan(d, seiyaHiromuDualDays));
  for (const d of hiromuDates) rows.push(...buildHiromuDayRows(d, hiromuPatternByDate.get(d)));

  /** 固定ルール後に枠超過する場合、split 日を末尾から late に落とす（日曜・10/29は維持） */
  let slotsNow = countSlots(rows);
  const splitDemoteOrder = hiromuDates
    .filter((d) => hiromuPatternByDate.get(d)?.kind === "split")
    .sort((a, b) => b.localeCompare(a));
  for (const d of splitDemoteOrder) {
    if (slotsNow <= targetSlots) break;
    hiromuPatternByDate.set(d, HIROMU_LATE);
    rows.length = 0;
    for (const sd of seiyaDates) rows.push(...buildSeiyaDayRowsForPlan(sd, seiyaHiromuDualDays));
    for (const hd of hiromuDates) rows.push(...buildHiromuDayRows(hd, hiromuPatternByDate.get(hd)));
    slotsNow = countSlots(rows);
  }

  const hiromuEarlyDays = [...hiromuPatternByDate.values()].filter((p) => p.kind === "early").length;
  const hiromuSplitDays = [...hiromuPatternByDate.values()].filter((p) => p.kind === "split").length;
  const hiromuSundayDays = [...hiromuPatternByDate.values()].filter((p) => p.kind === "sunday").length;
  const hiromuLateDays = [...hiromuPatternByDate.values()].filter((p) => p.kind === "late").length;
  const slots = countSlots(rows);

  const hiromuPmByDate = Object.fromEntries(
    [...hiromuPatternByDate.entries()].map(([d, p]) => {
      if (p.kind === "early" || p.kind === "sunday") return [d, "18:00"];
      if (p.kind === "split" || p.kind === "oct29") return [d, "22:00"];
      return [d, "21:00"];
    }),
  );

  return {
    rows,
    slots,
    seiyaDates,
    hiromuDates,
    hiromuClosedDates,
    targetSlots,
    seiyaSlotTotal: seiyaTotal,
    hiromuEarlyDays,
    hiromuSplitDays,
    hiromuSundayDays,
    hiromuLateDays,
    hiromuPmByDate,
    hiromuPatternByDate,
    seiyaHiromuDualDays,
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

function validateUenoBoothLimit(rows) {
  const byDate = new Map();
  for (const r of rows) {
    const list = byDate.get(r.shift_date) ?? [];
    list.push(r);
    byDate.set(r.shift_date, list);
  }
  for (const [date, dayRows] of byDate) {
    const trainers = new Set(dayRows.map((r) => r.trainer_name));
    if (trainers.size > UENO_MAX_BOOTHS) {
      throw new Error(`上野2ブース超過: ${date} ${[...trainers].join("+")}`);
    }
  }
}

function summarize(rows, targetSlots, activeMembers) {
  const byTrainer = new Map();
  for (const r of rows) {
    const t = byTrainer.get(r.trainer_name) ?? { days: new Set(), workMinutes: 0, breakMinutes: 0 };
    t.days.add(r.shift_date);
    t.workMinutes += toMinutes(r.end_local) - toMinutes(r.start_local);
    t.breakMinutes += r.break_minutes ?? 0;
    byTrainer.set(r.trainer_name, t);
  }
  const slots = countSlots(rows);
  return {
    store: STORE_NAME,
    activeMembers,
    targetSlots,
    slots,
    slotPctOfTarget: targetSlots ? Math.round((slots / targetSlots) * 1000) / 10 : null,
    trainers: [...byTrainer.entries()].map(([name, v]) => ({
      name,
      days: v.days.size,
      workHours: Math.round((v.workMinutes / 60) * 10) / 10,
      breakHours: Math.round((v.breakMinutes / 60) * 10) / 10,
    })),
  };
}

async function loadActiveUenoCount(supabase) {
  const [membersResult, storesResult] = await Promise.all([
    fetchAllChecked(supabase, "members", "id, store_id, is_active, membership_status", undefined, "members"),
    fetchAllChecked(supabase, "stores", "id, name", undefined, "stores"),
  ]);
  const uenoId = storesResult.rows.find((s) => s.name === STORE_NAME)?.id;
  if (!uenoId) throw new Error("上野店が見つかりません");
  return membersResult.rows.filter((m) => m.store_id === uenoId && isActiveMember(m)).length;
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const activeOverride = parseActiveOverride(process.argv);

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const supabase = url && key ? createClient(url, key, { auth: { persistSession: false } }) : null;

  const slotsOverride = parseSlotsOverride(process.argv);
  let activeMembers = activeOverride ?? Math.round(DEFAULT_TARGET_SLOTS / 12);
  if (supabase && activeOverride == null) {
    activeMembers = await loadActiveUenoCount(supabase);
  }

  const targetSlots = slotsOverride ?? DEFAULT_TARGET_SLOTS;
  const plan = buildRows(targetSlots);
  const { rows } = plan;
  validateNoTrainerOverlap(rows);
  validateUenoBoothLimit(rows);
  const summary = summarize(rows, targetSlots, activeMembers);

  const calendar = allOctoberDates().map((date) => {
    const dayNum = Number(date.slice(-2));
    const closedHiromu = plan.hiromuClosedDates.includes(date);
    const dayRows = rows.filter((r) => r.shift_date === date);
    const open = dayRows.length > 0;
    const trainers = [...new Set(dayRows.map((r) => r.trainer_name))];
    const breakMin = dayRows.reduce((s, r) => s + (r.break_minutes ?? 0), 0);
    const dual = plan.seiyaHiromuDualDays.includes(date);
    return {
      date,
      trainers: open ? trainers : null,
      dualPm: dual || undefined,
      closed: closedHiromu || undefined,
      blocks: dayRows.map(
        (r) => `${r.trainer_name} ${r.start_local.slice(0, 5)}-${r.end_local.slice(0, 5)}`,
      ),
      breakMinutes: breakMin || undefined,
    };
  });

  const output = {
    dryRun,
    month: MONTH,
    status: SHIFT_STATUS,
    ...summary,
    plan: {
      seiyaDays: plan.seiyaDates.length,
      hiromuDays: plan.hiromuDates.length,
      hiromuEarlyDays: plan.hiromuEarlyDays,
      hiromuSplitDays: plan.hiromuSplitDays,
      hiromuSundayDays: plan.hiromuSundayDays,
      hiromuLateDays: plan.hiromuLateDays,
      hiromuPmByDate: plan.hiromuPmByDate,
      hiromuClosedDates: plan.hiromuClosedDates,
      hiromuBreakMinutesPerDay: HIROMU_BREAK_MINUTES,
      seiyaHiromuDualDays: plan.seiyaHiromuDualDays.map((d) => Number(d.slice(-2))),
    },
    calendar,
    rowCount: rows.length,
  };

  if (dryRun || !supabase) {
    console.log(JSON.stringify(output, null, 2));
    if (!supabase) return;
  }

  const { data: storeRow, error: storeErr } = await supabase
    .from("stores")
    .select("id,name")
    .eq("name", STORE_NAME)
    .maybeSingle();
  if (storeErr) throw storeErr;
  if (!storeRow?.id) throw new Error("上野 store_id 未取得");
  const storeId = storeRow.id;

  const { data: trainers } = await supabase.from("trainers").select("id,display_name").in("display_name", TRAINER_NAMES);
  const trainerIdByName = new Map((trainers ?? []).map((t) => [t.display_name, t.id]));
  for (const n of TRAINER_NAMES) {
    if (!trainerIdByName.get(n)) throw new Error(`トレーナー未登録: ${n}`);
  }

  const trainerIds = TRAINER_NAMES.map((n) => trainerIdByName.get(n));
  const { data: existing, error: exErr } = await supabase
    .from("trainer_shifts")
    .select("id")
    .eq("store_id", storeId)
    .in("trainer_id", trainerIds)
    .gte("shift_date", `${MONTH}-01`)
    .lte("shift_date", `${MONTH}-${MONTH_LAST_DAY}`);
  if (exErr) throw exErr;

  const payload = rows.map((r) => ({
    trainer_id: trainerIdByName.get(r.trainer_name),
    store_id: storeId,
    shift_date: r.shift_date,
    start_local: r.start_local,
    end_local: r.end_local,
    status: SHIFT_STATUS,
    is_break: false,
    break_minutes: r.break_minutes ?? 0,
  }));

  if (dryRun) {
    console.log(JSON.stringify({ ...output, existingToDelete: existing?.length ?? 0, rowsToInsert: payload.length }, null, 2));
    return;
  }

  const ids = (existing ?? []).map((r) => r.id);
  for (let i = 0; i < ids.length; i += 200) {
    const { error } = await supabase.from("trainer_shifts").delete().in("id", ids.slice(i, i + 200));
    if (error) throw error;
  }

  const { data: inserted, error: insErr } = await supabase.from("trainer_shifts").insert(payload).select("id, shift_date, start_local, trainer_id");
  if (insErr) throw insErr;

  console.log(JSON.stringify({ done: true, deleted: ids.length, inserted: inserted?.length ?? payload.length, ...summary }, null, 2));
}

export {
  buildRows,
  countSlots,
  SEIYA_DAY_NUMBERS,
  HIROMU_EARLY,
  HIROMU_LATE,
  UENO_MAX_BOOTHS,
  STORE_NAME as UENO_STORE_NAME,
};

import { pathToFileURL } from "url";
const isCli = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isCli) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
