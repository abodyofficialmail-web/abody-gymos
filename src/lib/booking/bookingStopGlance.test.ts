import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { bookingStopGlanceLabel } from "./bookingStopGlance.ts";

const today = "2026-11-01";

describe("bookingStopGlanceLabel", () => {
  it("hides members who are neither proposed nor blocked", () => {
    assert.equal(bookingStopGlanceLabel({ proposed: false, blockedDates: [], todayYmd: today }), null);
    assert.equal(
      bookingStopGlanceLabel({ proposed: false, blockedDates: ["2026-10-31"], todayYmd: today }),
      null
    );
  });

  it("shows a proposal before any date is blocked", () => {
    assert.equal(
      bookingStopGlanceLabel({ proposed: true, blockedDates: [], todayYmd: today }),
      "予約止め提案中"
    );
  });

  it("shows blocked days even when the proposal flag is off", () => {
    assert.equal(
      bookingStopGlanceLabel({
        proposed: false,
        blockedDates: ["2026-11-04", "2026-11-04", "bad", "2026-11-06"],
        todayYmd: today,
      }),
      "予約止め中 11/04・11/06"
    );
  });

  it("keeps the proposal label and lists the blocked days", () => {
    assert.equal(
      bookingStopGlanceLabel({
        proposed: true,
        blockedDates: ["2026-11-08", "2026-11-04", "2026-11-05", "2026-11-09"],
        todayYmd: today,
      }),
      "予約止め提案中 11/04・11/05・11/08 ほか1日"
    );
  });
});
