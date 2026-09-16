import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { estimateGoalHearingNutrition } from "./goalHearingNutrition.ts";
import { formPayloadFromGoalHearingResponse, formatIntakeLabel } from "./memberNutritionTargets.ts";

describe("meal personal settings nutrition", () => {
  it("computes TDEE and PFC from current body and goal", () => {
    const form = formPayloadFromGoalHearingResponse({
      primary_goal: "diet",
      weight_direction: "lose",
      current_weight_kg: 60,
      target_weight_kg: 55,
      sex: "female",
      age_years: 30,
      height_cm: 160,
      activity_level: "light",
    });
    assert.ok(form);
    const estimate = estimateGoalHearingNutrition(form);
    assert.ok(estimate);
    assert.equal(estimate.direction, "lose");
    assert.ok(estimate.tdee > 1000);
    assert.ok(estimate.intake_mid < estimate.tdee);
    assert.ok(estimate.protein_g >= 90);
    assert.ok(estimate.fat_g > 0);
    assert.ok(estimate.carb_g > 0);
    assert.match(formatIntakeLabel({
      intake_kcal: estimate.intake_mid,
      intake_kcal_min: estimate.intake_min,
      intake_kcal_max: estimate.intake_max,
    }), /〜/);
  });

  it("uses chosen weight-loss pace for intake", () => {
    const form = formPayloadFromGoalHearingResponse({
      primary_goal: "diet",
      weight_direction: "lose",
      current_weight_kg: 60,
      target_weight_kg: 55,
      sex: "female",
      age_years: 30,
      height_cm: 160,
      activity_level: "light",
    });
    assert.ok(form);
    const slow = estimateGoalHearingNutrition(form, { pace: "slow" });
    const fast = estimateGoalHearingNutrition(form, { pace: "fast" });
    assert.ok(slow && fast);
    assert.ok(slow.intake_mid > fast.intake_mid);
    assert.match(slow.note, /ゆるやかな減量/);
    assert.match(fast.note, /しっかりめの減量/);
  });
});
