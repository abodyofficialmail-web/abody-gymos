import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildGoalHearingMondayMessage,
  openingLineForGoal,
  type GoalHearingMondayResponse,
} from "./goalHearingMondayMessage.ts";

function base(overrides: Partial<GoalHearingMondayResponse> = {}): GoalHearingMondayResponse {
  return {
    primary_goal: "muscle",
    focus_areas: ["肩・胸", "二の腕", "背中"],
    meal_change: "protein",
    pain_areas: ["ない"],
    training_styles: ["トレーニングだけで進めたい"],
    ideal_frequency: "2",
    preferred_slots: ["平日の18時〜21時"],
    ...overrides,
  };
}

describe("goal hearing Monday copy", () => {
  it("changes the opening by primary goal", () => {
    assert.equal(openingLineForGoal("diet"), "目標の引き締まった体に、近づく週です。");
    assert.equal(openingLineForGoal("muscle"), "厚みのある体に、近づける週です。");
    assert.equal(openingLineForGoal("posture"), "無理なく整えていく週です。");
  });

  it("uses muscle needs, protein, and booked week for SHI002-like copy", () => {
    const text = buildGoalHearingMondayMessage({
      response: base(),
      weekReservationCount: 3,
    });
    assert.match(text, /厚みのある体/);
    assert.match(text, /筋肉をつけたい/);
    assert.match(text, /今週はもう3枠/);
    assert.match(text, /肩・胸・二の腕・背中/);
    assert.match(text, /たんぱく質/);
    assert.doesNotMatch(text, /腰まわり/);
  });

  it("uses diet copy, snack, and preferred slot when no booking", () => {
    const text = buildGoalHearingMondayMessage({
      response: base({
        primary_goal: "diet",
        focus_areas: ["お腹まわり"],
        meal_change: "snack",
        goal_reason: "event",
      }),
      weekReservationCount: 0,
    });
    assert.match(text, /引き締まった体/);
    assert.match(text, /ダイエット・引き締め/);
    assert.match(text, /まず1枠/);
    assert.match(text, /平日の18時〜21時/);
    assert.match(text, /間食/);
    assert.match(text, /イベント/);
  });

  it("mentions the actual pain area instead of always 腰", () => {
    const text = buildGoalHearingMondayMessage({
      response: base({
        primary_goal: "posture",
        pain_areas: ["膝"],
        training_styles: ["ストレッチも取り入れたい"],
        focus_areas: ["姿勢"],
      }),
      weekReservationCount: 1,
    });
    assert.match(text, /無理なく整えて/);
    assert.match(text, /膝は無理せず/);
    assert.match(text, /ストレッチ/);
    assert.doesNotMatch(text, /腰/);
  });

  it("asks for another slot when one booking is below weekly ideal", () => {
    const text = buildGoalHearingMondayMessage({
      response: base({ ideal_frequency: "3" }),
      weekReservationCount: 1,
    });
    assert.match(text, /今週1枠/);
    assert.match(text, /週3の理想ペース/);
  });
});
