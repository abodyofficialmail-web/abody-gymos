import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isWeightReminderEnabled } from "./weightReminderPreference.ts";

describe("isWeightReminderEnabled", () => {
  it("stops delivery when the member opted out, even if the column is still on", () => {
    assert.equal(isWeightReminderEnabled(true, true), false);
    assert.equal(isWeightReminderEnabled(undefined, true), false);
  });

  it("stops delivery when the column is off", () => {
    assert.equal(isWeightReminderEnabled(false, false), false);
  });

  it("sends when neither the column nor the opt-out mark says off", () => {
    assert.equal(isWeightReminderEnabled(true, false), true);
    assert.equal(isWeightReminderEnabled(undefined, false), true);
    assert.equal(isWeightReminderEnabled(null, false), true);
  });
});
