import type { MemberWeightLogStats } from "../memberWeightLogs";

export const KCAL_PER_KG = 7700;

export type WeightOutlookPoint = {
  label: string;
  months: 0 | 1 | 3 | 6;
  kg: number;
  delta_kg: number;
};

export type WeightOutlook = {
  current_kg: number;
  monthly_kg: number;
  source: "weight" | "meals" | "target" | "pending";
  note: string;
  points: WeightOutlookPoint[];
};

function round1(n: number) {
  return Math.round(n * 10) / 10;
}

function clampMonthly(rate: number, currentKg: number) {
  const maxLoss = Math.min(3.5, round1(currentKg * 0.04));
  const maxGain = 2.5;
  return Math.max(-maxLoss, Math.min(maxGain, rate));
}

function monthlyFromWeekly(change7dKg: number) {
  return change7dKg * (30 / 7);
}

function monthlyFromDeficit(dailyKcal: number) {
  return (dailyKcal * 30) / KCAL_PER_KG;
}

export function buildWeightOutlook(params: {
  stats: Pick<MemberWeightLogStats, "latest_kg" | "change_7d_kg" | "logged_days_30">;
  tdee?: number | null;
  intakeTarget?: number | null;
  recentKcalAvg?: number | null;
}): WeightOutlook | null {
  const current = params.stats.latest_kg;
  if (current == null || current < 15) return null;

  let monthly = 0;
  let source: WeightOutlook["source"] = "pending";
  let note = "数日体重を記録するか、食事を続けると、1〜6ヶ月の見通しが傾き始めます。";

  if (params.stats.change_7d_kg != null && params.stats.logged_days_30 >= 4) {
    monthly = monthlyFromWeekly(params.stats.change_7d_kg);
    source = "weight";
    note = "直近7日の体重変化をこの調子で続けた場合の目安です。水分で前後します。";
  } else if (
    params.tdee != null &&
    params.tdee > 0 &&
    params.recentKcalAvg != null &&
    params.recentKcalAvg > 0
  ) {
    monthly = monthlyFromDeficit(params.recentKcalAvg - params.tdee);
    source = "meals";
    note = "直近の食事記録と1日の消費カロリーから推計しています。";
  } else if (params.tdee != null && params.tdee > 0 && params.intakeTarget != null && params.intakeTarget > 0) {
    monthly = monthlyFromDeficit(params.intakeTarget - params.tdee);
    source = "target";
    note = "目標どおり食べ続けた場合の目安です。体重を数日記録すると、実測ペースに切り替わります。";
  }

  monthly = round1(clampMonthly(monthly, current));
  const floor = Math.max(40, round1(current * 0.72));
  const points: WeightOutlookPoint[] = ([0, 1, 3, 6] as const).map((months) => {
    const raw = current + monthly * months;
    const kg = round1(Math.max(floor, raw));
    return {
      label: months === 0 ? "今" : `${months}ヶ月`,
      months,
      kg,
      delta_kg: round1(kg - current),
    };
  });

  return { current_kg: round1(current), monthly_kg: monthly, source, note, points };
}
