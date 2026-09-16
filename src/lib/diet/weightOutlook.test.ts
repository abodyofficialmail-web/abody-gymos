import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildWeightOutlook } from "./weightOutlook.ts";

describe("buildWeightOutlook", () => {
  it("projects 1/3/6 months from weekly weight change", () => {
    const outlook = buildWeightOutlook({
      stats: { latest_kg: 60, change_7d_kg: -0.35, logged_days_30: 10 },
    });
    assert.ok(outlook);
    assert.equal(outlook.points.length, 4);
    assert.equal(outlook.points[0].kg, 60);
    assert.ok(outlook.points[1].kg < 60);
    assert.ok(outlook.points[3].kg <= outlook.points[1].kg);
    assert.equal(outlook.source, "weight");
  });

  it("falls back to calorie target when weight history is thin", () => {
    const outlook = buildWeightOutlook({
      stats: { latest_kg: 70, change_7d_kg: null, logged_days_30: 1 },
      tdee: 2200,
      intakeTarget: 1700,
    });
    assert.ok(outlook);
    assert.equal(outlook.source, "target");
    assert.ok(outlook.monthly_kg < 0);
    assert.ok(outlook.points[1].delta_kg < 0);
  });

  it("falls back to recent meals vs TDEE", () => {
    const outlook = buildWeightOutlook({
      stats: { latest_kg: 68, change_7d_kg: null, logged_days_30: 1 },
      tdee: 2300,
      intakeTarget: 1800,
      recentKcalAvg: 1900,
    });
    assert.ok(outlook);
    assert.equal(outlook.source, "meals");
    assert.ok(outlook.monthly_kg < 0);
  });

  it("keeps a flat pending outlook after the first weigh-in", () => {
    const outlook = buildWeightOutlook({
      stats: { latest_kg: 62.4, change_7d_kg: null, logged_days_30: 1 },
    });
    assert.ok(outlook);
    assert.equal(outlook.source, "pending");
    assert.equal(outlook.monthly_kg, 0);
    assert.equal(outlook.points[3].kg, 62.4);
  });
});
