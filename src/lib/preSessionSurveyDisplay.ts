import {
  PRE_SESSION_INTENSITY_OPTIONS,
  PRE_SESSION_MEAL_OPTIONS,
  type PreSessionIntensityId,
  type PreSessionMealId,
} from "@/lib/preSessionSurvey";

export type PreSessionSurveyForKarte = {
  id: string;
  reservation_id: string;
  session_date: string;
  session_start_at: string;
  condition_score: number;
  meal_status: string;
  intensity_preference: string;
  request_focus: string | null;
  concern: string | null;
  free_comment: string | null;
  trainer_name: string;
  store_name: string;
  created_at: string;
};

const mealLabel = new Map(PRE_SESSION_MEAL_OPTIONS.map((m) => [m.id, m.label]));
const intensityLabel = new Map(PRE_SESSION_INTENSITY_OPTIONS.map((i) => [i.id, i.label]));

export function formatPreSessionCondition(score: number): string {
  return `調子 ${score}/5`;
}

export function formatPreSessionMeal(id: string): string {
  return mealLabel.get(id as PreSessionMealId) ?? id;
}

export function formatPreSessionIntensity(id: string): string {
  return intensityLabel.get(id as PreSessionIntensityId) ?? id;
}

export function formatPreSessionSurveySummary(s: PreSessionSurveyForKarte): string {
  const parts = [
    formatPreSessionCondition(s.condition_score),
    `食事: ${formatPreSessionMeal(s.meal_status)}`,
    `強度: ${formatPreSessionIntensity(s.intensity_preference)}`,
  ];
  const focus = s.request_focus?.trim();
  if (focus) parts.push(`重点: ${focus}`);
  const concern = s.concern?.trim();
  if (concern) parts.push(`注意: ${concern}`);
  return parts.join("  ");
}

export function formatPreSessionSurveyDetailLines(s: PreSessionSurveyForKarte): string[] {
  const lines = [
    `${formatPreSessionCondition(s.condition_score)} / 食事: ${formatPreSessionMeal(s.meal_status)} / 強度: ${formatPreSessionIntensity(s.intensity_preference)}`,
  ];
  if (s.request_focus?.trim()) lines.push(`重点: ${s.request_focus.trim()}`);
  if (s.concern?.trim()) lines.push(`痛み・違和感: ${s.concern.trim()}`);
  if (s.free_comment?.trim()) lines.push(`その他: ${s.free_comment.trim()}`);
  return lines;
}
