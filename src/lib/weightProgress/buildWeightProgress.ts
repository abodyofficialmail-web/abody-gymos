import { parseMenu } from "@/lib/monthlyProgressReport/parseMenu";
import type { WeightProgressRow } from "@/lib/monthlyProgressReport/types";
import { predictNextMax, type WeightPredictSex } from "./predictNextMax";

export type WeightProgressNote = { date: string; content: string };

export type WeightProgressProfile = {
  sex: WeightPredictSex;
  bodyWeightKg: number | null;
  heightCm: number | null;
  ageYears: number | null;
};

export type WeightProgressBundle = {
  yearMonth: string;
  prevYearMonth: string;
  nextMonthLabel: string;
  yearMonthLabel: string;
  profile: WeightProgressProfile;
  rows: WeightProgressRow[];
  /** LLMコメントの状態: ready=キャッシュあり / pending=未生成 or 一部のみ */
  aiCommentStatus?: "ready" | "pending" | "partial";
};

function shiftYm(yearMonth: string, delta: number): string {
  const [y, m] = yearMonth.split("-").map(Number);
  const d = new Date(y!, m! - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function ymLabel(yearMonth: string): string {
  const [y, m] = yearMonth.split("-").map(Number);
  return `${y}年${m}月`;
}

export function nextMonthLabelOf(yearMonth: string): string {
  const [y, m] = yearMonth.split("-").map(Number);
  const next = m === 12 ? 1 : m! + 1;
  return `${next}月`;
}

/** YYYY-MM → 「8月」 */
export function monthOnlyLabel(yearMonth: string): string {
  const m = Number(yearMonth.split("-")[1]);
  return `${m}月`;
}

export function resolveAgeYears(params: {
  ageYears?: number | null;
  birthDate?: string | null;
  asOf?: Date;
}): number | null {
  if (params.ageYears != null && Number.isFinite(params.ageYears) && params.ageYears > 0) {
    return Math.round(Number(params.ageYears));
  }
  if (!params.birthDate) return null;
  const d = new Date(`${params.birthDate}T00:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  const asOf = params.asOf ?? new Date();
  let age = asOf.getFullYear() - d.getFullYear();
  const m = asOf.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && asOf.getDate() < d.getDate())) age -= 1;
  return age > 0 && age < 120 ? age : null;
}

/** カルテ本文から体重(kg)を抽出（最新優先で呼び出し側が並べ替え） */
export function parseBodyWeightFromContent(content: string): number | null {
  const m =
    String(content || "").match(/体重\s*\(kg\)\s*[:：]\s*(\d+(?:\.\d+)?)/i) ||
    String(content || "").match(/体重\s*[:：]\s*(\d+(?:\.\d+)?)\s*kg/i);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) && n > 0 && n < 300 ? n : null;
}

export function resolveBodyWeightKg(
  notes: WeightProgressNote[],
  hearingWeight: number | null | undefined
): number | null {
  if (hearingWeight != null && Number.isFinite(hearingWeight) && hearingWeight > 0) {
    return Math.round(Number(hearingWeight) * 10) / 10;
  }
  const sorted = [...notes].sort((a, b) => b.date.localeCompare(a.date));
  for (const n of sorted) {
    const w = parseBodyWeightFromContent(n.content);
    if (w != null) return w;
  }
  return null;
}

/**
 * 当月にデータが無い場合は、直近で種目記録がある月を基準月にする。
 */
export function resolveReferenceYearMonth(notes: WeightProgressNote[], preferredYm: string): string {
  const hasPreferred = notes.some(
    (n) => n.date.startsWith(preferredYm) && parseMenu(n.content).some((ex) => ex.sets.some((kg) => kg > 0))
  );
  if (hasPreferred) return preferredYm;

  const months = new Set<string>();
  for (const n of notes) {
    if (parseMenu(n.content).some((ex) => ex.sets.some((kg) => kg > 0))) {
      months.add(n.date.slice(0, 7));
    }
  }
  const sorted = [...months].sort();
  return sorted[sorted.length - 1] || preferredYm;
}

export function commentSourceHash(params: {
  exercise: string;
  nextTarget: number;
  monthMax: number;
  prevMonthMax: number | null;
  nextReason: string;
  sex: WeightPredictSex;
  bodyWeightKg: number | null;
  heightCm: number | null;
  ageYears: number | null;
}): string {
  return [
    params.exercise,
    params.nextTarget,
    params.monthMax,
    params.prevMonthMax ?? "",
    params.nextReason,
    params.sex ?? "",
    params.bodyWeightKg ?? "",
    params.heightCm ?? "",
    params.ageYears ?? "",
  ].join("|");
}

/**
 * 種目別の初回/先月/今月マックスと、ルール推定の来月目標を構築する。
 */
export function buildWeightProgressRows(
  notes: WeightProgressNote[],
  yearMonth: string,
  profile: WeightProgressProfile
): WeightProgressRow[] {
  const prevYm = shiftYm(yearMonth, -1);
  const sorted = [...notes].sort((a, b) => a.date.localeCompare(b.date) || a.content.localeCompare(b.content));

  type Acc = {
    exercise: string;
    firstMax: number;
    firstDate: string;
    prevMonthMax: number | null;
    monthMax: number | null;
    julySets: number;
    monthlyMaxes: Map<string, number>;
  };
  const map = new Map<string, Acc>();

  for (const n of sorted) {
    const ym = n.date.slice(0, 7);
    const isMonth = ym === yearMonth;
    const isPrev = ym === prevYm;
    for (const ex of parseMenu(n.content)) {
      const kgs = ex.sets.filter((x) => x > 0);
      if (!kgs.length) continue;
      const maxKg = Math.max(...kgs);
      if (!map.has(ex.name)) {
        map.set(ex.name, {
          exercise: ex.name,
          firstMax: maxKg,
          firstDate: n.date,
          prevMonthMax: null,
          monthMax: null,
          julySets: 0,
          monthlyMaxes: new Map(),
        });
      }
      const p = map.get(ex.name)!;
      if (isPrev) p.prevMonthMax = Math.max(p.prevMonthMax || 0, maxKg);
      if (isMonth) {
        p.monthMax = Math.max(p.monthMax || 0, maxKg);
        p.julySets += ex.sets.length;
      }
      p.monthlyMaxes.set(ym, Math.max(p.monthlyMaxes.get(ym) || 0, maxKg));
    }
  }

  const lookback = [yearMonth, prevYm, shiftYm(yearMonth, -2)];
  return [...map.values()]
    .filter((p) => {
      if (p.monthMax != null) return true;
      return lookback.some((ym) => p.monthlyMaxes.has(ym));
    })
    .map((p) => {
      const baseline = p.monthMax ?? p.prevMonthMax ?? p.firstMax;
      const monthMax = p.monthMax ?? baseline;
      const vsFirst = Math.round((monthMax - p.firstMax) * 10) / 10;
      const vsPrev =
        p.prevMonthMax != null ? Math.round((monthMax - p.prevMonthMax) * 10) / 10 : null;
      const growthPct =
        p.firstMax > 0 ? Math.round(((monthMax - p.firstMax) / p.firstMax) * 1000) / 10 : 0;
      const vsPrevPct =
        p.prevMonthMax != null && p.prevMonthMax > 0
          ? Math.round(((monthMax - p.prevMonthMax) / p.prevMonthMax) * 1000) / 10
          : null;

      const monthlyChrono = [...p.monthlyMaxes.entries()]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .filter(([ym]) => ym <= yearMonth)
        .slice(-6)
        .map(([, kg]) => kg);

      // 今月目標: 今月未実施なら先月最高、実施済みなら今月最高を基準に月末目標を推定
      const baselineForGoal = p.monthMax ?? p.prevMonthMax ?? p.firstMax;
      const pred = predictNextMax({
        exercise: p.exercise,
        firstMax: p.firstMax,
        monthMax: baselineForGoal,
        prevMonthMax: p.prevMonthMax,
        monthlyMaxes: monthlyChrono,
        setsThisMonth: p.julySets,
        sex: profile.sex,
        bodyWeightKg: profile.bodyWeightKg,
        heightCm: profile.heightCm,
        ageYears: profile.ageYears,
      });

      // すでに今月の実績がある場合、目標は実績未満にしない
      const nextTarget =
        p.monthMax != null ? Math.max(pred.nextTarget, p.monthMax) : pred.nextTarget;
      const nextDelta = Math.round((nextTarget - baselineForGoal) * 10) / 10;
      const nextGrowthPct =
        baselineForGoal > 0 ? Math.round((nextDelta / baselineForGoal) * 1000) / 10 : 0;

      return {
        exercise: p.exercise,
        firstMax: p.firstMax,
        firstDate: p.firstDate,
        prevMonthMax: p.prevMonthMax,
        monthMax: p.monthMax ?? monthMax,
        vsPrev,
        vsFirst,
        growthPct,
        vsPrevPct,
        julySets: p.julySets,
        nextTarget,
        nextDelta,
        nextGrowthPct,
        nextReason: pred.reason,
        hasCurrentMonth: p.monthMax != null,
      } satisfies WeightProgressRow;
    })
    .sort((a, b) => {
      const ac = a.hasCurrentMonth ? 1 : 0;
      const bc = b.hasCurrentMonth ? 1 : 0;
      if (bc !== ac) return bc - ac;
      return b.vsFirst - a.vsFirst || b.julySets - a.julySets;
    });
}

export function buildWeightProgressBundle(params: {
  notes: WeightProgressNote[];
  preferredYearMonth: string;
  sex: WeightPredictSex;
  hearingWeightKg?: number | null;
  heightCm?: number | null;
  ageYears?: number | null;
  birthDate?: string | null;
}): WeightProgressBundle {
  // 表示・目標月は常に「いまの年月」（人によって6月基準→7月目標、にならないようにする）
  const yearMonth = params.preferredYearMonth;
  const bodyWeightKg = resolveBodyWeightKg(params.notes, params.hearingWeightKg);
  const ageYears =
    params.ageYears != null
      ? params.ageYears
      : resolveAgeYears({ ageYears: params.ageYears, birthDate: params.birthDate });
  const profile: WeightProgressProfile = {
    sex: params.sex,
    bodyWeightKg,
    heightCm: params.heightCm != null && params.heightCm > 0 ? Number(params.heightCm) : null,
    ageYears,
  };
  const rows = buildWeightProgressRows(params.notes, yearMonth, profile);
  return {
    yearMonth,
    prevYearMonth: shiftYm(yearMonth, -1),
    // 右列は「今月の目標」（例: 8月目標）
    nextMonthLabel: monthOnlyLabel(yearMonth),
    yearMonthLabel: ymLabel(yearMonth),
    profile,
    rows,
    aiCommentStatus: "pending",
  };
}
