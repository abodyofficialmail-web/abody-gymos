import type { GoalHearingFormPayload } from "@/lib/goalHearing";

export type NutritionEstimate = {
  age_years: number;
  bmr: number;
  tdee: number;
  intake_min: number;
  intake_max: number;
  intake_mid: number;
  protein_g: number;
  fat_g: number;
  carb_g: number;
  monthly_change_min_kg: number;
  monthly_change_max_kg: number;
  direction: "lose" | "gain" | "maintain" | "looks";
  note: string;
};

const ACTIVITY_FACTOR: Record<string, number> = {
  sedentary: 1.2,
  light: 1.375,
  standing: 1.55,
  physical: 1.725,
  active: 1.725,
};

function resolveAgeYears(form: GoalHearingFormPayload, asOf = new Date()): number | null {
  if (form.age_years != null && Number.isFinite(form.age_years)) return Math.round(form.age_years);
  if (!form.birth_date) return null;
  const d = new Date(`${form.birth_date}T00:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  let age = asOf.getFullYear() - d.getFullYear();
  const m = asOf.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && asOf.getDate() < d.getDate())) age -= 1;
  return age > 0 && age < 120 ? age : null;
}

function roundKcal(n: number): number {
  return Math.round(n / 10) * 10;
}

function resolveDirection(form: GoalHearingFormPayload): "lose" | "gain" | "maintain" | "looks" {
  const d = form.weight_direction;
  if (d === "lose" || d === "gain" || d === "maintain" || d === "looks") return d;
  // fallback for old responses
  if (form.current_weight_kg != null && form.target_weight_kg != null) {
    if (form.target_weight_kg < form.current_weight_kg - 0.5) return "lose";
    if (form.target_weight_kg > form.current_weight_kg + 0.5) return "gain";
  }
  if (form.primary_goal === "diet") return "lose";
  if (form.primary_goal === "muscle") return "gain";
  return "maintain";
}

/**
 * Mifflin-St Jeor + 活動係数。
 * 1ヶ月の体重変化は約 7,700kcal ≒ 1kg で概算。
 */
export function estimateGoalHearingNutrition(form: GoalHearingFormPayload): NutritionEstimate | null {
  if (form.weight_unknown || form.current_weight_kg == null || !Number.isFinite(form.current_weight_kg)) {
    return null;
  }
  const age = resolveAgeYears(form);
  if (age == null) return null;
  if (!form.height_cm || !form.sex) return null;

  const weight = Number(form.current_weight_kg);
  const height = Number(form.height_cm);
  const bmr =
    form.sex === "male"
      ? 10 * weight + 6.25 * height - 5 * age + 5
      : 10 * weight + 6.25 * height - 5 * age - 161;

  const factor = ACTIVITY_FACTOR[form.activity_level] ?? 1.375;
  const tdee = bmr * factor;
  const direction = resolveDirection(form);

  let deficitMin = 0;
  let deficitMax = 0;
  let note = "体重はほぼ横ばいの目安です。";

  if (direction === "lose") {
    deficitMin = 300;
    deficitMax = 500;
    note = "無理のない減量ペースの目安です。";
  } else if (direction === "gain") {
    deficitMin = -300;
    deficitMax = -200;
    note = "筋肉をつけやすい増量ペースの目安です。";
  } else if (direction === "looks") {
    if (form.target_weight_kg != null && form.target_weight_kg < weight - 0.5) {
      deficitMin = 250;
      deficitMax = 400;
      note = "見た目重視・ゆるやかな減量の目安です。";
    } else if (form.target_weight_kg != null && form.target_weight_kg > weight + 0.5) {
      deficitMin = -250;
      deficitMax = -150;
      note = "見た目重視・ゆるやかな増量の目安です。";
    } else {
      deficitMin = 0;
      deficitMax = 100;
      note = "見た目重視・体重はほぼ維持の目安です。";
    }
  }

  const intakeMax = roundKcal(tdee - deficitMin);
  const intakeMin = roundKcal(tdee - deficitMax);
  const intake_min = Math.min(intakeMin, intakeMax);
  const intake_max = Math.max(intakeMin, intakeMax);
  const intake_mid = roundKcal((intake_min + intake_max) / 2);

  // PFC: たんぱく質は体重×g、脂質は摂取の約25%、残り糖質
  const proteinPerKg = direction === "gain" || form.primary_goal === "muscle" ? 2.0 : direction === "lose" ? 1.8 : 1.6;
  const protein_g = Math.round(weight * proteinPerKg);
  const fat_g = Math.round((intake_mid * 0.25) / 9);
  const carb_g = Math.max(0, Math.round((intake_mid - protein_g * 4 - fat_g * 9) / 4));

  const kcalPerKg = 7700;
  const monthly_change_min_kg = Math.round(((deficitMin * 30) / kcalPerKg) * -10) / 10;
  const monthly_change_max_kg = Math.round(((deficitMax * 30) / kcalPerKg) * -10) / 10;

  return {
    age_years: age,
    bmr: roundKcal(bmr),
    tdee: roundKcal(tdee),
    intake_min,
    intake_max,
    intake_mid,
    protein_g,
    fat_g,
    carb_g,
    monthly_change_min_kg: Math.min(monthly_change_min_kg, monthly_change_max_kg),
    monthly_change_max_kg: Math.max(monthly_change_min_kg, monthly_change_max_kg),
    direction,
    note,
  };
}

export function formatMonthlyChangeLabel(est: NutritionEstimate): string {
  const a = est.monthly_change_min_kg;
  const b = est.monthly_change_max_kg;
  if (Math.abs(a) < 0.05 && Math.abs(b) < 0.05) return "ほぼ横ばい";
  const fmt = (n: number) => (n > 0 ? `+${n}` : `${n}`);
  if (a === b) return `約 ${fmt(a)} kg`;
  return `約 ${fmt(a)}〜${fmt(b)} kg`;
}

export function formatNutritionLines(est: NutritionEstimate): string[] {
  return [
    "■ 栄養・カロリー目安（概算）",
    `基礎代謝: 約 ${est.bmr} kcal`,
    `推定消費: 約 ${est.tdee} kcal`,
    `目標摂取: 約 ${est.intake_min}〜${est.intake_max} kcal`,
    `PFC目安: P ${est.protein_g}g / F ${est.fat_g}g / C ${est.carb_g}g`,
    `1ヶ月の体重目安: ${formatMonthlyChangeLabel(est)}`,
    `※${est.note}`,
  ];
}
