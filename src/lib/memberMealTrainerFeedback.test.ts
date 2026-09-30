import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildMealDaySummary, buildMealFeedbackLineMessage } from "./memberMealTrainerFeedback.ts";
import type { MemberMealLogView } from "./memberMealLogs.ts";

function meal(partial: Partial<MemberMealLogView>): MemberMealLogView {
  return {
    id: "1",
    log_date: "2026-09-30",
    meal_slot: "lunch",
    photo_url: null,
    photo_urls: [],
    note: null,
    items: ["いか姿2個"],
    kcal: 800,
    protein_g: 40,
    fat_g: 20,
    carb_g: 70,
    alcohol_g: null,
    confidence: null,
    source: "manual",
    created_at: "2026-09-30T03:00:00Z",
    ...partial,
  };
}

describe("buildMealDaySummary", () => {
  it("includes the date, targets, and dishes", () => {
    const text = buildMealDaySummary({
      date: "2026-09-30",
      meals: [meal({})],
      totals: { kcal: 800, protein_g: 40, fat_g: 20, carb_g: 70, meal_count: 1 },
      target: {
        daily_expenditure_kcal: 2500,
        intake_kcal: 2000,
        intake_kcal_min: null,
        intake_kcal_max: null,
        protein_g: 120,
        fat_g: 50,
        carb_g: 268,
        bmr_kcal: null,
        note: null,
        source: "manual",
        updated_at: "2026-09-01",
      },
    });
    assert.match(text, /9\/30（水）の食事/);
    assert.match(text, /摂取 800kcal \/ 目標 2000kcal/);
    assert.match(text, /昼: いか姿2個/);
  });
});

describe("buildMealFeedbackLineMessage", () => {
  it("places the summary and the feedback in one message", () => {
    const text = buildMealFeedbackLineMessage("まとめ", "よく食べられています。");
    assert.match(text, /【今日の食事まとめ】\nまとめ/);
    assert.match(text, /【フィードバック】\nよく食べられています。/);
  });
});
