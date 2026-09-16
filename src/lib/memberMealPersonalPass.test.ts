import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isMealPersonalPassActive, isMemberMealPersonalFullEnabled } from "./memberMealPersonalPass.ts";
import { isMemberMealPersonalPilot, isMemberMealPersonalVisible } from "./memberMealPersonalRollout.ts";

describe("isMealPersonalPassActive", () => {
  const now = new Date("2026-09-16T10:00:00+09:00");

  it("grants access for active and trialing", () => {
    assert.equal(isMealPersonalPassActive({ meal_personal_pass_status: "active" }, now), true);
    assert.equal(isMealPersonalPassActive({ meal_personal_pass_status: "trialing" }, now), true);
    assert.equal(isMealPersonalPassActive({ meal_personal_pass_status: "past_due" }, now), true);
  });

  it("keeps canceled pass until period end", () => {
    assert.equal(
      isMealPersonalPassActive(
        {
          meal_personal_pass_status: "canceled",
          meal_personal_pass_current_period_end: "2026-10-01T00:00:00.000Z",
        },
        now
      ),
      true
    );
    assert.equal(
      isMealPersonalPassActive(
        {
          meal_personal_pass_status: "canceled",
          meal_personal_pass_current_period_end: "2026-09-01T00:00:00.000Z",
        },
        now
      ),
      false
    );
  });

  it("denies inactive", () => {
    assert.equal(isMealPersonalPassActive({ meal_personal_pass_status: "inactive" }, now), false);
    assert.equal(isMealPersonalPassActive(null, now), false);
  });
});

describe("isMemberMealPersonalFullEnabled", () => {
  it("grants pilot members without a pass", () => {
    assert.equal(isMemberMealPersonalPilot("EBI020"), true);
    assert.equal(isMemberMealPersonalFullEnabled({ memberCode: "EBI020" }), true);
    assert.equal(isMemberMealPersonalFullEnabled({ memberCode: "UEN001" }), false);
  });

  it("grants paid members", () => {
    assert.equal(
      isMemberMealPersonalFullEnabled({
        memberCode: "UEN001",
        pass: { meal_personal_pass_status: "active" },
      }),
      true
    );
  });

  it("shows the entry to any member code", () => {
    assert.equal(isMemberMealPersonalVisible("UEN001"), true);
    assert.equal(isMemberMealPersonalVisible(""), false);
  });
});
