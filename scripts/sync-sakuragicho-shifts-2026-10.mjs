import { createClient } from "@supabase/supabase-js";
import { fetchAllChecked } from "./lib/supabaseFetchAll.mjs";

/**
 * 2026-10 桜木町店（たけはる・りょう）
 *
 * - 目標枠: アクティブ会員×12
 * - 同時1ブース
 * - たけはる 171h / 月、残り日・枠はりょう
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
const TAKE_TARGET_WORK_HOURS = 171;

const SINGLE_BOOTH = new Set(["恵比寿", "新宿", "上野", "桜木町"]);

const RYO_OFF_DAYS = new Set([1, 7, 14, 20, 26]);
const TAKE_OFF_DAYS = new Set([6, 8]);

/** 10-13 / 16-22（15-16 休憩） */
const TAKE_TEMPLATE = {
  segments: [
    ["10:00", "13:00"],
    ["16:00", "22:00"],
  ],
  breakMinutes: 60,
};

const RYO_TEMPLATES = [
  { key: "full", segments: [["09:00", "13:00"], ["16:00", "22:00"]], breakMinutes: 60 },
  { key: "med", segments: [["10:00", "13:00"], ["16:00", "21:00"]], breakMinutes: 60 },
  { key: "pm", segments: [["14:00", "17:00"], ["18:00", "21:30"]], breakMinutes: 60 },
  { key: "short", segments: [["14:00", "17:00"], ["18:00", "20:00"]], breakMinutes: 60 },
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

function takeStandardHours() {
  return workHoursForSegments(TAKE_TEMPLATE.segments);
}

function assignTrainerDays(dates) {
  const takeDays = [];
  const ryoDays = [];
  const flex = [];

  for (const d of dates) {
    const n = dayNum(d);
    if (RYO_OFF_DAYS.has(n)) takeDays.push(d);
    else if (TAKE_OFF_DAYS.has(n)) ryoDays.push(d);
    else flex.push(d);
  }

  const takeStdH = takeStandardHours();
  const mandatoryTakeH = takeDays.length * takeStdH;
  let needTakeFlex = Math.max(0, Math.ceil((TAKE_TARGET_WORK_HOURS - mandatoryTakeH) / takeStdH));
  needTakeFlex = Math.min(needTakeFlex, flex.length);

  const flexForTake = flex.slice(0, needTakeFlex);
  const flexForRyo = flex.slice(needTakeFlex);

  takeDays.push(...flexForTake);
  ryoDays.push(...flexForRyo);

  takeDays.sort();
  ryoDays.sort();
  return { takeDays, ryoDays };
}

function buildTakeRows(date, pmEnd = "22:00") {
  const template = {
    segments: [
      ["10:00", "13:00"],
      ["16:00", pmEnd],
    ],
    breakMinutes: TAKE_TEMPLATE.breakMinutes,
  };
  return rowsForTemplate(date, TRAINER_TAKE, template);
}

function tuneTakeHours(takeDays) {
  const rows = [];
  let totalH = 0;
  const stdH = takeStandardHours();

  for (let i = 0; i < takeDays.length; i++) {
    const d = takeDays[i];
    const remaining = TAKE_TARGET_WORK_HOURS - totalH;
    if (remaining <= 0.01) break;

    if (remaining >= stdH - 0.01 || i < takeDays.length - 1) {
      rows.push(...buildTakeRows(d, "22:00"));
      totalH += stdH;
      continue;
    }

    const needPmHours = Math.max(0, remaining - 3);
    const pmEndMin = 16 * 60 + Math.round(needPmHours * 60);
    const pmEnd = `${String(Math.floor(pmEndMin / 60)).padStart(2, "0")}:${String(pmEndMin % 60).padStart(2, "0")}`;
    rows.push(...buildTakeRows(d, pmEnd));
    totalH += workHoursForSegments([
      ["10:00", "13:00"],
      ["16:00", pmEnd],
    ]);
  }

  return { rows, totalTakeHours: Math.round(totalH * 10) / 10 };
}

function pickRyoTemplates(ryoDays, slotsNeeded) {
  if (!ryoDays.length) return [];
  const opts = RYO_TEMPLATES.map((t) => ({ template: t, slots: slotsForTemplate(t) })).sort(
    (a, b) => a.slots - b.slots,
  );

  const plan = ryoDays.map((date) => ({
    date,
    template: opts[0].template,
    slots: opts[0].slots,
    key: opts[0].template.key,
  }));

  let sum = plan.reduce((s, p) => s + p.slots, 0);

  let guard = 0;
  while (sum < slotsNeeded && guard++ < 500) {
    let upgraded = false;
    for (let i = 0; i < plan.length; i++) {
      for (const opt of opts) {
        if (opt.slots <= plan[i].slots) continue;
        const next = sum - plan[i].slots + opt.slots;
        if (next <= slotsNeeded) {
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

function buildRows(targetSlots) {
  const dates = allOctoberDates();
  const { takeDays, ryoDays } = assignTrainerDays(dates);

  const { rows: takeRows, totalTakeHours } = tuneTakeHours(takeDays);
  const takeSlots = countSlots(takeRows);
  const needRyoSlots = Math.max(0, targetSlots - takeSlots);

  const ryoPlan = pickRyoTemplates(ryoDays, needRyoSlots);
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
  const summary = summarize(plan.rows, plan, targetSlots, activeMembers);

  const ownerByDate = Object.fromEntries([
    ...plan.takeDays.map((d) => [d, TRAINER_TAKE]),
    ...plan.ryoDays.map((d) => [d, TRAINER_RYO]),
  ]);

  const calendar = allOctoberDates().map((date) => {
    const dayRows = plan.rows.filter((r) => r.shift_date === date);
    const trainer = ownerByDate[date] ?? null;
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
    ...summary,
    plan: {
      takeDays: plan.takeDays.length,
      ryoDays: plan.ryoDays.length,
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

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
