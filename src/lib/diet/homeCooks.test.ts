import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { cookpadSearchUrl, suggestHomeCooks, youtubeSearchUrl } from "./homeCooks.ts";

describe("suggestHomeCooks", () => {
  it("returns homemade meals with ingredients, steps, and recipe links", () => {
    const meals = suggestHomeCooks({ kcal: 500, protein_g: 35, fat_g: 15, carb_g: 40 }, 3);
    assert.equal(meals.length, 3);
    assert.ok(
      meals.every(
        (m) =>
          m.howto.length > 0 &&
          m.kcal > 0 &&
          m.ingredients.length > 0 &&
          m.steps.length > 0 &&
          m.cookpadQuery.length > 0 &&
          m.youtubeQuery.length > 0 &&
          (m.youtubeId || m.imageUrl),
      ),
    );
  });

  it("prefers a light dish when remaining calories are low", () => {
    const meals = suggestHomeCooks({ kcal: 180, protein_g: 22, fat_g: 8, carb_g: 10 }, 3);
    assert.ok(meals[0].kcal <= 320);
  });

  it("builds cookpad and youtube search urls", () => {
    assert.ok(cookpadSearchUrl("鶏むね レンジ").includes("cookpad.com"));
    assert.ok(youtubeSearchUrl("鶏むね レンジ").includes("youtube.com"));
  });
});
