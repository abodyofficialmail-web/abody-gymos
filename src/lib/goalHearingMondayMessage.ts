/** 目標ヒアリング回答から、月曜モチベLINE本文を組み立てる（外部I/Oなし） */

export const GOAL_HEARING_MONDAY_EXCLUDE_CODES = new Set(["EBI020", "UEN055"]);

const PRIMARY_GOAL_LABELS: Record<string, string> = {
  diet: "ダイエット・引き締め",
  muscle: "筋肉をつけたい",
  posture: "姿勢・機能改善",
  stamina: "体力アップ",
  habit: "運動習慣をつけたい",
  other: "その他",
};

export type GoalHearingMondayResponse = {
  primary_goal: string;
  primary_goal_other?: string | null;
  secondary_goal?: string | null;
  focus_areas?: string[] | null;
  weight_direction?: string | null;
  current_weight_kg?: number | null;
  target_weight_kg?: number | null;
  current_body_fat_pct?: number | null;
  target_body_fat_pct?: number | null;
  deadline_type?: string | null;
  deadline_date?: string | null;
  goal_reason?: string | null;
  ideal_frequency?: string | null;
  preferred_slots?: string[] | null;
  challenges?: string[] | null;
  meal_change?: string | null;
  pain_areas?: string[] | null;
  training_styles?: string[] | null;
  medical_restrictions?: string | null;
  sleep_hours?: string | null;
};

export function openingLineForGoal(primaryGoal: string): string {
  switch (primaryGoal) {
    case "diet":
      return "目標の引き締まった体に、近づく週です。";
    case "muscle":
      return "厚みのある体に、近づける週です。";
    case "posture":
      return "無理なく整えていく週です。";
    case "stamina":
      return "体力を積み上げる週です。";
    case "habit":
      return "通う習慣を作る週です。";
    default:
      return "今週も、目標の体に近づけていきましょう。";
  }
}

export function goalLabel(primaryGoal: string, other?: string | null): string {
  const trimmed = other?.trim();
  if (primaryGoal === "other" && trimmed) return trimmed;
  return PRIMARY_GOAL_LABELS[primaryGoal] ?? (trimmed || primaryGoal);
}

export function idealWeeklyCount(idealFrequency?: string | null): number {
  if (idealFrequency === "1") return 1;
  if (idealFrequency === "2") return 2;
  if (idealFrequency === "3") return 3;
  if (idealFrequency === "4plus") return 4;
  return 1;
}

function realPainAreas(painAreas?: string[] | null): string[] {
  return (painAreas ?? []).filter((p) => p && p !== "ない");
}

function wantsMobility(styles?: string[] | null): boolean {
  return (styles ?? []).some(
    (s) => s.includes("ストレッチ") || s.includes("ピラティス") || s.includes("筋膜")
  );
}

function mealHint(response: GoalHearingMondayResponse): string {
  const r = response;
  if (r.meal_change === "alcohol") return "食事はまずお酒だけ意識して減らしてみてください。";
  if (r.meal_change === "snack") return "食事は間食だけ先に減らしてみてください。";
  if (r.meal_change === "protein") return "たんぱく質を意識して増やしてみてください。";
  if (r.meal_change === "late_night") return "夜食をやめるところからいきましょう。";
  const challenges = r.challenges ?? [];
  if (challenges.includes("お酒が多い")) return "食事はお酒の回数だけ意識してみてください。";
  if (challenges.includes("間食・甘いものが多い")) return "食事は間食だけ先に減らしてみてください。";
  if (challenges.includes("夜遅い食事")) return "夜食をやめるところからいきましょう。";
  if (challenges.includes("外食が多い")) return "外食のときは、野菜とたんぱく質を先に取ってみてください。";
  return "食事は無理なく、できるところから整えましょう。";
}

function bookingLines(params: {
  weekReservationCount: number;
  idealCount: number;
  preferredSlots?: string[] | null;
}): { bookingLine: string; actionLine: string } {
  const { weekReservationCount, idealCount, preferredSlots } = params;
  const slots = (preferredSlots ?? []).filter(Boolean).slice(0, 2);

  if (weekReservationCount >= Math.max(idealCount, 2)) {
    return {
      bookingLine: `今週はもう${weekReservationCount}枠入ってますね、いいペースです。`,
      actionLine: "あとは決めた枠をしっかり消化していきましょう。",
    };
  }
  if (weekReservationCount >= 2) {
    return {
      bookingLine: `今週はもう${weekReservationCount}枠入ってますね、いいペースです。`,
      actionLine:
        idealCount > weekReservationCount
          ? `余裕あればもう1枠あると、週${idealCount}の理想ペースに近づきます。`
          : "あとは決めた枠をしっかり消化していきましょう。",
    };
  }
  if (weekReservationCount === 1) {
    return {
      bookingLine: "今週1枠入ってますね。",
      actionLine:
        idealCount >= 2
          ? `余裕あればもう1枠あると、週${idealCount}の理想ペースに近づきます。`
          : "決めた枠をしっかり消化していきましょう。",
    };
  }
  return {
    bookingLine: "今週まだ予約がないので、まず1枠入れてみましょう。",
    actionLine: slots.length
      ? `通いやすい時間（${slots.join(" / ")}）で取れると◎です。`
      : "カレンダー見て、取れる枠を1つ入れてください。",
  };
}

function trainingLine(response: GoalHearingMondayResponse): string {
  const focus = (response.focus_areas ?? []).filter(Boolean).slice(0, 3).join("・") || "全身";
  const pain = realPainAreas(response.pain_areas);
  const hasMedical = Boolean(response.medical_restrictions?.trim()) && response.medical_restrictions?.trim() !== "ない";
  const stretch = wantsMobility(response.training_styles);

  if (pain.length || hasMedical) {
    const area = pain.length ? pain.join("・") : "痛みのある部位";
    return stretch
      ? `${area}は無理せず、ストレッチも交えながら${focus}を優先で進めます。`
      : `${area}は無理せず、${focus}を優先で進めます。`;
  }
  if (stretch) {
    return `今週の重点は${focus}。トレーニングにストレッチも入れて整えていきましょう。`;
  }
  return `今週の重点は${focus}。しっかりトレーニングで進めましょう。`;
}

function reasonLine(goalReason?: string | null): string | null {
  if (goalReason === "event") return "イベントに向けて、今週の積み重ねが効きます。";
  if (goalReason === "looks" || goalReason === "clothes") return "見た目の変化は、回数で積み上がります。";
  if (goalReason === "health") return "健康のためにも、無理なく続けていきましょう。";
  if (goalReason === "confidence") return "積み重ねが、自信につながっていきます。";
  return null;
}

function numericLine(response: GoalHearingMondayResponse): string | null {
  const bits: string[] = [];
  if (response.current_weight_kg != null && response.target_weight_kg != null) {
    bits.push(`体重 ${response.current_weight_kg}→${response.target_weight_kg}kg`);
  }
  if (response.current_body_fat_pct != null && response.target_body_fat_pct != null) {
    bits.push(`体脂肪 ${response.current_body_fat_pct}→${response.target_body_fat_pct}%`);
  }
  if (!bits.length) return null;
  return `いまの目安は ${bits.join("、")} です。`;
}

function sleepLine(sleepHours?: string | null, challenges?: string[] | null): string | null {
  if (sleepHours === "lt5" || sleepHours === "5to6" || sleepHours === "irregular") {
    return "睡眠もできるだけ削らないようにしましょう。";
  }
  if ((challenges ?? []).includes("睡眠不足")) return "睡眠もできるだけ削らないようにしましょう。";
  return null;
}

export function buildGoalHearingMondayMessage(params: {
  response: GoalHearingMondayResponse;
  weekReservationCount: number;
}): string {
  const r = params.response;
  const primary = goalLabel(r.primary_goal, r.primary_goal_other);
  const { bookingLine, actionLine } = bookingLines({
    weekReservationCount: params.weekReservationCount,
    idealCount: idealWeeklyCount(r.ideal_frequency),
    preferredSlots: r.preferred_slots,
  });

  const lines = [
    "お疲れさまです！",
    openingLineForGoal(r.primary_goal),
    "",
    `いちばんの目標は「${primary}」。`,
    numericLine(r),
    reasonLine(r.goal_reason),
    "",
    bookingLine,
    actionLine,
    trainingLine(r),
    mealHint(r),
    sleepLine(r.sleep_hours, r.challenges),
    "",
    "上の写真は、なりたい体型のイメージです。",
    "今週も一緒にやっていきましょう！",
  ].filter((x): x is string => x != null);

  return lines.join("\n");
}
