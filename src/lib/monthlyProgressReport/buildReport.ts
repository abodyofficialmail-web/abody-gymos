import type { MonthlyProgressReport, PartRatio, WeightProgressRow } from "./types";

export function parseMenu(content: string): { name: string; sets: number[] }[] {
  const exercises: { name: string; sets: number[] }[] = [];
  let cur: { name: string; sets: number[] } | null = null;
  for (const line of String(content || "").split("\n")) {
    const em = line.match(/^■\s*(.+)$/);
    if (em) {
      cur = { name: em[1].trim(), sets: [] };
      exercises.push(cur);
      continue;
    }
    if (!cur) continue;
    const sm = line.match(/(\d+(?:\.\d+)?)\s*kg/);
    if (sm) cur.sets.push(Number(sm[1]));
  }
  return exercises.filter((e) => e.name && e.name !== "その他");
}

export function parseFeedback(content: string): string {
  const lines = String(content || "").split("\n");
  const i = lines.findIndex((l) => l.includes("【トレーナーからのフィードバック】"));
  if (i < 0) return "";
  const out: string[] = [];
  for (let j = i + 1; j < lines.length; j++) {
    if (lines[j].startsWith("【")) break;
    if (lines[j].trim()) out.push(lines[j].trim());
  }
  return out.join(" ").trim();
}

export function parseParts(content: string): string[] {
  const m = String(content || "").match(/部位:\s*(.+)/);
  if (!m) return [];
  return m[1]
    .split(/\s*\/\s*/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function tenureMonths(joinedAt: string, asOf: string): number {
  const a = new Date(joinedAt);
  const b = new Date(asOf);
  const months = (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());
  return Math.max(1, months + (b.getDate() >= a.getDate() ? 0 : -1) || 1);
}

export function ymParts(yearMonth: string) {
  const [y, m] = yearMonth.split("-").map(Number);
  const label = `${y}年${m}月`;
  const nextM = m === 12 ? 1 : m + 1;
  const nextY = m === 12 ? y + 1 : y;
  const prevM = m === 1 ? 12 : m - 1;
  const prevY = m === 1 ? y - 1 : y;
  const prev = `${prevY}-${String(prevM).padStart(2, "0")}`;
  const nextLabel = `${nextM}月`;
  const monthStartLocal = `${yearMonth}-01`;
  const lastDay = new Date(y, m, 0).getDate();
  const monthEndLocal = `${yearMonth}-${String(lastDay).padStart(2, "0")}`;
  // JST bounds as UTC
  const startAt = new Date(Date.UTC(y, m - 1, 1, -9, 0, 0)).toISOString();
  const endAt = new Date(Date.UTC(y, m, 1, -9, 0, 0)).toISOString();
  return { y, m, label, nextLabel, prev, monthStartLocal, monthEndLocal, startAt, endAt };
}

type Note = { date: string; content: string; trainer_id?: string | null };
type Reservation = { start_at: string; end_at: string; trainer_id?: string | null; status?: string };
type Survey = { rating: number | null; session_date?: string | null };

export function buildWeightRows(notes: Note[], yearMonth: string, prevYm: string): WeightProgressRow[] {
  type Acc = {
    exercise: string;
    firstMax: number;
    firstDate: string;
    prevMonthMax: number | null;
    monthMax: number | null;
    julySets: number;
  };
  const map = new Map<string, Acc>();
  for (const n of notes) {
    const isMonth = n.date.startsWith(yearMonth);
    const isPrev = n.date.startsWith(prevYm);
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
        });
      }
      const p = map.get(ex.name)!;
      if (isPrev) p.prevMonthMax = Math.max(p.prevMonthMax || 0, maxKg);
      if (isMonth) {
        p.monthMax = Math.max(p.monthMax || 0, maxKg);
        p.julySets += ex.sets.length;
      }
    }
  }
  return [...map.values()]
    .filter((p) => p.monthMax != null)
    .map((p) => {
      const monthMax = p.monthMax!;
      const vsFirst = Math.round((monthMax - p.firstMax) * 10) / 10;
      const vsPrev =
        p.prevMonthMax != null ? Math.round((monthMax - p.prevMonthMax) * 10) / 10 : null;
      const growthPct =
        p.firstMax > 0 ? Math.round(((monthMax - p.firstMax) / p.firstMax) * 1000) / 10 : 0;
      return {
        exercise: p.exercise,
        firstMax: p.firstMax,
        firstDate: p.firstDate,
        prevMonthMax: p.prevMonthMax,
        monthMax,
        vsPrev,
        vsFirst,
        growthPct,
        julySets: p.julySets,
      };
    })
    .sort((a, b) => b.vsFirst - a.vsFirst || b.julySets - a.julySets);
}

export function buildPartRatios(notes: Note[], yearMonth: string): PartRatio[] {
  const counts = new Map<string, number>();
  for (const n of notes.filter((x) => x.date.startsWith(yearMonth))) {
    const parts = parseParts(n.content);
    if (!parts.length) counts.set("その他", (counts.get("その他") || 0) + 1);
    for (const part of parts) counts.set(part, (counts.get(part) || 0) + 1);
    if (/【ストレッチ】\s*\n?\s*あり/.test(n.content) || /\nあり\n/.test(n.content.split("【ストレッチ】")[1] || "")) {
      // light stretch signal from structured notes
    }
  }
  const total = [...counts.values()].reduce((a, b) => a + b, 0) || 1;
  return [...counts.entries()]
    .map(([part, count]) => ({ part, count, pct: Math.round((count / total) * 1000) / 10 }))
    .sort((a, b) => b.count - a.count);
}

export function buildVolumeTrend(notes: Note[], yearMonth: string) {
  const [y, m] = yearMonth.split("-").map(Number);
  const months: string[] = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(y, m - 1 - i, 1);
    months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  }
  return months.map((ym) => {
    let totalKg = 0;
    let sets = 0;
    for (const n of notes.filter((x) => x.date.startsWith(ym))) {
      for (const ex of parseMenu(n.content)) {
        for (const kg of ex.sets) {
          if (kg > 0) {
            totalKg += kg;
            sets += 1;
          }
        }
      }
    }
    return {
      month: ym.slice(5),
      totalKg: Math.round(totalKg),
      avgKg: sets ? Math.round((totalKg / sets) * 10) / 10 : 0,
      sets,
    };
  });
}

export function pickPrimaryTrainer(
  notes: Note[],
  reservations: Reservation[],
  trainerNames: Record<string, string>,
  yearMonth: string
): { id: string; displayName: string } | null {
  const counts = new Map<string, number>();
  for (const n of notes.filter((x) => x.date.startsWith(yearMonth))) {
    if (n.trainer_id) counts.set(n.trainer_id, (counts.get(n.trainer_id) || 0) + 2);
  }
  for (const r of reservations) {
    if (r.trainer_id) counts.set(r.trainer_id, (counts.get(r.trainer_id) || 0) + 1);
  }
  const best = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  if (!best) return null;
  const name = trainerNames[best[0]];
  if (!name) return null;
  return { id: best[0], displayName: name };
}

export function computeMetrics(params: {
  visitCount: number;
  totalMinutes: number;
  cumulativeVisits: number;
  surveys: Survey[];
  julySessionCount: number;
  weightRows: WeightProgressRow[];
}) {
  const ratings = params.surveys.map((s) => s.rating).filter((r): r is number => typeof r === "number");
  const avgSatisfaction =
    ratings.length > 0 ? Math.round((ratings.reduce((a, b) => a + b, 0) / ratings.length) * 10) / 10 : null;
  const surveyResponseRate =
    params.julySessionCount > 0
      ? Math.round((params.surveys.length / params.julySessionCount) * 1000) / 10
      : null;
  const estimatedKcal = Math.round(params.totalMinutes * 6);
  // 簡易スコア
  let score = 55;
  score += Math.min(20, params.visitCount * 1.2);
  if (avgSatisfaction != null) score += (avgSatisfaction - 3) * 6;
  if (surveyResponseRate != null) score += Math.min(10, surveyResponseRate / 10);
  const improved = params.weightRows.filter((r) => r.vsFirst > 0).length;
  score += Math.min(12, improved * 2);
  score = Math.max(40, Math.min(98, Math.round(score)));
  const overallGrade =
    score >= 90 ? "A+" : score >= 85 ? "A" : score >= 78 ? "A-" : score >= 70 ? "B+" : score >= 60 ? "B" : "C";
  return {
    visitCount: params.visitCount,
    totalMinutes: Math.round(params.totalMinutes),
    estimatedKcal,
    cumulativeVisits: params.cumulativeVisits,
    avgSatisfaction,
    surveyResponseRate,
    bookingAchievementRate: 100,
    abodyScore: score,
    overallGrade,
  };
}

export type BuildReportInput = {
  yearMonth: string;
  member: {
    id: string;
    member_code: string;
    name: string;
    display_name?: string | null;
    store_name: string;
    created_at: string;
  };
  notes: Note[];
  reservations: Reservation[];
  allConfirmedCount: number;
  surveys: Survey[];
  trainerNames: Record<string, string>;
  photos: {
    before: MonthlyProgressReport["photos"]["before"];
    after: MonthlyProgressReport["photos"]["after"];
  };
  ai: MonthlyProgressReport["ai"];
};

export function assembleReport(input: BuildReportInput): MonthlyProgressReport {
  const bounds = ymParts(input.yearMonth);
  const weightRows = buildWeightRows(input.notes, input.yearMonth, bounds.prev);
  const partRatios = buildPartRatios(input.notes, input.yearMonth);
  const topExercises = [...weightRows]
    .sort((a, b) => b.julySets - a.julySets)
    .slice(0, 5)
    .map((r) => ({ exercise: r.exercise, sets: r.julySets }));

  let totalMinutes = 0;
  const visitDates = new Set<string>();
  for (const r of input.reservations) {
    totalMinutes += (new Date(r.end_at).getTime() - new Date(r.start_at).getTime()) / 60000;
    const local = new Date(new Date(r.start_at).getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10);
    visitDates.add(local);
  }

  const metrics = computeMetrics({
    visitCount: input.reservations.length,
    totalMinutes,
    cumulativeVisits: input.allConfirmedCount,
    surveys: input.surveys,
    julySessionCount: input.reservations.length,
    weightRows,
  });

  const trainer = pickPrimaryTrainer(input.notes, input.reservations, input.trainerNames, input.yearMonth);
  const feedbacks = input.notes
    .filter((n) => n.date.startsWith(input.yearMonth))
    .map((n) => ({ date: n.date, text: parseFeedback(n.content) }))
    .filter((f) => f.text);

  const hasComparison = Boolean(input.photos.before && input.photos.after);

  return {
    meta: {
      yearMonth: input.yearMonth,
      yearMonthLabel: bounds.label,
      nextMonthLabel: bounds.nextLabel,
      generatedAt: new Date().toISOString(),
    },
    member: {
      id: input.member.id,
      memberCode: input.member.member_code,
      name: input.member.display_name || input.member.name,
      storeName: input.member.store_name,
      joinedAt: input.member.created_at,
      tenureMonths: tenureMonths(input.member.created_at, bounds.monthEndLocal),
    },
    trainer,
    photos: {
      before: input.photos.before,
      after: input.photos.after,
      hasComparison,
    },
    metrics,
    visitDates: [...visitDates].sort(),
    partRatios,
    topExercises,
    weightRows,
    volumeTrend: buildVolumeTrend(input.notes, input.yearMonth),
    feedbacks,
    ai: input.ai,
  };
}
