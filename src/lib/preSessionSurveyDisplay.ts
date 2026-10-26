import {
  PRE_SESSION_FORMAT_OPTIONS,
  PRE_SESSION_INTENSITY_OPTIONS,
  PRE_SESSION_MEAL_OPTIONS,
  type PreSessionFormatId,
  type PreSessionIntensityId,
  type PreSessionMealId,
} from "./preSessionSurvey";

export type PreSessionSurveyForKarte = {
  id: string;
  reservation_id: string;
  session_date: string;
  session_start_at: string;
  condition_score: number;
  meal_status: string;
  intensity_preference: string;
  session_format: string | null;
  request_focus: string | null;
  concern: string | null;
  free_comment: string | null;
  trainer_name: string;
  store_name: string;
  created_at: string;
};

const mealLabel = new Map(PRE_SESSION_MEAL_OPTIONS.map((m) => [m.id, m.label]));
const intensityLabel = new Map(PRE_SESSION_INTENSITY_OPTIONS.map((i) => [i.id, i.label]));
const formatLabel = new Map(PRE_SESSION_FORMAT_OPTIONS.map((f) => [f.id, f.label]));
const formatBadge = new Map(PRE_SESSION_FORMAT_OPTIONS.map((f) => [f.id, f.badge]));

export type ReservationPreSessionHearing = {
  request_focus: string | null;
  session_format: PreSessionFormatId | null;
};

const FORMAT_TAG = /^\[\[session_format:(training|stretch|both)\]\]\n?/;

export function normalizePreSessionFormat(value: unknown): PreSessionFormatId | null {
  if (value === "training" || value === "stretch" || value === "both") return value;
  return null;
}

/** 列追加前の回答も予約画面で読めるよう、希望を部位テキストの先頭タグに残す */
export function encodeRequestFocus(format: PreSessionFormatId | null, focus: string | null): string | null {
  const body = focus?.trim() ?? "";
  if (!format) return body || null;
  return body ? `[[session_format:${format}]]\n${body}` : `[[session_format:${format}]]`;
}

export function splitStoredRequestFocus(raw: string | null | undefined): {
  session_format: PreSessionFormatId | null;
  request_focus: string | null;
} {
  const text = typeof raw === "string" ? raw : "";
  const matched = text.match(FORMAT_TAG);
  if (!matched) {
    const focus = text.trim();
    return { session_format: null, request_focus: focus || null };
  }
  const rest = text.slice(matched[0].length).trim();
  return {
    session_format: matched[1] as PreSessionFormatId,
    request_focus: rest || null,
  };
}

export function resolvePreSessionHearing(input: {
  session_format?: unknown;
  request_focus?: string | null;
}): ReservationPreSessionHearing {
  const stored = splitStoredRequestFocus(input.request_focus);
  return {
    session_format: normalizePreSessionFormat(input.session_format) ?? stored.session_format,
    request_focus: stored.request_focus,
  };
}

export function formatPreSessionFormat(id: string | null | undefined): string | null {
  if (!id) return null;
  return formatLabel.get(id as PreSessionFormatId) ?? null;
}

/** 予約カード用の短い表示 */
export function formatPreSessionFormatBadge(id: string | null | undefined): string | null {
  if (!id) return null;
  return formatBadge.get(id as PreSessionFormatId) ?? null;
}

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
  const hearing = resolvePreSessionHearing(s);
  const parts = [
    formatPreSessionCondition(s.condition_score),
    `食事: ${formatPreSessionMeal(s.meal_status)}`,
    `強度: ${formatPreSessionIntensity(s.intensity_preference)}`,
  ];
  const format = formatPreSessionFormat(hearing.session_format);
  if (format) parts.push(`希望: ${format}`);
  const focus = hearing.request_focus?.trim();
  if (focus) parts.push(`希望部位: ${focus}`);
  const concern = s.concern?.trim();
  if (concern) parts.push(`注意: ${concern}`);
  return parts.join("  ");
}

export function formatPreSessionSurveyDetailLines(s: PreSessionSurveyForKarte): string[] {
  const lines = [
    `${formatPreSessionCondition(s.condition_score)} / 食事: ${formatPreSessionMeal(s.meal_status)} / 強度: ${formatPreSessionIntensity(s.intensity_preference)}`,
  ];
  const hearing = resolvePreSessionHearing(s);
  const format = formatPreSessionFormat(hearing.session_format);
  if (format) lines.push(`希望: ${format}`);
  if (hearing.request_focus?.trim()) lines.push(`希望部位: ${hearing.request_focus.trim()}`);
  if (s.concern?.trim()) lines.push(`痛み・違和感: ${s.concern.trim()}`);
  if (s.free_comment?.trim()) lines.push(`その他: ${s.free_comment.trim()}`);
  return lines;
}
