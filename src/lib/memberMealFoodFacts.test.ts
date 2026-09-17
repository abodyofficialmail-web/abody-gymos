import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isJapaneseRetailBarcode, isMealBarcode, mealBarcodeLookupCodes } from "./memberMealFoodFacts.ts";

describe("mealBarcodeLookupCodes", () => {
  it("keeps a 13-digit JAN and also tries GTIN-14", () => {
    assert.deepEqual(mealBarcodeLookupCodes("4970934021869"), ["4970934021869", "04970934021869"]);
  });

  it("tries EAN-13 for a 12-digit UPC", () => {
    assert.deepEqual(mealBarcodeLookupCodes("123456789012"), ["123456789012", "0123456789012"]);
  });

  it("strips a leading zero from GTIN-14", () => {
    assert.deepEqual(mealBarcodeLookupCodes("04970934021869"), ["04970934021869", "4970934021869"]);
  });
});

describe("isMealBarcode", () => {
  it("accepts 8 to 14 digits", () => {
    assert.equal(isMealBarcode("4970934021869"), true);
    assert.equal(isMealBarcode("1234567"), false);
    assert.equal(isMealBarcode("abc"), false);
  });
});

describe("isJapaneseRetailBarcode", () => {
  it("accepts JAN codes that start with 45 or 49", () => {
    assert.equal(isJapaneseRetailBarcode("4901777234826"), true);
    assert.equal(isJapaneseRetailBarcode("4512345678901"), true);
    assert.equal(isJapaneseRetailBarcode("04901777234826"), true);
    assert.equal(isJapaneseRetailBarcode("1234567890123"), false);
    assert.equal(isJapaneseRetailBarcode("012345678905"), false);
  });
});
