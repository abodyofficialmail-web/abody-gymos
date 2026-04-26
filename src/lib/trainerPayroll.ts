/** シフト1行（給与計算用。予約とは独立） */
export type PayrollShift = {
  shift_date: string;
  store_id?: string;
  start_local: string;
  end_local: string;
  break_minutes?: number | null;
  is_break?: boolean | null;
};

export function localTimeToMinutes(t: string): number {
  const m = String(t).trim().match(/^(\d{1,2}):(\d{2})/);
  if (!m) return NaN;
  return Number(m[1]) * 60 + Number(m[2]);
}

function nz(n: number | null | undefined): number {
  return Number.isFinite(Number(n)) ? Number(n) : 0;
}

function breakMinOf(s: PayrollShift): number {
  return Math.max(0, Math.round(Number((s as any).break_minutes ?? 0) || 0));
}

export type TrainerTransportCost = { store_id: string | null; cost: number | null };
export type TrainerExpense = { title?: string; amount: number | null; type: "monthly" | "daily" };
export type ShiftBreak = { id: string; shift_id: string; start_time: string; end_time: string };

function timeToMinutes(t: string): number {
  const m = String(t).trim().match(/^(\d{1,2}):(\d{2})/);
  if (!m) return NaN;
  return Number(m[1]) * 60 + Number(m[2]);
}

function breakMinutesFromRanges(breaks: ShiftBreak[]): number {
  let sum = 0;
  for (const b of breaks) {
    const a = timeToMinutes(b.start_time);
    const c = timeToMinutes(b.end_time);
    if (!Number.isFinite(a) || !Number.isFinite(c) || c <= a) continue;
    sum += c - a;
  }
  return sum;
}

function breakMinutesForShiftId(shiftId: string | undefined, breaksByShiftId?: Map<string, ShiftBreak[]>): number {
  if (!shiftId || !breaksByShiftId) return 0;
  return breakMinutesFromRanges(breaksByShiftId.get(shiftId) ?? []);
}

/**
 * 給与 = round(勤務時間×時給) + round(出勤日数×交通費) + round(定期代)
 * 勤務時間: is_break=true を除外。金額は各項を四五入してから合算。
 */
export function computeTrainerPayroll(
  shifts: PayrollShift[],
  hourlyRate: number | null | undefined,
  transportPerDay: number | null | undefined,
  monthlyPass: number | null | undefined
) {
  const hr = nz(hourlyRate);
  const tp = nz(transportPerDay);
  const mp = nz(monthlyPass);

  let totalMinutes = 0;
  for (const s of shifts) {
    if (s.is_break === true) continue;
    const a = localTimeToMinutes(s.start_local);
    const b = localTimeToMinutes(s.end_local);
    if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) continue;
    totalMinutes += b - a;
  }

  const uniqueDays = new Set(shifts.map((s) => s.shift_date)).size;
  const totalHours = totalMinutes / 60;

  const workYen = Math.round(totalHours * hr);
  const transportYen = Math.round(uniqueDays * tp);
  const passYen = Math.round(mp);
  const totalYen = workYen + transportYen + passYen;

  return {
    totalMinutes,
    totalHours,
    uniqueDays,
    workYen,
    transportYen,
    passYen,
    totalYen,
    hourlyRate: hr,
    transportPerDay: tp,
    monthlyPass: mp,
  };
}

/**
 * 給与 v2:
 * 勤務時間×時給 + 店舗別交通費 + 経費（月額 + 日割り） + 分割勤務ボーナス + 定期代
 *
 * - 交通費: (shift_date, store_id) のユニーク数 × cost
 * - 出勤日数: shift_date のユニーク数（経費(daily) 用）
 * - ボーナス: 同日でシフト2つ以上 かつ 間隔(前end→次start)が3時間以上なら、時給×1時間分（= hourly_rate）を支給（1日1回）
 * - break_minutes は差し引かない（給与対象）
 * - 金額は四五入で統一（Math.round）
 */
export function computeTrainerPayrollV2(args: {
  shifts: PayrollShift[];
  hourlyRate: number | null | undefined;
  monthlyPass: number | null | undefined;
  transportCosts: TrainerTransportCost[];
  expenses: TrainerExpense[];
  breaksByShiftId?: Map<string, ShiftBreak[]>;
}) {
  const hr = nz(args.hourlyRate);
  const mp = nz(args.monthlyPass);
  const nonBreak = (args.shifts ?? []).filter((s) => s.is_break !== true);

  let totalMinutes = 0;
  const uniqueDaysSet = new Set<string>();
  const storeDays = new Map<string, number>(); // key: `${date}|${storeId}` -> count
  const shiftsByDay = new Map<string, PayrollShift[]>();

  for (const s of nonBreak as (PayrollShift & { id?: string })[]) {
    uniqueDaysSet.add(s.shift_date);
    const a = localTimeToMinutes(s.start_local);
    const b = localTimeToMinutes(s.end_local);
    if (Number.isFinite(a) && Number.isFinite(b) && b > a) {
      const diffMinutes = b - a;
      // 休憩は給与計算から差し引かない（予約ブロック用）
      totalMinutes += Math.max(0, diffMinutes);
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

  const costByStore = new Map<string, number>();
  for (const row of args.transportCosts ?? []) {
    const sid = row.store_id ?? "";
    costByStore.set(sid, nz(row.cost));
  }
  let transportYen = 0;
  for (const [key] of storeDays) {
    const [, storeId] = key.split("|");
    transportYen += nz(costByStore.get(storeId));
  }
  transportYen = Math.round(transportYen);

  const dailyExpenseUnit = (args.expenses ?? [])
    .filter((e) => e.type === "daily")
    .reduce((sum, e) => sum + nz(e.amount), 0);
  const monthlyExpenseYen = (args.expenses ?? [])
    .filter((e) => e.type === "monthly")
    .reduce((sum, e) => sum + nz(e.amount), 0);

  const expensesDailyYen = Math.round(uniqueDays * dailyExpenseUnit);
  const expensesMonthlyYen = Math.round(monthlyExpenseYen);

  let bonusYen = 0;
  const bonusDays: string[] = [];
  for (const [day, list] of shiftsByDay) {
    if (list.length < 2) continue;
    const sorted = list
      .slice()
      .sort((a, b) => localTimeToMinutes(a.start_local) - localTimeToMinutes(b.start_local));
    let ok = false;
    for (let i = 0; i + 1 < sorted.length; i++) {
      const endA = localTimeToMinutes(sorted[i].end_local);
      const startB = localTimeToMinutes(sorted[i + 1].start_local);
      if (Number.isFinite(endA) && Number.isFinite(startB) && startB - endA >= 180) {
        ok = true;
        break;
      }
    }
    if (ok) {
      bonusYen += hr;
      bonusDays.push(day);
    }
  }
  bonusYen = Math.round(bonusYen);

  const passYen = Math.round(mp);
  const totalYen = workYen + transportYen + expensesMonthlyYen + expensesDailyYen + bonusYen + passYen;

  return {
    totalMinutes,
    totalHours,
    uniqueDays,
    workYen,
    transportYen,
    expensesYen: expensesMonthlyYen + expensesDailyYen,
    expensesMonthlyYen,
    expensesDailyYen,
    bonusYen,
    passYen,
    totalYen,
    hourlyRate: hr,
    monthlyPass: mp,
    bonusDays,
    dailyExpenseUnit,
  };
}

export function computeTrainerDayPayroll(args: {
  date: string;
  shifts: PayrollShift[];
  hourlyRate: number | null | undefined;
  transportCosts: TrainerTransportCost[];
  expenses: TrainerExpense[];
  breaksByShiftId?: Map<string, ShiftBreak[]>;
}) {
  const hr = nz(args.hourlyRate);
  const list = (args.shifts ?? []).filter((s) => s.shift_date === args.date && s.is_break !== true);

  let minutes = 0;
  let breakMinutesTotal = 0;
  const storeIds = new Set<string>();
  for (const s of list as (PayrollShift & { id?: string })[]) {
    const a = localTimeToMinutes(s.start_local);
    const b = localTimeToMinutes(s.end_local);
    if (Number.isFinite(a) && Number.isFinite(b) && b > a) {
      const diffMinutes = b - a;
      const breakMinutes = Math.max(0, breakMinOf(s) + breakMinutesForShiftId(s.id, args.breaksByShiftId));
      breakMinutesTotal += breakMinutes;
      // 休憩は給与計算から差し引かない（勤務時間＝シフト時間）
      minutes += Math.max(0, diffMinutes);
    }
    storeIds.add(s.store_id ?? "");
  }

  const hours = minutes / 60;
  const workYen = Math.round(hours * hr);

  const costByStore = new Map<string, number>();
  for (const row of args.transportCosts ?? []) costByStore.set(row.store_id ?? "", nz(row.cost));
  let transportYen = 0;
  for (const sid of storeIds) transportYen += nz(costByStore.get(sid));
  transportYen = Math.round(transportYen);

  // daily 経費は「1日あたり」の合計を当日分として表示
  const expenseDailyUnit = (args.expenses ?? [])
    .filter((e) => e.type === "daily")
    .reduce((sum, e) => sum + nz(e.amount), 0);
  const expenseDailyYen = Math.round(expenseDailyUnit);

  // ボーナス: 当日内で gap>=3h があれば時給1時間分
  let bonusYen = 0;
  if (list.length >= 2) {
    const sorted = list.slice().sort((a, b) => localTimeToMinutes(a.start_local) - localTimeToMinutes(b.start_local));
    for (let i = 0; i + 1 < sorted.length; i++) {
      const endA = localTimeToMinutes(sorted[i].end_local);
      const startB = localTimeToMinutes(sorted[i + 1].start_local);
      if (Number.isFinite(endA) && Number.isFinite(startB) && startB - endA >= 180) {
        bonusYen = hr;
        break;
      }
    }
  }

  const totalYen = workYen + transportYen + expenseDailyYen + bonusYen;

  return {
    minutes,
    hours,
    breakMinutes: breakMinutesTotal,
    workYen,
    transportYen,
    expenseDailyYen,
    bonusYen,
    totalYen,
    hourlyRate: hr,
    storeIds: Array.from(storeIds),
  };
}
