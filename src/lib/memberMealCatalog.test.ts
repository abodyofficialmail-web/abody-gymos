import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { applyMealCatalog, resolveDishGrams } from "./memberMealCatalog.ts";
import { applyMextFoods } from "./memberMealFoodDb.ts";
import { sanitizeMealEstimate, type MealEstimate } from "./memberMealEstimate.ts";

function estimate(items: MealEstimate["item_details"]): MealEstimate {
  return {
    kcal: items.reduce((a, i) => a + i.kcal, 0),
    protein_g: items.reduce((a, i) => a + i.protein_g, 0),
    fat_g: items.reduce((a, i) => a + i.fat_g, 0),
    carb_g: items.reduce((a, i) => a + i.carb_g, 0),
    alcohol_g: null,
    items: items.map((i) => i.name),
    item_details: items,
    confidence: 0.5,
    note: "",
  };
}

describe("resolveDishGrams", () => {
  it("uses 50g edible portion per egg, not 60g with shell", () => {
    assert.equal(resolveDishGrams("ゆで卵", [{ menu: "卵", grams: null, count: 2, count_unit: "個" }]), 100);
    assert.equal(resolveDishGrams("卵2個", []), 100);
    assert.equal(resolveDishGrams("ゆで卵×2", []), 100);
  });

  it("does not apply egg count to rice in the same meal", () => {
    const dishes = [
      { menu: "ご飯", grams: 150, count: null, count_unit: "個" },
      { menu: "卵", grams: null, count: 2, count_unit: "個" },
    ];
    assert.equal(resolveDishGrams("白米", dishes), 150);
    assert.equal(resolveDishGrams("ご飯", dishes), 150);
    assert.equal(resolveDishGrams("卵", dishes), 100);
  });
});

describe("applyMealCatalog eggs", () => {
  it("counts two boiled eggs as about 151kcal with almost no carbs", () => {
    const next = applyMealCatalog(
      estimate([{ name: "ゆで卵2個", kcal: 300, protein_g: 20, fat_g: 20, carb_g: 8, source: "ai" }])
    );
    assert.equal(next.item_details[0]?.source, "catalog");
    assert.equal(next.kcal, 151);
    assert.ok(next.protein_g >= 12 && next.protein_g <= 13);
    assert.ok(next.carb_g <= 0.5);
    assert.match(next.item_details[0]?.name ?? "", /2個/);
  });

  it("infers two eggs from AI macros when the name has no count", () => {
    const next = applyMealCatalog(
      estimate([{ name: "卵", kcal: 150, protein_g: 12, fat_g: 10, carb_g: 1, source: "ai" }])
    );
    assert.equal(next.kcal, 151);
    assert.match(next.item_details[0]?.name ?? "", /2個/);
  });

  it("does not treat tamagoyaki as one raw egg", () => {
    const next = applyMealCatalog(
      estimate([{ name: "卵焼き", kcal: 220, protein_g: 14, fat_g: 14, carb_g: 8, source: "ai" }])
    );
    assert.equal(next.item_details[0]?.source, "ai");
    assert.equal(next.kcal, 220);
  });
});

describe("applyMextFoods eggs", () => {
  it("keeps two-egg quantity instead of collapsing to one", () => {
    const next = applyMextFoods(
      estimate([{ name: "ゆで卵2個", kcal: 300, protein_g: 20, fat_g: 20, carb_g: 8, source: "ai" }])
    );
    assert.equal(next.kcal, 151);
    assert.ok(next.carb_g <= 0.5);
  });
});

describe("sanitizeMealEstimate", () => {
  it("copies count into the item name so later scaling can see it", () => {
    const next = sanitizeMealEstimate({
      kcal: 80,
      protein_g: 6,
      fat_g: 5,
      carb_g: 0.2,
      items: [{ name: "ゆで卵", count: 2, kcal: 80, protein_g: 6, fat_g: 5, carb_g: 0.2 }],
    });
    assert.ok(next);
    assert.match(next?.items[0] ?? "", /2個/);
  });
});
