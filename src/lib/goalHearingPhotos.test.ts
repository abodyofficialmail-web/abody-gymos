import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isGoalHearingKarteContent,
  normalizeGoalPhotoRef,
  parseGoalPhotoPaths,
} from "./goalHearingPhotos.ts";

describe("goal hearing karte pin", () => {
  it("detects goal hearing notes and ignores session notes", () => {
    assert.equal(isGoalHearingKarteContent("【目標ヒアリング 2026-08-04】\n【会員】"), true);
    assert.equal(isGoalHearingKarteContent("【セッション】今日は胸"), false);
    assert.equal(isGoalHearingKarteContent("【目標ヒアリングのお願い】"), false);
  });
});

describe("goal photo paths", () => {
  it("parses array, json string, and single path", () => {
    assert.deepEqual(parseGoalPhotoPaths(["a.jpg", "", "b.jpg"]), ["a.jpg", "b.jpg"]);
    assert.deepEqual(parseGoalPhotoPaths('["x.jpg","y.jpg"]'), ["x.jpg", "y.jpg"]);
    assert.deepEqual(parseGoalPhotoPaths("member/goal-hearing/id/0.jpg"), ["member/goal-hearing/id/0.jpg"]);
  });

  it("keeps http urls and strips bucket prefix", () => {
    assert.deepEqual(normalizeGoalPhotoRef("https://example.com/p.jpg"), { url: "https://example.com/p.jpg" });
    assert.deepEqual(normalizeGoalPhotoRef("/member-body-photos/abc/0.jpg"), { path: "abc/0.jpg" });
  });
});
