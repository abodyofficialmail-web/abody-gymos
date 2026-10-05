export const ENROLLMENT_CAMPAIGN_PRESETS = [
  "初月半額",
  "2カ月半額",
  "初月500円",
  "初月980円",
  "入会者と紹介者半額",
  "入会者と紹介者980円",
] as const;

/** 保存済みの旧キャンペーン名を編集画面で残すための値。新規登録では出さない。 */
export const ENROLLMENT_CAMPAIGN_OTHER = "その他";

export const ENROLLMENT_REFERRAL_CAMPAIGNS = ["入会者と紹介者半額", "入会者と紹介者980円"] as const;

export const MIN_COMMITMENT_MONTH_OPTIONS = Array.from({ length: 15 }, (_, index) => index + 1);

/** 入会特典で付与するチケットコマ数。0は付与なし。 */
export const ENROLLMENT_BONUS_KOMA_OPTIONS = [0, 4, 5, 6, 7, 8] as const;

export const YMD_RE = /^\d{4}-\d{2}-\d{2}$/u;

export function formatJoinedAt(ymd: string | null | undefined): string {
  if (!ymd) return "—";
  const [y, m, d] = ymd.split("-").map((x) => Number(x));
  if (!y || !m || !d) return ymd;
  return `${y}年${m}月${d}日`;
}

/** ISO日時、または YYYY-MM-DD を東京の日付にする。 */
export function isoToTokyoYmd(value: string | null | undefined): string {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  if (YMD_RE.test(raw)) return raw;
  const ms = Date.parse(raw);
  if (Number.isNaN(ms)) return "";
  const tokyo = new Date(ms + 9 * 60 * 60 * 1000);
  const y = tokyo.getUTCFullYear();
  const m = String(tokyo.getUTCMonth() + 1).padStart(2, "0");
  const d = String(tokyo.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export type ProvisionalContractSource = "line" | "registered";

/**
 * 入会日が未保存のとき、契約日の仮値を決める。
 * LINE連携（友だち追加）の記録があればその日、なければ会員登録日。
 */
export function resolveProvisionalContractDate(input: {
  joinedAt?: string | null;
  lineFollowedAt?: string | null;
  createdAt?: string | null;
}): { ymd: string; source: ProvisionalContractSource | null } {
  const saved = isoToTokyoYmd(input.joinedAt);
  if (saved) return { ymd: saved, source: null };
  const line = isoToTokyoYmd(input.lineFollowedAt);
  if (line) return { ymd: line, source: "line" };
  const created = isoToTokyoYmd(input.createdAt);
  if (created) return { ymd: created, source: "registered" };
  return { ymd: "", source: null };
}

export function provisionalContractSourceLabel(source: ProvisionalContractSource | null): string | null {
  if (source === "line") return "LINE連携日";
  if (source === "registered") return "会員登録日";
  return null;
}

/** 契約日から基準日までの継続期間。1ヶ月未満は「1ヶ月未満」。 */
export function formatTenureFromYmd(startYmd: string | null | undefined, asOfYmd: string): string {
  const start = isoToTokyoYmd(startYmd);
  const end = isoToTokyoYmd(asOfYmd);
  if (!start || !end) return "—";
  const [sy, sm, sd] = start.split("-").map(Number);
  const [ey, em, ed] = end.split("-").map(Number);
  if (!sy || !sm || !sd || !ey || !em || !ed) return "—";
  if (ey < sy || (ey === sy && em < sm) || (ey === sy && em === sm && ed < sd)) return "—";
  let months = (ey - sy) * 12 + (em - sm);
  if (ed < sd) months -= 1;
  if (months < 0) months = 0;
  const years = Math.floor(months / 12);
  const rem = months % 12;
  if (years === 0 && rem === 0) return "1ヶ月未満";
  if (years === 0) return `${rem}ヶ月`;
  if (rem === 0) return `${years}年`;
  return `${years}年${rem}ヶ月`;
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

export function campaignNeedsReferrer(campaign: string): boolean {
  return (ENROLLMENT_REFERRAL_CAMPAIGNS as readonly string[]).includes(campaign.trim());
}
