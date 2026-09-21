import { createClient } from "@supabase/supabase-js";
import { fetchAllChecked } from "./lib/supabaseFetchAll.mjs";
import { buildRows as buildUenoPlan } from "./sync-ueno-shifts-2026-10.mjs";
import { buildRows as buildSakuraPlan } from "./sync-sakuragicho-shifts-2026-10.mjs";

/**
 * 2026-10 新宿店（ひろむ・りょう・ゆうと）
 *
 * - 目標枠: アクティブ会員×12、同時1ブース
 * - ひろむ: 上野10月案を考慮、週2休、新宿で約60h
 * - りょう: 桜木町勤務日・休み希望(1,7,14,20,26)以外を新宿
 * - ゆうと: 残り枠
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

const HIROMU_SHINJUKU_TARGET_HOURS = 60;
const HIROMU_OFF_PER_WEEK = 2;

/** 桜木町・りょう休み希望（新宿も休み） */
const RYO_OFF_DAY_NUMS = new Set([1, 7, 14, 20, 26]);

const SINGLE_BOOTH = new Set(["恵比寿", "新宿", "上野", "桜木町"]);

const HIROMU_SHINJUKU_TEMPLATES = [
  { key: "day", segments: [["10:00", "13:00"], ["14:00", "22:00"]], breakMinutes: 60 },
  { key: "mid", segments: [["10:00", "15:00"], ["16:00", "19:00"]], breakMinutes: 60 },
  { key: "am", segments: [["10:00", "15:00"]], breakMinutes: 0 },
];

const RYO_SHINJUKU_TEMPLATES = [
  { key: "full", segments: [["09:00", "13:00"], ["16:00", "22:00"]], breakMinutes: 60 },
  { key: "med", segments: [["10:00", "13:00"], ["16:00", "21:00"]], breakMinutes: 60 },
  { key: "short", segments: [["14:00", "17:00"], ["18:00", "20:00"]], breakMinutes: 60 },
  { key: "mini", segments: [["16:00", "19:00"]], breakMinutes: 0 },
];

const YUTO_TEMPLATES = [
  { key: "full", segments: [["09:00", "13:00"], ["16:00", "22:00"]], breakMinutes: 60 },
  { key: "long", segments: [["10:00", "14:00"], ["15:00", "21:00"]], breakMinutes: 60 },
  { key: "std", segments: [["10:00", "13:00"], ["16:00", "21:00"]], breakMinutes: 60 },
  { key: "pm", segments: [["14:00", "18:00"], ["19:00", "21:00"]], breakMinutes: 60 },
  { key: "mini", segments: [["17:00", "21:00"]], breakMinutes: 30 },
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

function slotsForTemplate(template) {
  return countSlots(rowsForTemplate("2000-01-01", "x", template));
}

function loadCrossStoreContext(uenoActive, sakuraActive) {
  const ueno = buildUenoPlan(uenoActive * 12);
  const sakura = buildSakuraPlan(sakuraActive * 12);
  const hiromuUenoDates = new Set(ueno.hiromuDates);
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

function pickHiromuShinjukuDays(dates, hiromuUenoDates, hiromuRestDays) {
  const candidates = dates.filter((d) => !hiromuUenoDates.has(d) && !hiromuRestDays.has(d));
  const dayTpl = HIROMU_SHINJUKU_TEMPLATES.find((t) => t.key === "day");
  const dayH = templateWorkHours(dayTpl);
  const needDays = Math.max(1, Math.round(HIROMU_SHINJUKU_TARGET_HOURS / dayH));

  const picked = candidates.slice(0, needDays);
  return picked.sort();
}

function isRyoShinjukuEligible(date, sakuraRyoDates) {
  const n = dayNum(date);
  if (RYO_OFF_DAY_NUMS.has(n)) return false;
  if (sakuraRyoDates.has(date)) return false;
  return true;
}

function assignDayOwners(dates, hiromuShinjukuDays, sakuraRyoDates) {
  const hiromuSet = new Set(hiromuShinjukuDays);
  const owners = new Map();
  for (const date of dates) {
    if (hiromuSet.has(date)) owners.set(date, TRAINER_HIROMU);
    else if (isRyoShinjukuEligible(date, sakuraRyoDates)) owners.set(date, TRAINER_RYO);
    else owners.set(date, TRAINER_YUTO);
  }
  return owners;
}

function pickTemplatesForDays(dayList, trainer, templates, slotsNeeded, slotCeilingExtra = 4) {
  if (!dayList.length) return [];
  const opts = templates
    .map((t) => ({ template: t, slots: slotsForTemplate(t), workHours: templateWorkHours(t) }))
    .sort((a, b) => a.slots - b.slots);

  const plan = dayList.map((date) => ({
    date,
    template: opts[0].template,
    slots: opts[0].slots,
    key: opts[0].template.key,
  }));
  let sum = plan.reduce((s, p) => s + p.slots, 0);

  let guard = 0;
  while (sum < slotsNeeded && guard++ < 800) {
    let upgraded = false;
    for (let i = 0; i < plan.length; i++) {
      for (const opt of opts) {
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
      for (const opt of opts) {
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
  const hiromuShinjukuDays = pickHiromuShinjukuDays(dates, hiromuUenoDates, hiromuRestDays);
  const owners = assignDayOwners(dates, hiromuShinjukuDays, sakuraRyoDates);

  const hiromuDates = dates.filter((d) => owners.get(d) === TRAINER_HIROMU);
  const ryoDates = dates.filter((d) => owners.get(d) === TRAINER_RYO);
  const yutoDates = dates.filter((d) => owners.get(d) === TRAINER_YUTO);

  const hiromuRows = hiromuDates.flatMap((d) =>
    rowsForTemplate(d, TRAINER_HIROMU, HIROMU_SHINJUKU_TEMPLATES.find((t) => t.key === "day")),
  );
  const hiromuSlots = countSlots(hiromuRows);

  const needRyoSlots = Math.max(0, Math.floor((targetSlots - hiromuSlots) * 0.42));
  const ryoPlan = pickTemplatesForDays(ryoDates, TRAINER_RYO, RYO_SHINJUKU_TEMPLATES, needRyoSlots, 8);
  const ryoRows = ryoPlan.flatMap(({ date, template }) => rowsForTemplate(date, TRAINER_RYO, template));
  const ryoSlots = countSlots(ryoRows);

  const needYutoSlots = Math.max(0, targetSlots - hiromuSlots - ryoSlots);
  const yutoPlan = pickTemplatesForDays(yutoDates, TRAINER_YUTO, YUTO_TEMPLATES, needYutoSlots, 6);
  const yutoRows = yutoPlan.flatMap(({ date, template }) => rowsForTemplate(date, TRAINER_YUTO, template));

  const rows = [...hiromuRows, ...ryoRows, ...yutoRows];
  return {
    rows,
    slots: countSlots(rows),
    targetSlots,
    hiromuShinjukuDays,
    hiromuRestDays: [...hiromuRestDays].sort(),
    hiromuUenoDates: [...hiromuUenoDates].sort(),
    ryoDates,
    yutoDates,
    owners,
    ryoPlan,
    yutoPlan,
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

  let activeMembers = activeOverride ?? 25;
  let uenoActive = 40;
  let sakuraActive = 35;
  if (supabase && activeOverride == null) {
    activeMembers = await loadActiveStoreCount(supabase, STORE_NAME);
    uenoActive = await loadActiveStoreCount(supabase, "上野");
    sakuraActive = await loadActiveStoreCount(supabase, "桜木町");
  }

  const crossStore = loadCrossStoreContext(uenoActive, sakuraActive);
  const targetSlots = activeMembers * 12;
  const plan = buildRows(targetSlots, crossStore);
  validateNoTrainerOverlap(plan.rows);
  validateSingleBoothPerDay(plan.rows);
  const summary = summarize(plan.rows, plan, targetSlots, activeMembers);

  const calendar = allOctoberDates().map((date) => {
    const dayRows = plan.rows.filter((r) => r.shift_date === date);
    const trainer = plan.owners.get(date) ?? null;
    return {
      date,
      trainer,
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
      hiromuShinjukuDays: plan.hiromuShinjukuDays.length,
      hiromuRestDays: plan.hiromuRestDays.map((d) => dayNum(d)),
      ryoShinjukuDays: plan.ryoDates.length,
      yutoDays: plan.yutoDates.length,
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
