import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DateTime } from "luxon";
import {
  buildPaymentFailureReport,
  countPaymentStatuses,
  identifyPlanByAmount,
  sumPaidYen,
  tokyoMonthRange,
} from "./membershipPayments.ts";
import { matchPaymentLinkInText, matchPaymentLinkUrl } from "./paymentLinks.ts";

describe("identifyPlanByAmount", () => {
  it("matches list prices, half prices, and the shared 3300 yen plans", () => {
    assert.equal(identifyPlanByAmount(30800)?.planId, "personal-30");
    assert.equal(identifyPlanByAmount(15400)?.planId, "personal-30");
    assert.match(identifyPlanByAmount(15400)?.planName ?? "", /半額/);
    assert.equal(identifyPlanByAmount(58300)?.planId, "personal-60");
    assert.equal(identifyPlanByAmount(29150)?.planId, "personal-60");
    assert.equal(identifyPlanByAmount(16000)?.planId, "monthly-4");
    assert.equal(identifyPlanByAmount(8000)?.planId, "monthly-4");
    assert.equal(identifyPlanByAmount(3300)?.planId, null);
    assert.match(identifyPlanByAmount(3300)?.planName ?? "", /休会1ヶ月/);
    assert.match(identifyPlanByAmount(3300)?.planName ?? "", /ウェアレンタル/);
    assert.equal(identifyPlanByAmount(1650)?.planId, null);
    assert.equal(identifyPlanByAmount(980), null);
    assert.equal(identifyPlanByAmount(9800), null);
    assert.equal(identifyPlanByAmount(500), null);
  });
});

describe("matchPaymentLinkUrl", () => {
  it("keeps the replaced monthly-4 link and the Fukuoka link on the same plans", () => {
    assert.equal(matchPaymentLinkUrl("https://buy.stripe.com/bJe14nfrNctX3qH00B7ok0A")?.item.id, "monthly-4");
    assert.equal(matchPaymentLinkUrl("https://buy.stripe.com/3cI00j3J5gKd2mD3cN7ok0B")?.item.id, "monthly-4");
    assert.equal(matchPaymentLinkUrl("https://buy.stripe.com/fZu4gz3bI1CN6U53MZcEw02")?.item.id, "personal-30");
  });
});

describe("sumPaidYen", () => {
  it("sums paid amounts and ignores guidance and failures", () => {
    const total = sumPaidYen([
      { status: "paid", amount_yen: 15400, price_yen: 30800 },
      { status: "paid", amount_yen: null, price_yen: 16000 },
      { status: "failed", amount_yen: 30800, price_yen: 30800 },
      { status: "guided", amount_yen: null, price_yen: 58300 },
    ]);
    assert.equal(total, 31400);
    assert.deepEqual(
      countPaymentStatuses([
        { status: "paid" },
        { status: "failed" },
        { status: "failed" },
        { status: "guided" },
      ]),
      { guided: 1, paid: 1, failed: 2 }
    );
  });
});

describe("tokyoMonthRange", () => {
  it("uses the Tokyo calendar month", () => {
    const range = tokyoMonthRange(DateTime.fromISO("2026-11-10T20:00:00", { zone: "Asia/Tokyo" }));
    assert.equal(range.label, "2026年11月");
    assert.equal(range.startIso, "2026-10-31T15:00:00.000Z");
    assert.equal(range.endIso, "2026-11-30T15:00:00.000Z");
  });
});

describe("buildPaymentFailureReport", () => {
  it("tells staff where to send the next payment link", () => {
    const text = buildPaymentFailureReport({
      planName: "30分通い放題・月10回",
      amountYen: 30800,
      email: "yamada@example.com",
      memberLabel: "山田（SHI001）",
      storeName: "新宿",
    });
    assert.match(text, /【決済失敗】/);
    assert.match(text, /山田（SHI001）/);
    assert.match(text, /管理画面の決済リンクから、決済案内を送れます/);
  });
});

describe("matchPaymentLinkInText", () => {
  it("finds the payment link written in a LINE message", () => {
    const matched = matchPaymentLinkInText("お支払いはこちら\nhttps://buy.stripe.com/5kA8zaaMT2E4gCs5kk");
    assert.equal(matched?.item.id, "personal-30");
    assert.equal(matched?.card, "standard");
    const amex = matchPaymentLinkInText("https://buy.stripe.com/5kQ7sL4UgdYq6NK5OMbEA1u");
    assert.equal(amex?.card, "amex");
  });
});
