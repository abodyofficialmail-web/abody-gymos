import { createClient } from "@supabase/supabase-js";
import { fetchAllChecked } from "./lib/supabaseFetchAll.mjs";

/**
 * 2026-10 上野店シフト（ひろむ・せいやのみ）
 *
 * - 目標枠: アクティブ会員×12（休会・退会除外）
 * - 営業帯: 9:00–22:00（30分コマ）
 * - 同時1ブース（2ブース開放なし・重複シフトなし）
 * - せいや希望日を優先し、それ以外はひろむ
 * - ひろむの夕方は 18:00 終了 / 21:00 終了を日数半々（交互）
 *
 * node --env-file=.env.local scripts/sync-ueno-shifts-2026-10.mjs --dry-run
 * node --env-file=.env.local scripts/sync-ueno-shifts-2026-10.mjs --dry-run --active=40
 */
const MONTH = "2026-10";
const MONTH_LAST_DAY = "31";
const STORE_NAME = "上野";
const TRAINER_NAMES = ["ひろむ", "せいや"];
/** 予約サイトに枠を出す */
const SHIFT_STATUS = "confirmed";

/** 2ブース換算なし（上野も同時1枠でカウント） */
const SINGLE_BOOTH = new Set(["恵比寿", "新宿", "上野"]);

/** せいや 終日希望（10月） */
const SEIYA_DAY_NUMBERS = new Set([5, 6, 10, 12, 13, 17, 19, 20, 24, 26, 27, 31]);

const AM = ["09:00", "13:00"];
const PM = ["16:00", "22:00"];

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

function row(date, start, end, trainer) {
  return {
    shift_date: date,
    start_local: toHHMMSS(start),
    end_local: toHHMMSS(end),
    trainer_name: trainer,
    store_name: STORE_NAME,
    break_minutes: 0,
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

function blocksForDay(pmEnd = "22:00") {
  return [
    [AM[0], AM[1]],
    [PM[0], pmEnd],
  ];
}

function buildDayRows(date, trainer, pmEnd = "22:00") {
  return blocksForDay(pmEnd).map(([s, e]) => row(date, s, e, trainer));
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

function slotsForDay(pmEnd) {
  const rows = [
    row("2000-01-01", AM[0], AM[1], "x"),
    row("2000-01-01", PM[0], pmEnd, "x"),
  ];
  return countSlots(rows);
}

const HIROMU_PM_SHORT = "18:00";
const HIROMU_PM_LONG = "21:00";

/** ひろむ勤務日: 夕方 18:00 終了 / 21:00 終了を交互（差1日まで） */
function initialHiromuPmByDate(hiromuDates) {
  const map = new Map();
  hiromuDates.forEach((d, i) => {
    map.set(d, i % 2 === 0 ? HIROMU_PM_LONG : HIROMU_PM_SHORT);
  });
  return map;
}

function countHiromuPmEnds(hiromuPmByDate) {
  let shortN = 0;
  let longN = 0;
  for (const end of hiromuPmByDate.values()) {
    if (end === HIROMU_PM_SHORT) shortN += 1;
    else if (end === HIROMU_PM_LONG) longN += 1;
  }
  return { shortN, longN };
}

/** せいや希望日は終日（9–13 / 16–22）。ひろむは残り全日・PM18/21半々 */
function buildRows(targetSlots) {
  const seiyaDates = [...SEIYA_DAY_NUMBERS].sort((a, b) => a - b).map(octDate);
  const hiromuDates = allOctoberDates().filter((d) => !seiyaDates.includes(d));

  const seiyaSlotsPerDay = slotsForDay("22:00");
  const seiyaTotal = seiyaDates.length * seiyaSlotsPerDay;

  const hiromuPmByDate = initialHiromuPmByDate(hiromuDates);

  const rows = [];
  for (const d of seiyaDates) {
    rows.push(...buildDayRows(d, "せいや", "22:00"));
  }
  for (const d of hiromuDates) {
    rows.push(...buildDayRows(d, "ひろむ", hiromuPmByDate.get(d)));
  }

  const pmEnds = countHiromuPmEnds(hiromuPmByDate);
  const slots = countSlots(rows);

  return {
    rows,
    slots,
    seiyaDates,
    hiromuDates,
    targetSlots,
    seiyaSlotTotal: seiyaTotal,
    hiromuPmByDate: Object.fromEntries(hiromuPmByDate),
    hiromuPm18Days: pmEnds.shortN,
    hiromuPm21Days: pmEnds.longN,
    slotPctOfTarget: targetSlots ? Math.round((slots / targetSlots) * 1000) / 10 : null,
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
    const t = byTrainer.get(r.trainer_name) ?? { days: new Set(), minutes: 0 };
    t.days.add(r.shift_date);
    t.minutes += toMinutes(r.end_local) - toMinutes(r.start_local);
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
      hours: Math.round((v.minutes / 60) * 10) / 10,
    })),
    meta: {},
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
  const summary = {
    ...summarize(rows, targetSlots, activeMembers),
    meta: {
      hiromuPmByDate: plan.hiromuPmByDate,
    },
  };

  const calendar = allOctoberDates().map((date) => {
    const dayNum = Number(date.slice(-2));
    const owner = dayOwner(dayNum);
    const dayRows = rows.filter((r) => r.shift_date === date);
    const open = dayRows.length > 0;
    return {
      date,
      trainer: open ? owner : null,
      blocks: dayRows.map((r) => `${r.start_local.slice(0, 5)}-${r.end_local.slice(0, 5)}`),
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
      hiromuPmByDate: plan.hiromuPmByDate,
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
  for (let i = 0; i < payload.length; i += 200) {
    const { error } = await supabase.from("trainer_shifts").insert(payload.slice(i, i + 200));
    if (error) throw error;
  }

  console.log(JSON.stringify({ done: true, deleted: ids.length, inserted: payload.length, ...summary }, null, 2));
}

export { buildRows, countSlots, SEIYA_DAY_NUMBERS };

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
