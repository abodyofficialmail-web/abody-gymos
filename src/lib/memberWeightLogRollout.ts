/**
 * 体重記録機能の段階的ロールアウト。
 * 全員公開済み。食事パーソナルとは独立（MEAL_PERSONAL_PILOT_ONLY は別ファイル）。
 */
export const WEIGHT_LOG_PILOT_ONLY = false;

export const WEIGHT_LOG_PILOT_CODES = new Set(["EBI020"]);

function normalizeMemberCode(memberCode: string | null | undefined): string {
  return String(memberCode ?? "")
    .trim()
    .toUpperCase()
    .replace(/[０-９]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .replace(/[\s_-]/g, "");
}

export function isMemberWeightLogEnabled(memberCode: string | null | undefined): boolean {
  const code = normalizeMemberCode(memberCode);
  if (!code) return false;
  if (!WEIGHT_LOG_PILOT_ONLY) return true;
  return WEIGHT_LOG_PILOT_CODES.has(code);
}
