import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  coachingActionsForCount,
  collectImprovePoints,
  resolveCoachingFollowup,
  summarizeImprovePoints,
  type CoachingNote,
} from "./sessionCoaching.ts";

function note(partial: Partial<CoachingNote> & Pick<CoachingNote, "id" | "content">): CoachingNote {
  return {
    date: "2026-10-12",
    trainerName: "ゆうと",
    storeName: "上野",
    ...partial,
  };
}

describe("summarizeImprovePoints", () => {
  it("summarizes labeled improvement points with the trainer and date", () => {
    const summary = summarizeImprovePoints(
      collectImprovePoints([
        note({
          id: "n1",
          content: ["【トレーナーからのフィードバック】", "フォームは安定してきた", "", "【改善点】", "肩甲骨を寄せる"].join(
            "\n"
          ),
        }),
      ])
    );
    assert.match(summary.summary, /肩甲骨を寄せる/);
    assert.equal(summary.items[0]?.trainerName, "ゆうと");
    assert.equal(summary.items[0]?.date, "2026-10-12");
    assert.equal(summary.items[0]?.body, "肩甲骨を寄せる");
  });

  it("reads an older feedback block and skips a praise-only line", () => {
    const points = collectImprovePoints([
      note({
        id: "n2",
        content: [
          "【トレーナーからのフィードバック】",
          "肩の動きが良くなった",
          "スクワットは浅めで膝を内側に入れない",
        ].join("\n"),
      }),
    ]);
    assert.equal(points.length, 1);
    assert.match(points[0]?.body ?? "", /浅め/);
    assert.doesNotMatch(points[0]?.body ?? "", /良くなった/);
  });

  it("skips a session that only has praise", () => {
    const points = collectImprovePoints([
      note({
        id: "n3",
        content: ["【痛みや違和感】", "なし", "【トレーナーからのフィードバック】", "肩の動きが良くなった"].join("\n"),
      }),
    ]);
    assert.equal(points.length, 0);
  });

  it("counts the same improvement once and keeps the latest session", () => {
    const summary = summarizeImprovePoints(
      collectImprovePoints([
        note({ id: "old", date: "2026-10-01", content: ["【改善点】", "肩甲骨を寄せる"].join("\n") }),
        note({ id: "new", date: "2026-10-20", trainerName: "たけはる", content: ["【改善点】", "肩甲骨を寄せる"].join("\n") }),
      ])
    );
    assert.equal(summary.items.length, 1);
    assert.equal(summary.items[0]?.trainerName, "たけはる");
    assert.equal(summary.items[0]?.times, 2);
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

describe("resolveCoachingFollowup", () => {
  const base = {
    joinedAt: "2025-04-01",
    membershipStatus: "active",
    hiatusEndAt: null as string | null,
  };

  it("uses last month through the 14th", () => {
    const early = resolveCoachingFollowup({
      ...base,
      todayYmd: "2026-11-03",
      thisMonthCount: 0,
      lastMonthCount: 8,
    });
    assert.equal(early.kind, "none");
    assert.match(early.detail, /先月の予約8回/);

    const low = resolveCoachingFollowup({
      ...base,
      todayYmd: "2026-11-03",
      thisMonthCount: 0,
      lastMonthCount: 2,
    });
    assert.equal(low.kind, "low_booking");
    assert.deepEqual(
      low.actions.map((a) => a.key),
      ["ticket", "next_booking", "proposal", "motivation"]
    );
  });

  it("uses this month from the 15th", () => {
    const mid = resolveCoachingFollowup({
      ...base,
      todayYmd: "2026-11-16",
      thisMonthCount: 2,
      lastMonthCount: 9,
    });
    assert.equal(mid.kind, "low_booking");
    assert.match(mid.detail, /今月の予約は2回/);
  });

  it("treats the first 30 days after joining as a new member", () => {
    const fresh = resolveCoachingFollowup({
      ...base,
      todayYmd: "2026-11-03",
      thisMonthCount: 0,
      lastMonthCount: 1,
      joinedAt: "2026-10-20",
    });
    assert.equal(fresh.kind, "new_member");
    assert.deepEqual(
      fresh.actions.map((a) => a.key),
      ["next_booking", "proposal"]
    );
  });

  it("treats a recent return from hiatus separately from a low count", () => {
    const returned = resolveCoachingFollowup({
      ...base,
      todayYmd: "2026-11-03",
      thisMonthCount: 0,
      lastMonthCount: 0,
      hiatusEndAt: "2026-10-20",
    });
    assert.equal(returned.kind, "returned");
    assert.deepEqual(
      returned.actions.map((a) => a.key),
      ["next_booking", "proposal"]
    );
  });

  it("keeps someone still on hiatus out of the low-visit list", () => {
    const paused = resolveCoachingFollowup({
      ...base,
      todayYmd: "2026-11-03",
      thisMonthCount: 0,
      lastMonthCount: 0,
      membershipStatus: "hiatus",
      hiatusEndAt: "2026-11-20",
    });
    assert.equal(paused.kind, "hiatus");
  });
});
