/**
 * 2026-09 人件費試算（scripts/sync-final-shifts-2026-09.mjs の buildRows ベース）
 *
 * 実行: node scripts/calc-payroll-2026-09.mjs
 * DB連携: node --env-file=.env.local scripts/calc-payroll-2026-09.mjs
 */
import { createClient } from "@supabase/supabase-js";
import { buildRows, TAKE_SAKURA_AM_OFF } from "./sync-final-shifts-2026-09.mjs";

const STORE_IDS = {
  恵比寿: "23adb524-ab25-41bb-a069-27d6b3ff51d8",
  上野: "b66af367-66b7-4021-8611-b145d4a47e3f",
  新宿: "b201686d-a2f5-4c7d-8c15-675c4a957860",
  桜木町: "457823a9-0c86-4431-930c-80baed05660e",
};

/** DB未接続時のフォールバック（本番 trainers テーブル値） */
const TRAINER_CONFIG = {
  ゆうと: {
    type: "契約社員",
    hourlyRate: 0,
    fixedMonthlyYen: 250_000,
    monthlyPass: 0,
    transportByStore: {},
    expenses: [],
  },
  たけはる: {
    type: "契約社員",
    hourlyRate: 0,
    fixedMonthlyYen: null, // 管理画面未設定 → 要確認
    monthlyPass: 0,
    transportByStore: {},
    expenses: [],
  },
  ひろむ: { type: "業務委託", hourlyRate: 1500, monthlyPass: 0, transportByStore: {}, expenses: [] },
  りょう: { type: "業務委託", hourlyRate: 1500, monthlyPass: 0, transportByStore: {}, expenses: [] },
  せいや: { type: "業務委託", hourlyRate: 1400, monthlyPass: 0, transportByStore: {}, expenses: [] },
  こうへい: { type: "業務委託", hourlyRate: 1300, monthlyPass: 0, transportByStore: {}, expenses: [] },
};

function localTimeToMinutes(t) {
  const m = String(t).trim().match(/^(\d{1,2}):(\d{2})/);
  if (!m) return NaN;
  return Number(m[1]) * 60 + Number(m[2]);
}

function computeTrainerPayrollV2(args) {
  const hr = Number.isFinite(Number(args.hourlyRate)) ? Number(args.hourlyRate) : 0;
  const mp = Number.isFinite(Number(args.monthlyPass)) ? Number(args.monthlyPass) : 0;
  const nonBreak = (args.shifts ?? []).filter((s) => s.is_break !== true);

  let totalMinutes = 0;
  const uniqueDaysSet = new Set();
  const storeDays = new Map();
  const shiftsByDay = new Map();

  for (const s of nonBreak) {
    uniqueDaysSet.add(s.shift_date);
    const a = localTimeToMinutes(s.start_local);
    const b = localTimeToMinutes(s.end_local);
    if (Number.isFinite(a) && Number.isFinite(b) && b > a) {
      totalMinutes += b - a;
    }
    const storeId = s.store_id ?? "";
    const key = `${s.shift_date}|${storeId}`;
    storeDays.set(key, (storeDays.get(key) ?? 0) + 1);
    const arr = shiftsByDay.get(s.shift_date) ?? [];
    arr.push(s);
    shiftsByDay.set(s.shift_date, arr);
  }

  const uniqueDays = uniqueDaysSet.size;
  const totalHours = totalMinutes / 60;
  const workYen = Math.round(totalHours * hr);

  const costByStore = args.transportCosts ?? {};
  let transportYen = 0;
  for (const [key] of storeDays) {
    const [, storeId] = key.split("|");
    transportYen += Number(costByStore[storeId] ?? 0);
  }
  transportYen = Math.round(transportYen);

  const dailyExpenseUnit = (args.expenses ?? [])
    .filter((e) => e.type === "daily")
    .reduce((sum, e) => sum + Number(e.amount ?? 0), 0);
  const monthlyExpenseYen = (args.expenses ?? [])
    .filter((e) => e.type === "monthly")
    .reduce((sum, e) => sum + Number(e.amount ?? 0), 0);

  const expensesDailyYen = Math.round(uniqueDays * dailyExpenseUnit);
  const expensesMonthlyYen = Math.round(monthlyExpenseYen);

  let bonusYen = 0;
  const bonusDays = [];
  for (const [day, list] of shiftsByDay) {
    if (list.length < 2) continue;
    const sorted = list.slice().sort((a, b) => localTimeToMinutes(a.start_local) - localTimeToMinutes(b.start_local));
    for (let i = 0; i + 1 < sorted.length; i++) {
      const endA = localTimeToMinutes(sorted[i].end_local);
      const startB = localTimeToMinutes(sorted[i + 1].start_local);
      if (Number.isFinite(endA) && Number.isFinite(startB) && startB - endA >= 180) {
        bonusYen += hr;
        bonusDays.push(day);
        break;
      }
    }
  }
  bonusYen = Math.round(bonusYen);

  const passYen = Math.round(mp);
  const totalYen = workYen + transportYen + expensesMonthlyYen + expensesDailyYen + bonusYen + passYen;

  return {
    totalHours,
    uniqueDays,
    workYen,
    transportYen,
    expensesYen: expensesMonthlyYen + expensesDailyYen,
    bonusYen,
    passYen,
    totalYen,
    bonusDays,
  };
}

function takeharuPmOnlyBonusDays(shifts) {
  return shifts.filter((s) => TAKE_SAKURA_AM_OFF.has(s.shift_date)).map((s) => s.shift_date);
}

async function loadDbOverrides() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return { source: "fallback" };

  const supabase = createClient(url, key, { auth: { persistSession: false } });
  const names = Object.keys(TRAINER_CONFIG);
  const { data: trainers } = await supabase
    .from("trainers")
    .select("id, display_name, hourly_rate, monthly_pass_cost")
    .in("display_name", names);
  const { data: stores } = await supabase.from("stores").select("id, name").in("name", Object.keys(STORE_IDS));
  const storeIdByName = Object.fromEntries((stores ?? []).map((s) => [s.name, s.id]));
  const trainerIdByName = Object.fromEntries((trainers ?? []).map((t) => [t.display_name, t.id]));

  const transportDump = {};

  for (const t of trainers ?? []) {
    const cfg = TRAINER_CONFIG[t.display_name];
    if (!cfg) continue;
    cfg.hourlyRate = Number(t.hourly_rate ?? cfg.hourlyRate);
    cfg.monthlyPass = Number(t.monthly_pass_cost ?? 0);
  }

  for (const name of names) {
    const tid = trainerIdByName[name];
    if (!tid) continue;
    const { data: tc } = await supabase.from("trainer_transport_costs").select("store_id, cost").eq("trainer_id", tid);
    TRAINER_CONFIG[name].transportByStore = {};
    for (const row of tc ?? []) {
      TRAINER_CONFIG[name].transportByStore[row.store_id] = Number(row.cost ?? 0);
    }
    transportDump[name] = (tc ?? []).map((row) => ({
      store: Object.entries(storeIdByName).find(([, id]) => id === row.store_id)?.[0] ?? row.store_id,
      cost: Number(row.cost ?? 0),
    }));
    const { data: ex } = await supabase.from("trainer_expenses").select("title, amount, type").eq("trainer_id", tid);
    const monthlyFixed = (ex ?? []).find((e) => e.type === "monthly" && Number(e.amount) > 0);
    if (monthlyFixed && TRAINER_CONFIG[name].type === "契約社員") {
      // 契約社員の月額固定給は trainer_expenses(monthly) が正本。二重計上を避ける。
      TRAINER_CONFIG[name].fixedMonthlyYen = Number(monthlyFixed.amount);
      TRAINER_CONFIG[name].expenses = (ex ?? []).filter((e) => e.type !== "monthly");
    } else {
      TRAINER_CONFIG[name].expenses = ex ?? [];
    }
  }

  return { source: "db", storeIdByName, trainerIdByName, transportDump };
}

function storeNameById() {
  return Object.fromEntries(Object.entries(STORE_IDS).map(([n, id]) => [id, n]));
}

function rowsForTrainer(allRows, name) {
  return allRows
    .filter((r) => r.trainer_name === name)
    .map((r) => ({
      shift_date: r.shift_date,
      store_id: STORE_IDS[r.store_name],
      start_local: r.start_local,
      end_local: r.end_local,
      is_break: false,
    }));
}

async function main() {
  const meta = await loadDbOverrides();
  const allRows = buildRows();
  const nameById = storeNameById();
  const targetNames = ["ゆうと", "たけはる", "ひろむ", "りょう", "せいや", "こうへい"];
  const results = [];

  for (const name of targetNames) {
    const cfg = TRAINER_CONFIG[name];
    const shifts = rowsForTrainer(allRows, name);
    const transportCosts = cfg.transportByStore;

    const payroll = computeTrainerPayrollV2({
      shifts,
      hourlyRate: cfg.hourlyRate,
      monthlyPass: cfg.monthlyPass,
      transportCosts,
      expenses: cfg.expenses,
    });

    let fixedYen = 0;
    let extraBonusYen = 0;
    let extraBonusNote = null;

    if (cfg.type === "契約社員") {
      fixedYen = cfg.fixedMonthlyYen ?? 0;
      payroll.workYen = fixedYen;
      payroll.bonusYen = 0;
    } else if (name === "たけはる") {
      // no-op
    }

    if (name === "たけはる") {
      const pmDays = [...new Set(takeharuPmOnlyBonusDays(shifts))];
      extraBonusYen = pmDays.length * (cfg.hourlyRate || 0);
      if (cfg.type === "契約社員" && !cfg.fixedMonthlyYen) {
        extraBonusNote = `PMのみ桜木町 ${pmDays.length}日（+${pmDays.length}h換算・契約給与額は要確認）`;
      }
    }

    // 契約社員: 月額固定給 + 交通費 + 日次経費のみ + 定期代（月額経費は固定給に含む）
    const contractExpensesYen =
      cfg.type === "契約社員"
        ? Math.round(
            payroll.uniqueDays *
              (cfg.expenses ?? []).filter((e) => e.type === "daily").reduce((s, e) => s + Number(e.amount ?? 0), 0),
          )
        : payroll.expensesYen;

    const totalYen =
      cfg.type === "契約社員"
        ? fixedYen + payroll.transportYen + contractExpensesYen + payroll.passYen
        : payroll.totalYen + extraBonusYen;

    const storeVisits = {};
    for (const s of shifts) {
      const sn = nameById[s.store_id] ?? s.store_id;
      const k = `${s.shift_date}|${sn}`;
      storeVisits[k] = (cfg.transportByStore[s.store_id] ?? 0);
    }
    const transportBreakdown = {};
    for (const [k, cost] of Object.entries(storeVisits)) {
      const store = k.split("|")[1];
      transportBreakdown[store] = (transportBreakdown[store] ?? 0) + cost;
    }

    results.push({
      name,
      type: cfg.type,
      days: payroll.uniqueDays,
      hours: Math.round(payroll.totalHours * 10) / 10,
      hourlyRate: cfg.hourlyRate,
      fixedMonthlyYen: cfg.fixedMonthlyYen,
      workYen: cfg.type === "契約社員" ? fixedYen : payroll.workYen,
      transportYen: payroll.transportYen,
      transportBreakdown,
      transportRates: meta.transportDump?.[name] ?? [],
      expensesYen: cfg.type === "契約社員" ? contractExpensesYen : payroll.expensesYen,
      bonusYen: cfg.type === "契約社員" ? 0 : payroll.bonusYen,
      bonusDays: cfg.type === "契約社員" ? [] : payroll.bonusDays,
      passYen: payroll.passYen,
      extraBonusYen,
      extraBonusNote,
      totalYen,
    });
  }

  const grandTotal = results.reduce((s, r) => s + r.totalYen, 0);
  console.log(
    JSON.stringify(
      {
        month: "2026-09",
        configSource: meta.source,
        transportConfig: meta.transportDump ?? null,
        note:
          meta.source === "fallback"
            ? "交通費・経費・定期代はDB未接続のため0。本番は node --env-file=.env.local で再実行してください。"
            : "DBの trainer_transport_costs / trainer_expenses を反映",
        trainers: results,
        grandTotal,
        capReference: 1_150_000,
        overCap: grandTotal > 1_150_000,
      },
      null,
      2,
    ),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
