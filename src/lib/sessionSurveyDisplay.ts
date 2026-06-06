import {
  SESSION_SURVEY_HIGHLIGHTS,
  SESSION_SURVEY_INTENSITY,
  type SessionSurveyHighlightId,
  type SessionSurveyIntensityId,
} from "@/lib/sessionSurvey";

export type SessionSurveyForKarte = {
  id: string;
  session_date: string;
  rating: number;
  highlights: string[];
  intensity_feedback: string;
  comment_general: string | null;
  comment_improve: string | null;
  comment_questions: string | null;
  needs_followup: boolean;
  trainer_name: string;
  store_name: string;
  created_at: string;
};

const highlightLabel = new Map(SESSION_SURVEY_HIGHLIGHTS.map((h) => [h.id, h.label]));
const intensityLabel = new Map(SESSION_SURVEY_INTENSITY.map((i) => [i.id, i.label]));

export function formatSurveyRating(rating: number): string {
  return `★${rating}`;
}

export function formatSurveyHighlights(ids: string[]): string {
  if (!ids.length) return "—";
  if (ids.includes("none")) return "なし";
  return ids
    .map((id) => highlightLabel.get(id as SessionSurveyHighlightId) ?? id)
    .join("、");
}

export function formatSurveyIntensity(id: string): string {
  return intensityLabel.get(id as SessionSurveyIntensityId) ?? id;
}

export function formatSurveySummary(s: SessionSurveyForKarte): string {
  const parts = [
    formatSurveyRating(s.rating),
    `よかった: ${formatSurveyHighlights(s.highlights)}`,
    `追い込み: ${formatSurveyIntensity(s.intensity_feedback)}`,
  ];
  const comment = s.comment_general?.trim();
  if (comment) parts.push(`感想: ${comment}`);
  return parts.join("  ");
}

export function formatSurveyDetailLines(s: SessionSurveyForKarte): string[] {
  const lines = [
    `${formatSurveyRating(s.rating)} / ${formatSurveyHighlights(s.highlights)} / 追い込み: ${formatSurveyIntensity(s.intensity_feedback)}`,
  ];
  if (s.comment_general?.trim()) lines.push(`感想: ${s.comment_general.trim()}`);
  if (s.comment_improve?.trim()) lines.push(`改善: ${s.comment_improve.trim()}`);
  if (s.comment_questions?.trim()) lines.push(`次回聞きたい: ${s.comment_questions.trim()}`);
  return lines;
}
