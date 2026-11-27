import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DECEMBER_EARLY_AT_ISO,
  DECEMBER_LOW_USAGE_MAX,
  DECEMBER_PUBLIC_AT_ISO,
  decemberBookingPhase,
  isDecemberBookingMonth,
  isTokyoDecemberStore,
} from "./decemberEarlyAccess.ts";

describe("december booking release", () => {
  it("opens to low-usage members at 10:00 and to everyone at 18:00 JST on 2026-11-27", () => {
    assert.equal(decemberBookingPhase(new Date("2026-11-27T09:59:59+09:00")), "hidden");
    assert.equal(decemberBookingPhase(new Date(DECEMBER_EARLY_AT_ISO)), "early");
    assert.equal(decemberBookingPhase(new Date("2026-11-27T17:59:59+09:00")), "early");
    assert.equal(decemberBookingPhase(new Date(DECEMBER_PUBLIC_AT_ISO)), "public");
    assert.equal(decemberBookingPhase(new Date("2026-12-01T00:00:00+09:00")), "public");
    assert.equal(decemberBookingPhase(new Date(Number.NaN)), "hidden");
    assert.equal(DECEMBER_LOW_USAGE_MAX, 8);
  });

  it("targets December at the Tokyo 4 stores", () => {
    assert.equal(isDecemberBookingMonth("2026-12"), true);
    assert.equal(isDecemberBookingMonth("2026-12-01"), true);
    assert.equal(isDecemberBookingMonth("2026-11-30"), false);
    assert.equal(isTokyoDecemberStore("新宿"), true);
    assert.equal(isTokyoDecemberStore("福岡"), false);
  });
});
