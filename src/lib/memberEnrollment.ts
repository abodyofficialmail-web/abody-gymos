export const ENROLLMENT_CAMPAIGN_PRESETS = [
  "通常入会",
  "友達紹介",
  "Instagram",
  "Google",
  "公式サイト",
  "チラシ",
  "体験キャンペーン",
] as const;

export const ENROLLMENT_CAMPAIGN_OTHER = "その他";

export const MIN_COMMITMENT_MONTH_OPTIONS = [3, 6, 12, 24] as const;

export const YMD_RE = /^\d{4}-\d{2}-\d{2}$/u;

export function formatJoinedAt(ymd: string | null | undefined): string {
  if (!ymd) return "—";
  const [y, m, d] = ymd.split("-").map((x) => Number(x));
  if (!y || !m || !d) return ymd;
  return `${y}年${m}月${d}日`;
}

export function formatMinCommitmentMonths(months: number | null | undefined): string {
  if (months == null || months <= 0) return "なし";
  return `${months}ヶ月`;
}

export function formatEnrollmentFee(hasFee: boolean | null | undefined): string {
  if (hasFee == null) return "—";
  return hasFee ? "あり" : "なし";
}

export function formatEnrollmentCampaign(campaign: string | null | undefined): string {
  const v = String(campaign ?? "").trim();
  return v || "—";
}

export function isPresetCampaign(value: string): boolean {
  return (ENROLLMENT_CAMPAIGN_PRESETS as readonly string[]).includes(value);
}
