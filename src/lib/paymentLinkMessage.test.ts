import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PERSONAL_PAYMENT_LINKS, PAYMENT_COUPONS } from "./paymentLinks.ts";
import { buildPaymentLinkLineMessage } from "./paymentLinkMessage.ts";

const plan = PERSONAL_PAYMENT_LINKS[0]!;

describe("buildPaymentLinkLineMessage", () => {
  it("writes a retry message for a failed payment", () => {
    const text = buildPaymentLinkLineMessage({
      memberName: "山田",
      reason: "payment_failed",
      item: plan,
      card: "standard",
    });
    assert.match(text, /山田様/);
    assert.match(text, /お支払いが完了できませんでした/);
    assert.match(text, /前のカードでのお支払いは止めます/);
    assert.match(text, /30分通い放題・月10回/);
    assert.match(text, /30,800円/);
    assert.match(text, new RegExp(plan.url));
    assert.doesNotMatch(text, /アメリカン・エキスプレス/);
  });

  it("uses the Amex link and coupon when those are selected", () => {
    const text = buildPaymentLinkLineMessage({
      memberName: "",
      reason: "card_change",
      item: plan,
      card: "amex",
      coupon: PAYMENT_COUPONS[0],
    });
    assert.match(text, /会員様/);
    assert.match(text, /新しいカードでお支払い/);
    assert.match(text, /アメリカン・エキスプレス/);
    assert.match(text, new RegExp(plan.amexUrl!));
    assert.match(text, /Hangaku/);
    assert.doesNotMatch(text, new RegExp(plan.url));
  });

  it("describes a plan change", () => {
    const text = buildPaymentLinkLineMessage({
      memberName: "佐藤",
      reason: "plan_change",
      item: plan,
      card: "standard",
    });
    assert.match(text, /プラン変更を承りました/);
    assert.match(text, /変更後のプラン/);
  });
});
