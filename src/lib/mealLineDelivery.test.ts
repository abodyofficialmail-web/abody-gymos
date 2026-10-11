import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  MEAL_LINE_DELIVERY_TRIAL_BUTTON,
  MEAL_LINE_DELIVERY_TRIAL_MS,
  isMealLineDeliveryEntitled,
  isMealLineDeliveryTrialActive,
  mealLineDeliveryTrialEndsAt,
  mealLineDeliveryView,
} from "./mealLineDelivery.ts";

describe("meal line delivery trial", () => {
  const started = new Date("2026-10-11T08:00:00.000Z");

  it("labels the button as one week and lasts three days", () => {
    assert.equal(MEAL_LINE_DELIVERY_TRIAL_BUTTON, "1週間無料お試し");
    assert.equal(MEAL_LINE_DELIVERY_TRIAL_MS, 3 * 24 * 60 * 60 * 1000);
    assert.equal(mealLineDeliveryTrialEndsAt(started).toISOString(), "2026-10-14T08:00:00.000Z");
  });

  it("sends during the three days and stops after", () => {
    const ends = mealLineDeliveryTrialEndsAt(started).toISOString();
    assert.equal(isMealLineDeliveryTrialActive(ends, new Date("2026-10-14T07:59:00.000Z")), true);
    assert.equal(isMealLineDeliveryTrialActive(ends, new Date("2026-10-14T08:00:00.000Z")), false);
  });

  it("entitles a member without the paid pass only while the trial is open", () => {
    const ends = mealLineDeliveryTrialEndsAt(started).toISOString();
    assert.equal(
      isMealLineDeliveryEntitled({
        memberCode: "SAK065",
        pass: { meal_personal_pass_status: "inactive" },
        trialEndsAt: ends,
        now: new Date("2026-10-12T00:00:00.000Z"),
      }),
      true
    );
    assert.equal(
      isMealLineDeliveryEntitled({
        memberCode: "SAK065",
        pass: { meal_personal_pass_status: "inactive" },
        trialEndsAt: ends,
        now: new Date("2026-10-15T00:00:00.000Z"),
      }),
      false
    );
  });

  it("keeps paid members entitled and marks a used trial as expired", () => {
    const paid = mealLineDeliveryView({
      memberCode: "SAK065",
      pass: { meal_personal_pass_status: "active" },
      now: started,
    });
    assert.equal(paid.status, "active");
    assert.equal(paid.entitled, true);
    assert.equal(paid.subscribe_url, null);

    const expired = mealLineDeliveryView({
      memberCode: "SAK065",
      trialStartedAt: started.toISOString(),
      trialEndsAt: mealLineDeliveryTrialEndsAt(started).toISOString(),
      now: new Date("2026-10-20T00:00:00.000Z"),
    });
    assert.equal(expired.status, "expired");
    assert.equal(expired.trial_used, true);
    assert.equal(expired.entitled, false);
  });
});
