export type PaymentLinkItem = {
  id: string;
  name: string;
  priceYen: number;
  url: string;
  /** アメックス専用の決済リンク。通常リンクと別に送る。 */
  amexUrl?: string;
  /** 店舗ごとの決済リンク。その店の会員に送るときだけ使う。 */
  storeUrls?: { storeName: string; url: string }[];
};

export type PaymentCoupon = {
  id: string;
  label: string;
  code: string;
  /** 指定した店の会員にだけ出す。 */
  storeName?: string;
};

export const PERSONAL_PAYMENT_LINKS: PaymentLinkItem[] = [
  {
    id: "personal-30",
    name: "30分通い放題・月10回",
    priceYen: 30800,
    url: "https://buy.stripe.com/5kA8zaaMT2E4gCs5kk",
    amexUrl: "https://buy.stripe.com/5kQ7sL4UgdYq6NK5OMbEA1u",
    storeUrls: [{ storeName: "福岡", url: "https://buy.stripe.com/fZu4gz3bI1CN6U53MZcEw02" }],
  },
  {
    id: "personal-60",
    name: "60分通い放題・月20回",
    priceYen: 58300,
    url: "https://buy.stripe.com/28odRf3MK1tS9WgcNu",
  },
  {
    id: "monthly-4",
    name: "月4回プラン",
    priceYen: 16000,
    url: "https://buy.stripe.com/3cI00j3J5gKd2mD3cN7ok0B",
  },
  {
    id: "hiatus-1m",
    name: "休会1ヶ月",
    priceYen: 3300,
    url: "https://buy.stripe.com/fZudR91AX1Pj0ev4gR7ok05",
  },
];

export const OPTION_PAYMENT_LINKS: PaymentLinkItem[] = [
  {
    id: "wear-rental",
    name: "ウェアレンタル",
    priceYen: 3300,
    url: "https://buy.stripe.com/5kQeVd5Ykf2u9ZW0usbEA1w",
  },
];

export const PAYMENT_COUPONS: PaymentCoupon[] = [
  { id: "hangaku", label: "初月 月会費 半額", code: "Hangaku" },
  { id: "yokohama", label: "初月 月会費 980円", code: "Yokohama" },
  { id: "abody01", label: "初月 月会費 9,800円", code: "abody01" },
  { id: "abody500", label: "初月 月会費 500円", code: "abody500" },
];

export const FUKUOKA_PAYMENT_COUPONS: PaymentCoupon[] = [
  { id: "fukuoka-980", label: "980円", code: "Fukuoka", storeName: "福岡" },
  { id: "fukuoka-9800", label: "9,800円", code: "Fukuoka9800", storeName: "福岡" },
  { id: "fukuoka-2hangaku", label: "2ヶ月半額", code: "2hangaku", storeName: "福岡" },
];

export function couponsForStore(storeName: string | null | undefined): PaymentCoupon[] {
  if (storeName === "福岡") return FUKUOKA_PAYMENT_COUPONS;
  return PAYMENT_COUPONS;
}

export function formatYen(yen: number): string {
  return `${yen.toLocaleString("ja-JP")}円`;
}

export function allPaymentLinks(): PaymentLinkItem[] {
  return [...PERSONAL_PAYMENT_LINKS, ...OPTION_PAYMENT_LINKS];
}

export function paymentLinkUrl(
  item: PaymentLinkItem,
  card: "standard" | "amex",
  storeName?: string | null
): string {
  if (card === "amex" && item.amexUrl) return item.amexUrl;
  const storeUrl = item.storeUrls?.find((row) => row.storeName === storeName)?.url;
  return storeUrl || item.url;
}

function linkTargets(item: PaymentLinkItem): Array<{ url: string; card: "standard" | "amex" }> {
  const targets: Array<{ url: string; card: "standard" | "amex" }> = [];
  if (item.amexUrl) targets.push({ url: item.amexUrl, card: "amex" });
  for (const store of item.storeUrls ?? []) targets.push({ url: store.url, card: "standard" });
  targets.push({ url: item.url, card: "standard" });
  return targets;
}

export function matchPaymentLinkUrl(url: string): { item: PaymentLinkItem; card: "standard" | "amex" } | null {
  const path = buyStripePath(url);
  if (!path) return null;
  for (const item of allPaymentLinks()) {
    const matched = linkTargets(item).find((target) => buyStripePath(target.url) === path);
    if (matched) return { item, card: matched.card };
  }
  return null;
}

function buyStripePath(url: string): string {
  const raw = String(url ?? "").trim();
  if (!raw) return "";
  try {
    return new URL(raw).pathname.replace(/\/$/, "");
  } catch {
    const slug = raw.split("?")[0]?.split("/").filter(Boolean).pop() ?? "";
    return slug ? `/${slug}` : "";
  }
}

export function matchPaymentLinkInText(text: string): { item: PaymentLinkItem; card: "standard" | "amex" } | null {
  const source = String(text ?? "");
  for (const item of allPaymentLinks()) {
    const matched = linkTargets(item).find((target) => source.includes(target.url));
    if (matched) return { item, card: matched.card };
  }
  return null;
}

export function knownPaymentUrls(): string[] {
  const urls: string[] = [];
  for (const item of allPaymentLinks()) {
    for (const target of linkTargets(item)) urls.push(target.url);
  }
  return urls;
}
