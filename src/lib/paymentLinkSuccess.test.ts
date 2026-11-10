import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PERSONAL_PAYMENT_LINKS } from "./paymentLinks.ts";
import { buildPaymentSuccessReport } from "./paymentLinkSuccess.ts";
import { matchPaymentLinkUrl } from "./paymentLinks.ts";

describe("matchPaymentLinkUrl", () => {
  it("matches the normal and Amex links", () => {
    const plan = PERSONAL_PAYMENT_LINKS[0]!;
    assert.equal(matchPaymentLinkUrl(plan.url)?.card, "standard");
    assert.equal(matchPaymentLinkUrl(`${plan.amexUrl}?prefilled_promo_code=Hangaku`)?.card, "amex");
    assert.equal(matchPaymentLinkUrl("https://buy.stripe.com/not-ours"), null);
  });
});

describe("buildPaymentSuccessReport", () => {
  it("asks to stop the previous card and shows a discounted amount", () => {
    const text = buildPaymentSuccessReport({
      planName: "30分通い放題・月10回",
      priceYen: 30800,
      cardLabel: "通常",
      amountPaidYen: 15400,
      payerName: "山田",
      email: "yamada@example.com",
      memberLabel: "山田（SHI001）",
      storeName: "新宿",
    });
    assert.match(text, /【決済成功】/);
    assert.match(text, /30分通い放題・月10回/);
    assert.match(text, /金額: 30,800円/);
    assert.match(text, /支払額: 15,400円/);
    assert.match(text, /会員: 山田（SHI001）/);
    assert.match(text, /前のカードでの支払いは止めてください/);
  });
});
