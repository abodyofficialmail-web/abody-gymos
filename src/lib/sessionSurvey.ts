import { getAppUrl } from "@/lib/constants";
import { sessionSurveyOpenUrl } from "@/lib/sessionSurveyLiff";
import { sessionSurveyPagePath } from "@/lib/sessionSurveyPaths";

export const SESSION_SURVEY_HIGHLIGHTS = [
  { id: "fun", label: "たのしかった" },
  { id: "effective", label: "しっかり効いた" },
  { id: "learned", label: "勉強になった" },
  { id: "stress_relief", label: "ストレス発散できた" },
  { id: "none", label: "なし" },
] as const;

export type SessionSurveyHighlightId = (typeof SESSION_SURVEY_HIGHLIGHTS)[number]["id"];

export const SESSION_SURVEY_INTENSITY = [
  { id: "too_hard", label: "きつすぎた" },
  { id: "just_right", label: "ちょうどいい" },
  { id: "more_push", label: "もう少し追い込みたい" },
] as const;

export type SessionSurveyIntensityId = (typeof SESSION_SURVEY_INTENSITY)[number]["id"];

/**
 * LINE ボタン用 URL。
 * LIFF ID があれば liff.line.me（LINE 内で開く）→ 回答後もデータは既存 API に保存。
 * なければ https://abody-gymos.vercel.app/... にフォールバック。
 */
export function sessionSurveyPageUrl(query: string): string {
  const liff = sessionSurveyOpenUrl(query);
  if (liff) return liff;
  return `${getAppUrl()}${sessionSurveyPagePath(query)}`;
}

export function sessionSurveyPageUrlFromInviteToken(inviteToken: string): string {
  return sessionSurveyPageUrl(`token=${encodeURIComponent(inviteToken)}`);
}

export function needsSessionSurveyFollowup(rating: number): boolean {
  return rating <= 2;
}

export function followupStatusForRating(rating: number): "none" | "pending" {
  return needsSessionSurveyFollowup(rating) ? "pending" : "none";
}

export function isSessionSurveyLineEnabled(): boolean {
  return process.env.SESSION_SURVEY_LINE_ENABLED?.trim() === "true";
}
