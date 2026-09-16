import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildMealDayPlan, leftoverSlots } from "./suggestPlan.ts";

describe("leftoverSlots", () => {
  it("keeps lunch and dinner in the afternoon if not logged", () => {
    assert.deepEqual(leftoverSlots(14, ["breakfast"]), ["lunch", "dinner", "snack"]);
  });

  it("drops breakfast after morning", () => {
    assert.equal(leftoverSlots(12, []).includes("breakfast"), false);
  });
});

describe("buildMealDayPlan", () => {
  const nutrition = {
    member_id: "x",
    intake_kcal: 1800,
    protein_g: 110,
    fat_g: 50,
    carb_g: 180,
  };

  it("splits remaining dinner budget into a fitting meal", () => {
    const plan = buildMealDayPlan({
      hour: 18,
      todayMeals: [{ meal_slot: "breakfast" }, { meal_slot: "lunch" }],
      totals: { kcal: 1200, protein_g: 70, fat_g: 30, carb_g: 140, meal_count: 2 },
      remaining: { kcal: 600, protein_g: 40, fat_g: 20, carb_g: 40 },
      nutrition: nutrition as never,
    });
    assert.ok(plan.meals.length >= 1);
    assert.ok(plan.meals[0].kcal <= 700);
    assert.ok(plan.steps.length >= 1);
    assert.match(plan.headline, /600kcal/);
  });

  it("recommends stopping when already over target", () => {
    const plan = buildMealDayPlan({
      hour: 20,
      todayMeals: [{ meal_slot: "dinner" }],
      totals: { kcal: 2100, protein_g: 90, fat_g: 70, carb_g: 220, meal_count: 3 },
      remaining: { kcal: -300, protein_g: 20, fat_g: -20, carb_g: -40 },
      nutrition: nutrition as never,
    });
    assert.match(plan.headline, /超えて/);
    assert.ok(plan.meals[0].kcal <= 200);
  });
});
