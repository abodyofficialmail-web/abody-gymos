/**
 * 食事パーソナルの段階的ロールアウト。
 * 全会員は消費カロリー・PFCを見られる。写真記録など全機能はパイロットまたは課金後。
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

export function isMemberMealPersonalPilot(memberCode: string | null | undefined): boolean {
  const code = normalizeMemberCode(memberCode);
  return Boolean(code) && MEAL_PERSONAL_PILOT_CODES.has(code);
}

/** ログイン会員ならマイページに入口を出す（未課金はプレビュー）。 */
export function isMemberMealPersonalVisible(memberCode: string | null | undefined): boolean {
  return Boolean(normalizeMemberCode(memberCode));
}

/** 全機能。課金パス判定は isMemberMealPersonalFullEnabled を使う。 */
export function isMemberMealPersonalEnabled(memberCode: string | null | undefined): boolean {
  return isMemberMealPersonalPilot(memberCode);
}
