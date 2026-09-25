import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  OCTOBER_EARLY_ACCESS_CODES,
  isOctoberEarlyAccessCode,
  isOctoberEarlyAccessDate,
} from "./octoberEarlyAccess.ts";

describe("october early access", () => {
  it("matches only October 2026 dates", () => {
    assert.equal(isOctoberEarlyAccessDate("2026-10-01"), true);
    assert.equal(isOctoberEarlyAccessDate("2026-10-31"), true);
    assert.equal(isOctoberEarlyAccessDate("2026-09-30"), false);
    assert.equal(isOctoberEarlyAccessDate("2026-11-01"), false);
  });

  it("includes the granted members and nobody else", () => {
    assert.equal(OCTOBER_EARLY_ACCESS_CODES.length, 36);
    assert.equal(isOctoberEarlyAccessCode("EBI034"), true);
    assert.equal(isOctoberEarlyAccessCode("SAK002"), true);
    assert.equal(isOctoberEarlyAccessCode("UEN027"), false);
  });
});
