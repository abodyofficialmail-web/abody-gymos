export type PaymentLinkItem = {
  id: string;
  name: string;
  priceYen: number;
  url: string;
  /** アメックス専用の決済リンク。通常リンクと別に送る。 */
  amexUrl?: string;
};

export type PaymentCoupon = {
  id: string;
  label: string;
  code: string;
};

export const PERSONAL_PAYMENT_LINKS: PaymentLinkItem[] = [
  {
    id: "personal-30",
    name: "30分通い放題・月10回",
    priceYen: 30800,
    url: "https://buy.stripe.com/5kA8zaaMT2E4gCs5kk",
    amexUrl: "https://buy.stripe.com/5kQ7sL4UgdYq6NK5OMbEA1u",
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
    url: "https://buy.stripe.com/bJe14nfrNctX3qH00B7ok0A",
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

export function formatYen(yen: number): string {
  return `${yen.toLocaleString("ja-JP")}円`;
}

export function allPaymentLinks(): PaymentLinkItem[] {
  return [...PERSONAL_PAYMENT_LINKS, ...OPTION_PAYMENT_LINKS];
}

export function paymentLinkUrl(item: PaymentLinkItem, card: "standard" | "amex"): string {
  return card === "amex" && item.amexUrl ? item.amexUrl : item.url;
}

export function matchPaymentLinkUrl(url: string): { item: PaymentLinkItem; card: "standard" | "amex" } | null {
  const path = buyStripePath(url);
  if (!path) return null;
  for (const item of allPaymentLinks()) {
    if (buyStripePath(item.url) === path) return { item, card: "standard" };
    if (item.amexUrl && buyStripePath(item.amexUrl) === path) return { item, card: "amex" };
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

export function knownPaymentUrls(): string[] {
  const urls: string[] = [];
  for (const item of allPaymentLinks()) {
    urls.push(item.url);
    if (item.amexUrl) urls.push(item.amexUrl);
  }
  return urls;
}
