export type SurveyRateStats = {
  invite_count: number;
  response_count: number;
  response_rate: number | null;
};

export function calcSurveyResponseRate(inviteCount: number, responseCount: number): number | null {
  if (inviteCount <= 0) return null;
  return Math.round((responseCount / inviteCount) * 1000) / 10;
}

export function surveyRateBadgeClass(rate: number | null): string {
  const base = "rounded-full border px-2 py-0.5 text-[10px] font-semibold";
  if (rate != null && rate >= 70) return `${base} border-emerald-200 bg-emerald-50 text-emerald-800`;
  if (rate != null && rate >= 40) return `${base} border-amber-200 bg-amber-50 text-amber-800`;
  return `${base} border-red-200 bg-red-50 text-red-800`;
}

export function formatSurveyRateShort(label: string, stats: SurveyRateStats): string | null {
  if (stats.invite_count <= 0) return null;
  const rate = stats.response_rate != null ? `${stats.response_rate.toFixed(1)}%` : "—";
  return `${label} ${rate}（${stats.response_count}/${stats.invite_count}）`;
}

/** LINE アンケートボタン用の月次回答率テキスト */
export function formatMemberSurveyRateForLine(stats: SurveyRateStats): string | null {
  if (stats.invite_count <= 0) return null;
  const rate = stats.response_rate != null ? `${stats.response_rate.toFixed(0)}%` : "—";
  return `今月の回答率 ${rate}（${stats.response_count}/${stats.invite_count}件）`;
}

const SESSION_SURVEY_LINE_BUTTON_DEFAULT = "#e11d48";
const SESSION_SURVEY_LINE_BUTTON_AMBER = "#d97706";
const SESSION_SURVEY_LINE_BUTTON_GOLD = "#b8860b";

/** 回答率に応じた LINE Flex ボタン色（高いほど金色） */
export function sessionSurveyLineButtonColor(stats: SurveyRateStats): string {
  if (stats.invite_count <= 0 || stats.response_rate == null) return SESSION_SURVEY_LINE_BUTTON_DEFAULT;
  if (stats.response_rate >= 80) return SESSION_SURVEY_LINE_BUTTON_GOLD;
  if (stats.response_rate >= 50) return SESSION_SURVEY_LINE_BUTTON_AMBER;
  return SESSION_SURVEY_LINE_BUTTON_DEFAULT;
}

/** 並び替え用（セッション後アンケート）: 低いほど先頭。招待なしは末尾 */
export function postSessionSurveySortValue(stats: SurveyRateStats): number {
  if (stats.invite_count > 0 && stats.response_rate != null) return stats.response_rate;
  return 9999;
}
