import {
  formatYen,
  paymentLinkUrl,
  type PaymentCoupon,
  type PaymentLinkItem,
} from "./paymentLinks";

export const PAYMENT_SEND_REASONS = [
  { id: "payment_failed", label: "決済失敗" },
  { id: "card_change", label: "カード変更" },
  { id: "plan_change", label: "プラン変更" },
  { id: "new_enrollment", label: "新規入会" },
] as const;

export type PaymentSendReason = (typeof PAYMENT_SEND_REASONS)[number]["id"];

const REASON_BODY: Record<PaymentSendReason, string> = {
  payment_failed:
    "お支払いが完了できませんでした。\nお手数ですが、下記のリンクから再度お支払いをお願いいたします。\n前のカードでのお支払いは止めます。",
  card_change:
    "お支払いカードの変更を承りました。\n下記のリンクから、新しいカードでお支払いをお願いいたします。\n前のカードでのお支払いは止めます。",
  plan_change:
    "プラン変更を承りました。\n下記のリンクから、変更後のプランのお支払いをお願いいたします。\n前のカードでのお支払いは止めます。",
  new_enrollment: "ご入会ありがとうございます😊\n下記のリンクから、入会のお支払いをお願いいたします。",
};

export function memberHonorific(name: string | null | undefined): string {
  const trimmed = String(name ?? "").trim();
  return trimmed ? `${trimmed}様` : "会員様";
}

export function buildPaymentLinkLineMessage(params: {
  memberName?: string | null;
  reason: PaymentSendReason;
  item: PaymentLinkItem;
  card: "standard" | "amex";
  coupon?: PaymentCoupon | null;
}): string {
  const card = params.card === "amex" && params.item.amexUrl ? "amex" : "standard";
  const url = paymentLinkUrl(params.item, card);
  const lines = [
    "お世話になっております！",
    "Abodyです😊",
    "",
    memberHonorific(params.memberName),
    "",
    REASON_BODY[params.reason],
    "",
    "【お支払い内容】",
    params.item.name,
    formatYen(params.item.priceYen),
    "",
  ];
  if (card === "amex") {
    lines.push("アメリカン・エキスプレスのカードは、こちらのリンクからお支払いください。", "");
  }
  lines.push("決済リンク", url);
  if (params.coupon) {
    lines.push(
      "",
      "【クーポンコード】",
      params.coupon.code,
      `${params.coupon.label}です。決済画面のクーポン欄にご入力ください。`
    );
  }
  lines.push("", "ご不明点がございましたら、お気軽にご連絡ください！");
  return lines.join("\n");
}
