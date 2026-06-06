/** 会員向けセッションアンケート（Gym OS 本体とは別エントリとして扱う） */
export const SESSION_SURVEY_PATH = "/survey";

export function sessionSurveyPagePath(query?: string): string {
  if (!query) return SESSION_SURVEY_PATH;
  const q = query.startsWith("?") ? query.slice(1) : query;
  return `${SESSION_SURVEY_PATH}?${q}`;
}
