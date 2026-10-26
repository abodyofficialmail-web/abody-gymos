import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatPreSessionFocusParts } from "./preSessionSurvey.ts";
import {
  encodeRequestFocus,
  formatPreSessionFormatBadge,
  formatPreSessionSurveyDetailLines,
  normalizePreSessionFormat,
  resolvePreSessionHearing,
  type PreSessionSurveyForKarte,
} from "./preSessionSurveyDisplay.ts";

function sample(overrides: Partial<PreSessionSurveyForKarte> = {}): PreSessionSurveyForKarte {
  return {
    id: "1",
    reservation_id: "r1",
    session_date: "2026-10-05",
    session_start_at: "2026-10-05T00:00:00.000Z",
    condition_score: 4,
    meal_status: "eaten",
    intensity_preference: "moderate",
    session_format: null,
    request_focus: null,
    concern: null,
    free_comment: null,
    trainer_name: "たけはる",
    store_name: "桜木町",
    created_at: "2026-10-05T00:00:00.000Z",
    ...overrides,
  };
}

describe("pre-session hearing display", () => {
  it("keeps the format optional", () => {
    assert.equal(normalizePreSessionFormat(null), null);
    assert.equal(normalizePreSessionFormat(""), null);
    assert.equal(normalizePreSessionFormat("training"), "training");
    const lines = formatPreSessionSurveyDetailLines(sample());
    assert.equal(lines.some((line) => line.startsWith("希望:")), false);
  });

  it("shows training, stretch, or both with the requested area", () => {
    assert.equal(formatPreSessionFormatBadge("training"), "トレーニング");
    assert.equal(formatPreSessionFormatBadge("stretch"), "ストレッチ");
    assert.equal(formatPreSessionFormatBadge("both"), "トレーニング・ストレッチ");
    const lines = formatPreSessionSurveyDetailLines(
      sample({ session_format: "both", request_focus: "肩・胸" })
    );
    assert.ok(lines.includes("希望: どっちも"));
    assert.ok(lines.includes("希望部位: 肩・胸"));
  });

  it("keeps selected body parts in option order", () => {
    assert.equal(formatPreSessionFocusParts(["肩", "胸", "腰"]), "胸 / 肩 / 腰");
    assert.equal(formatPreSessionFocusParts([]), null);
    assert.equal(formatPreSessionFocusParts(["不明"]), null);
  });

  it("reads a format saved inside the focus text", () => {
    const stored = encodeRequestFocus("stretch", "腰");
    const hearing = resolvePreSessionHearing({ request_focus: stored });
    assert.equal(hearing.session_format, "stretch");
    assert.equal(hearing.request_focus, "腰");
    const lines = formatPreSessionSurveyDetailLines(sample({ request_focus: stored }));
    assert.ok(lines.includes("希望: ストレッチ"));
    assert.ok(lines.includes("希望部位: 腰"));
    assert.equal(lines.some((line) => line.includes("session_format")), false);
  });
});
