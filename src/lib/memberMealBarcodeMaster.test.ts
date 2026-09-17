import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  canonicalMealBarcode,
  mealBarcodeProductToEstimate,
  mealEstimateProductName,
} from "./memberMealBarcodeMaster.ts";

describe("canonicalMealBarcode", () => {
  it("strips a leading zero from GTIN-14", () => {
    assert.equal(canonicalMealBarcode("04970934021869"), "4970934021869");
    assert.equal(canonicalMealBarcode("4970934021869"), "4970934021869");
  });
});

describe("mealEstimateProductName", () => {
  it("prefers item_details name", () => {
    assert.equal(
      mealEstimateProductName({
        kcal: 83,
        protein_g: 18.5,
        fat_g: 0.8,
        carb_g: 0.3,
        alcohol_g: null,
        items: ["別の名前"],
        item_details: [
          {
            name: "セブンプレミアム サラダチキン",
            kcal: 83,
            protein_g: 18.5,
            fat_g: 0.8,
            carb_g: 0.3,
            source: "catalog",
          },
        ],
        confidence: 0.95,
        note: "",
      }),
      "セブンプレミアム サラダチキン"
    );
  });
});

describe("mealBarcodeProductToEstimate", () => {
  it("turns a saved JAN into a confirmable estimate", () => {
    const estimate = mealBarcodeProductToEstimate({
      barcode: "4901777234826",
      name: "セブンプレミアム サラダチキン",
      kcal: 83,
      protein_g: 18.5,
      fat_g: 0.8,
      carb_g: 0.3,
    });
    assert.equal(estimate.items[0], "セブンプレミアム サラダチキン");
    assert.equal(estimate.kcal, 83);
    assert.equal(estimate.protein_g, 18.5);
    assert.match(estimate.note, /過去の記録/);
  });
});
