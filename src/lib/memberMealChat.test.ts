import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  parseMealChatAction,
  parseMealChatPayload,
  resolveMealChatTargets,
} from "./memberMealChat.ts";
import type { MemberMealLogView } from "./memberMealLogs.ts";

function meal(partial: Partial<MemberMealLogView> & Pick<MemberMealLogView, "id" | "meal_slot" | "log_date">): MemberMealLogView {
  return {
    photo_url: null,
    photo_urls: [],
    note: null,
    items: ["鶏むね"],
    kcal: 400,
    protein_g: 40,
    fat_g: 8,
    carb_g: 20,
    alcohol_g: null,
    confidence: 0.8,
    source: "ai",
    created_at: "2026-09-09T01:00:00.000Z",
    ...partial,
  };
}

describe("parseMealChatAction", () => {
  it("maps delete aliases", () => {
    assert.equal(parseMealChatAction("delete"), "delete");
    assert.equal(parseMealChatAction("delete_meal"), "delete");
    assert.equal(parseMealChatAction("remove"), "delete");
  });

  it("maps update aliases", () => {
    assert.equal(parseMealChatAction("update"), "update");
    assert.equal(parseMealChatAction("correct"), "update");
    assert.equal(parseMealChatAction(null), null);
  });
});

describe("parseMealChatPayload", () => {
  it("keeps ready false when action is set", () => {
    const parsed = parseMealChatPayload({
      reply: "昼ごはんを消します",
      ready: true,
      action: "delete",
      target_slot: "lunch",
      items: [{ name: "ラーメン", kcal: 800, protein_g: 20, fat_g: 20, carb_g: 120 }],
    });
    assert.ok(parsed);
    assert.equal(parsed?.action, "delete");
    assert.equal(parsed?.target_slot, "lunch");
    assert.equal(parsed?.ready, false);
  });

  it("reads patch numbers for update", () => {
    const parsed = parseMealChatPayload({
      reply: "カロリーを直します",
      action: "update",
      target_slot: "lunch",
      kcal: 600,
    });
    assert.ok(parsed);
    assert.equal(parsed?.action, "update");
    assert.equal(parsed?.patch.kcal, 600);
    assert.equal(parsed?.patch.protein_g, null);
  });
});

describe("resolveMealChatTargets", () => {
  const today = "2026-09-09";
  const meals = [
    meal({ id: "lunch-1", meal_slot: "lunch", log_date: today, created_at: "2026-09-09T03:00:00.000Z" }),
    meal({ id: "lunch-2", meal_slot: "lunch", log_date: today, created_at: "2026-09-09T04:00:00.000Z" }),
    meal({ id: "dinner-1", meal_slot: "dinner", log_date: today, items: ["寿司"] }),
    meal({ id: "yest-1", meal_slot: "lunch", log_date: "2026-09-08" }),
  ];

  it("returns none without action", () => {
    const res = resolveMealChatTargets({ meals, action: null, today });
    assert.equal(res.ok, false);
    if (!res.ok) assert.equal(res.reason, "none");
  });

  it("deletes all meals in a slot", () => {
    const res = resolveMealChatTargets({ meals, action: "delete", slot: "lunch", today });
    assert.equal(res.ok, true);
    if (res.ok) assert.deepEqual(res.meals.map((m) => m.id), ["lunch-1", "lunch-2"]);
  });

  it("updates the latest meal in a slot", () => {
    const res = resolveMealChatTargets({ meals, action: "update", slot: "lunch", today });
    assert.equal(res.ok, true);
    if (res.ok) assert.deepEqual(res.meals.map((m) => m.id), ["lunch-2"]);
  });

  it("matches meal id prefix", () => {
    const res = resolveMealChatTargets({ meals, action: "delete", mealId: "dinner-1", today });
    assert.equal(res.ok, true);
    if (res.ok) assert.equal(res.meals[0]?.id, "dinner-1");
  });

  it("finds yesterday by date", () => {
    const res = resolveMealChatTargets({ meals, action: "delete", slot: "lunch", logDate: "2026-09-08", today });
    assert.equal(res.ok, true);
    if (res.ok) assert.deepEqual(res.meals.map((m) => m.id), ["yest-1"]);
  });

  it("returns not_found when slot is empty", () => {
    const res = resolveMealChatTargets({ meals, action: "delete", slot: "breakfast", today });
    assert.equal(res.ok, false);
    if (!res.ok) assert.equal(res.reason, "not_found");
  });
});
