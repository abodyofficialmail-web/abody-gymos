import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  formatMemberTrainingNote,
  mergeTrainingLogs,
  parseKarteSessionTraining,
  parseMemberTrainingNote,
} from "./karteTrainingParse.ts";

describe("karte training sync", () => {
  it("round-trips a member training note", () => {
    const content = formatMemberTrainingNote({
      kind: "self",
      parts: ["胸", "肩"],
      duration_min: 60,
      condition: "normal",
      note: "ベンチ中心",
    });
    const parsed = parseMemberTrainingNote(content, { id: "n1", log_date: "2026-09-11" });
    assert.ok(parsed);
    assert.equal(parsed?.kind, "self");
    assert.deepEqual(parsed?.parts, ["胸", "肩"]);
    assert.equal(parsed?.duration_min, 60);
    assert.equal(parsed?.condition, "normal");
    assert.equal(parsed?.note, "ベンチ中心");
    assert.equal(parsed?.source, "app");
  });

  it("parses trainer karte training parts and condition", () => {
    const content = [
      "【今日の体調】",
      "良い",
      "",
      "【本日のトレーニング内容】",
      "部位: 胸 / 背中",
      "",
      "【本日のメニュー】",
      "■ ベンチプレス",
      "  10回 × 40kg",
      "",
      "【トレーニングコンセプト】",
      "上部を意識",
    ].join("\n");
    const parsed = parseKarteSessionTraining(content, { id: "k1", log_date: "2026-09-11" });
    assert.ok(parsed);
    assert.equal(parsed?.kind, "gym");
    assert.deepEqual(parsed?.parts, ["胸", "背中"]);
    assert.equal(parsed?.condition, "good");
    assert.equal(parsed?.source, "karte");
    assert.ok(parsed?.note?.includes("上部を意識"));
  });

  it("lets table logs win over karte on the same date and kind", () => {
    const merged = mergeTrainingLogs(
      [
        {
          id: "t1",
          log_date: "2026-09-11",
          kind: "gym",
          parts: ["脚"],
          duration_min: 50,
          condition: "hard",
          note: "会員入力",
          source: "app",
        },
      ],
      [
        {
          id: "karte:k1",
          log_date: "2026-09-11",
          kind: "gym",
          parts: ["胸"],
          duration_min: null,
          condition: "good",
          note: "カルテ",
          source: "karte",
        },
      ]
    );
    assert.equal(merged.length, 1);
    assert.equal(merged[0].note, "会員入力");
  });
});
