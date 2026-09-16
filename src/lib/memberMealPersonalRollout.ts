/**
 * 食事パーソナルの段階的ロールアウト。
 * パイロット中はテスト会員 EBI020・SAK013・FUK001・UEN054・SHI031 のみ。課金（出勤表示パス方式）は試験後に接続する。
 * 全員公開時は MEAL_PERSONAL_PILOT_ONLY を false にする。
 */
export const MEAL_PERSONAL_PILOT_ONLY = true;

export const MEAL_PERSONAL_PILOT_CODES = new Set(["EBI020", "SAK013", "FUK001", "UEN054", "SHI031"]);

function normalizeMemberCode(memberCode: string | null | undefined): string {
  return String(memberCode ?? "")
    .trim()
    .toUpperCase()
    .replace(/[０-９]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .replace(/[\s_-]/g, "");
}

export function isMemberMealPersonalEnabled(memberCode: string | null | undefined): boolean {
  const code = normalizeMemberCode(memberCode);
  if (!code) return false;
  if (!MEAL_PERSONAL_PILOT_ONLY) return true;
  return MEAL_PERSONAL_PILOT_CODES.has(code);
}
