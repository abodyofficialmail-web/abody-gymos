/**
 * 月次人件費集計（DBの trainer_shifts ベース）
 *
 * 実行: node scripts/calc-payroll-month.mjs 2026-08
 * DB:   node --env-file=.env.local scripts/calc-payroll-month.mjs 2026-08
 */
import { createClient } from "@supabase/supabase-js";

/** 雇用区分の手動 override（DBだけでは判別できない場合） */
const CONTRACT_NAMES = new Set(["ゆうと", "たけはる"]);

function monthEndDay(month) {
  const [y, m] = month.split("-").map(Number);
  return new Date(y, m, 0).getDate();
}

function localTimeToMinutes(t) {
  const match = String(t).trim().match(/^(\d{1,2}):(\d{2})/);
  if (!match) return NaN;
  return Number(match[1]) * 60 + Number(match[2]);
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

function isContractEmployee(name, hourlyRate, monthlyExpenses) {
  if (CONTRACT_NAMES.has(name)) return true;
  const monthlyFixed = (monthlyExpenses ?? []).find((e) => e.type === "monthly" && Number(e.amount) > 0);
  return Number(hourlyRate) === 0 && !!monthlyFixed;
}

async function main() {
  const month = process.argv[2] ?? "2026-08";
  const lastDay = monthEndDay(month);

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("DB未接続。node --env-file=.env.local scripts/calc-payroll-month.mjs で実行してください。");
    process.exit(1);
  }

  const supabase = createClient(url, key, { auth: { persistSession: false } });

  const { data: shifts, error: shiftErr } = await supabase
    .from("trainer_shifts")
    .select("shift_date,start_local,end_local,store_id,trainer_id,status,is_break")
    .gte("shift_date", `${month}-01`)
    .lte("shift_date", `${month}-${String(lastDay).padStart(2, "0")}`)
    .neq("status", "draft")
    .eq("is_break", false);

  if (shiftErr) throw shiftErr;

  const trainerIds = [...new Set((shifts ?? []).map((s) => s.trainer_id).filter(Boolean))];
  if (trainerIds.length === 0) {
    console.log(JSON.stringify({ month, error: "該当月のシフトがありません" }, null, 2));
    return;
  }

  const { data: trainers } = await supabase
    .from("trainers")
    .select("id, display_name, hourly_rate, monthly_pass_cost")
    .in("id", trainerIds);

  const { data: stores } = await supabase.from("stores").select("id, name");
  const storeNameById = Object.fromEntries((stores ?? []).map((s) => [s.id, s.name]));

  const trainerById = Object.fromEntries((trainers ?? []).map((t) => [t.id, t]));
  const shiftsByTrainer = new Map();
  for (const s of shifts ?? []) {
    const arr = shiftsByTrainer.get(s.trainer_id) ?? [];
    arr.push(s);
    shiftsByTrainer.set(s.trainer_id, arr);
  }

  const results = [];

  for (const tid of trainerIds.sort()) {
    const trainer = trainerById[tid];
    if (!trainer) continue;
    const name = trainer.display_name;

    const { data: tc } = await supabase.from("trainer_transport_costs").select("store_id, cost").eq("trainer_id", tid);
    const transportByStore = {};
    for (const row of tc ?? []) {
      transportByStore[row.store_id] = Number(row.cost ?? 0);
    }

    const { data: ex } = await supabase.from("trainer_expenses").select("title, amount, type").eq("trainer_id", tid);
    const contract = isContractEmployee(name, trainer.hourly_rate, ex);
    const monthlyFixed = (ex ?? []).find((e) => e.type === "monthly" && Number(e.amount) > 0);

    let fixedMonthlyYen = null;
    let expenses = ex ?? [];
    if (contract && monthlyFixed) {
      fixedMonthlyYen = Number(monthlyFixed.amount);
      expenses = (ex ?? []).filter((e) => e.type !== "monthly");
    }

    const payroll = computeTrainerPayrollV2({
      shifts: shiftsByTrainer.get(tid) ?? [],
      hourlyRate: trainer.hourly_rate,
      monthlyPass: trainer.monthly_pass_cost,
      transportCosts: transportByStore,
      expenses,
    });

    let workYen = payroll.workYen;
    let bonusYen = payroll.bonusYen;
    if (contract) {
      workYen = fixedMonthlyYen ?? 0;
      bonusYen = 0;
    }

    const contractExpensesYen = contract
      ? Math.round(
          payroll.uniqueDays *
            expenses.filter((e) => e.type === "daily").reduce((s, e) => s + Number(e.amount ?? 0), 0),
        )
      : payroll.expensesYen;

    const totalYen = contract
      ? workYen + payroll.transportYen + contractExpensesYen + payroll.passYen
      : payroll.totalYen;

    const transportBreakdown = {};
    for (const s of shiftsByTrainer.get(tid) ?? []) {
      const sn = storeNameById[s.store_id] ?? s.store_id;
      transportBreakdown[sn] = (transportBreakdown[sn] ?? 0) + (transportByStore[s.store_id] ?? 0);
    }

    results.push({
      name,
      type: contract ? "契約社員" : "業務委託",
      days: payroll.uniqueDays,
      hours: Math.round(payroll.totalHours * 10) / 10,
      hourlyRate: Number(trainer.hourly_rate ?? 0),
      workYen,
      transportYen: payroll.transportYen,
      transportBreakdown,
      expensesYen: contract ? contractExpensesYen : payroll.expensesYen,
      bonusYen,
      passYen: payroll.passYen,
      totalYen,
    });
  }

  results.sort((a, b) => b.totalYen - a.totalYen);

  const sum = (key) => results.reduce((s, r) => s + r[key], 0);
  const laborYen = sum("workYen");
  const transportYen = sum("transportYen");
  const expensesYen = sum("expensesYen");
  const bonusYen = sum("bonusYen");
  const passYen = sum("passYen");
  const grandTotal = sum("totalYen");

  // 人件費 = 基本給（時給×時間 or 固定月給）
  // 全体の支払 = 基本給 + 交通費 + 経費 + 中抜け + 定期代
  const nonLaborYen = transportYen + expensesYen + bonusYen + passYen;

  console.log(
    JSON.stringify(
      {
        month,
        trainerCount: results.length,
        trainers: results,
        summary: {
          laborYen,
          transportYen,
          expensesYen,
          bonusYen,
          passYen,
          nonLaborYen,
          grandTotal,
          laborShareOfPayrollPct: grandTotal ? Math.round((laborYen / grandTotal) * 1000) / 10 : 0,
          nonLaborShareOfPayrollPct: grandTotal ? Math.round((nonLaborYen / grandTotal) * 1000) / 10 : 0,
        },
        capReference: 1_150_000,
        overCap: grandTotal > 1_150_000,
        note: "人件費=基本給(workYen)。全体=基本給+交通費+経費+中抜け+定期代。店舗運営費(家賃等)は本システム未管理。",
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
