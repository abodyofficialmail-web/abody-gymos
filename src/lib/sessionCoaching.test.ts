import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { coachingActionsForCount, collectCoachingSessions, type CoachingNote } from "./sessionCoaching.ts";

function note(partial: Partial<CoachingNote> & Pick<CoachingNote, "id" | "content">): CoachingNote {
  return {
    date: "2026-10-12",
    trainerName: "ゆうと",
    storeName: "上野",
    ...partial,
  };
}

describe("collectCoachingSessions", () => {
  it("keeps the trainer, date, and the session text that became the caution", () => {
    const sessions = collectCoachingSessions([
      note({
        id: "n1",
        content: [
          "【痛みや違和感】",
          "軽い",
          "【会員とのコミュニケーション内容】",
          "スクワットで右膝が内側に入るので、次は浅めで気をつけたい。",
          "【トレーナーからのフィードバック】",
          "フォームは安定してきた",
        ].join("\n"),
      }),
    ]);
    assert.equal(sessions.length, 1);
    assert.equal(sessions[0]?.trainerName, "ゆうと");
    assert.equal(sessions[0]?.date, "2026-10-12");
    assert.deepEqual(
      sessions[0]?.cautions.map((c) => c.source),
      ["痛みや違和感", "会員との会話"]
    );
    assert.match(sessions[0]?.cautions[1]?.body ?? "", /右膝/);
  });

  it("skips a session that only has praise and no pain", () => {
    const sessions = collectCoachingSessions([
      note({
        id: "n2",
        content: ["【痛みや違和感】", "なし", "【トレーナーからのフィードバック】", "肩の動きが良くなった"].join("\n"),
      }),
    ]);
    assert.equal(sessions.length, 0);
  });

  it("keeps enrollment handoff as its own source", () => {
    const sessions = collectCoachingSessions([
      note({
        id: "n3",
        trainerName: "たけはる",
        content: ["【トレーナー記入欄】", "右肩が上がりやすい。他のトレーナーは肩の高さに注意。"].join("\n"),
      }),
    ]);
    assert.equal(sessions[0]?.cautions[0]?.source, "入会時の引き継ぎ");
    assert.equal(sessions[0]?.trainerName, "たけはる");
  });
});

describe("coachingActionsForCount", () => {
  it("lists follow-up actions when this month is 4 visits or fewer", () => {
    const keys = coachingActionsForCount(2).map((a) => a.key);
    assert.deepEqual(keys, ["ticket", "next_booking", "proposal", "motivation"]);
  });

  it("lists nothing once visits are above the follow-up line", () => {
    assert.deepEqual(coachingActionsForCount(5), []);
  });
});
