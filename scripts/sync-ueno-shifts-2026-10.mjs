import { createClient } from "@supabase/supabase-js";
import { fetchAllChecked } from "./lib/supabaseFetchAll.mjs";

/**
 * 2026-10 上野店シフト（ひろむ・せいやのみ）
 *
 * - 目標枠: アクティブ会員×12（休会・退会除外）
 * - 同時1ブース（2ブース開放なし）
 * - せいや希望日: 9–13 / 16–22
 * - ひろむ: 18:00終了日は 9:00〜（休憩1h）、21:00終了日は 14:00〜（休憩1h）
 * - 10月は店舗開放を2日省略（14時開始日から優先して休み → 9時開始日を増やして会員×12を維持）
 *
 * node --env-file=.env.local scripts/sync-ueno-shifts-2026-10.mjs --dry-run
 */
const MONTH = "2026-10";
const MONTH_LAST_DAY = "31";
const STORE_NAME = "上野";
const TRAINER_NAMES = ["ひろむ", "せいや"];
const SHIFT_STATUS = "confirmed";
const HIROMU_BREAK_MINUTES = 60;

const SINGLE_BOOTH = new Set(["恵比寿", "新宿", "上野"]);

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

function dayOwner(dayNum) {
  return SEIYA_DAY_NUMBERS.has(dayNum) ? "せいや" : "ひろむ";
}

function buildSeiyaDayRows(date) {
  return [row(date, "09:00", "13:00", "せいや", 0), row(date, "16:00", "22:00", "せいや", 0)];
}

function buildHiromuDayRows(date, pattern) {
  return pattern.segments.map(([s, e], i) => row(date, s, e, "ひろむ", i === 0 ? HIROMU_BREAK_MINUTES : 0));
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
      if (SINGLE_BOOTH.has(store)) cap = cap > 0 ? 1 : 0;
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
  const hiromuCandidates = allOctoberDates().filter((d) => !seiyaDates.includes(d)).sort();
  const hiromuClosedDates = pickHiromuClosedDates(hiromuCandidates);
  const hiromuDates = hiromuCandidates.filter((d) => !hiromuClosedDates.includes(d));

  const seiyaPerDay = seiyaSlotsPerDay();
  const seiyaTotal = seiyaDates.length * seiyaPerDay;
  const needHiromu = Math.max(0, targetSlots - seiyaTotal);

  const hiromuPatternByDate = assignHiromuPatterns(hiromuDates, needHiromu);

  const rows = [];
  for (const d of seiyaDates) rows.push(...buildSeiyaDayRows(d));
  for (const d of hiromuDates) rows.push(...buildHiromuDayRows(d, hiromuPatternByDate.get(d)));

  const hiromuEarlyDays = [...hiromuPatternByDate.values()].filter((p) => p.kind === "early").length;
  const hiromuLateDays = hiromuDates.length - hiromuEarlyDays;
  const slots = countSlots(rows);

  const hiromuPmByDate = Object.fromEntries(
    [...hiromuPatternByDate.entries()].map(([d, p]) => [d, p.kind === "early" ? "18:00" : "21:00"]),
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
    hiromuLateDays,
    hiromuPmByDate,
    hiromuPatternByDate,
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
      throw new Error(`同日複数トレーナー（1ブース運用）: ${date} ${[...trainers].join("+")}`);
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

  let activeMembers = activeOverride ?? 40;
  if (supabase && activeOverride == null) {
    activeMembers = await loadActiveUenoCount(supabase);
  }

  const targetSlots = activeMembers * 12;
  const plan = buildRows(targetSlots);
  const { rows } = plan;
  validateNoTrainerOverlap(rows);
  validateSingleBoothPerDay(rows);
  const summary = summarize(rows, targetSlots, activeMembers);

  const calendar = allOctoberDates().map((date) => {
    const dayNum = Number(date.slice(-2));
    const closedHiromu = plan.hiromuClosedDates.includes(date);
    const owner = closedHiromu ? null : dayOwner(dayNum);
    const dayRows = rows.filter((r) => r.shift_date === date);
    const open = dayRows.length > 0;
    const breakMin = dayRows.reduce((s, r) => s + (r.break_minutes ?? 0), 0);
    return {
      date,
      trainer: open ? owner : null,
      closed: closedHiromu || undefined,
      blocks: dayRows.map((r) => `${r.start_local.slice(0, 5)}-${r.end_local.slice(0, 5)}`),
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
      hiromuLateDays: plan.hiromuLateDays,
      hiromuPmByDate: plan.hiromuPmByDate,
      hiromuClosedDates: plan.hiromuClosedDates,
      hiromuBreakMinutesPerDay: HIROMU_BREAK_MINUTES,
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

export { buildRows, countSlots, SEIYA_DAY_NUMBERS, HIROMU_EARLY, HIROMU_LATE };

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
