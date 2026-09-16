import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { areaFromStoreName } from "./storeAreas.ts";
import { suggestNearby } from "./suggestNearby.ts";

describe("suggestNearby", () => {
  it("uses the member store area and returns 2-3 chain picks", () => {
    const { area, suggestions } = suggestNearby({
      area: areaFromStoreName("恵比寿"),
      remaining: { kcal: 550, protein_g: 35, fat_g: 12, carb_g: 40 },
      limit: 3,
    });
    assert.equal(area.key, "ebisu");
    assert.ok(suggestions.length >= 2 && suggestions.length <= 3);
    assert.ok(suggestions.every((s) => s.venue.area === "ebisu"));
    assert.ok(suggestions.every((s) => s.menu.kcal > 0 && s.reason.length > 0));
  });

  it("prefers a menu that fits a low remaining calorie budget", () => {
    const { suggestions } = suggestNearby({
      area: areaFromStoreName("桜木町"),
      remaining: { kcal: 180, protein_g: 25, fat_g: 8, carb_g: 10 },
      limit: 3,
    });
    assert.ok(suggestions[0].menu.kcal <= 300);
  });
});
