import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DateTime } from "luxon";
import { nextBookingAudience, sessionCountsForNextBooking } from "./nextBookingAudience.ts";

const TZ = "Asia/Tokyo";

function dt(iso: string) {
  return DateTime.fromISO(iso, { zone: TZ });
}

describe("nextBookingAudience", () => {
  it("August 2026: this month under 8", () => {
    const now = dt("2026-08-20T19:10:00");
    assert.equal(nextBookingAudience(now, { thisMonthCount: 7, prevMonthCount: 12, firstHalfCount: 4 }).eligible, true);
    assert.equal(nextBookingAudience(now, { thisMonthCount: 8, prevMonthCount: 0, firstHalfCount: 0 }).eligible, false);
  });

  it("September before the 15th: August 8 or fewer only", () => {
    const now = dt("2026-09-10T19:10:00");
    assert.equal(nextBookingAudience(now, { thisMonthCount: 2, prevMonthCount: 8, firstHalfCount: 2 }).eligible, true);
    assert.equal(nextBookingAudience(now, { thisMonthCount: 2, prevMonthCount: 9, firstHalfCount: 2 }).eligible, false);
  });

  it("from September 15: also first half under 5", () => {
    const now = dt("2026-09-15T19:10:00");
    assert.equal(nextBookingAudience(now, { thisMonthCount: 4, prevMonthCount: 12, firstHalfCount: 4 }).eligible, true);
    assert.equal(nextBookingAudience(now, { thisMonthCount: 6, prevMonthCount: 12, firstHalfCount: 5 }).eligible, false);
    assert.equal(nextBookingAudience(now, { thisMonthCount: 6, prevMonthCount: 8, firstHalfCount: 5 }).eligible, true);
  });
});

describe("sessionCountsForNextBooking", () => {
  it("counts completed sessions in this month, previous month, and first half", () => {
    const now = dt("2026-09-16T12:00:00");
    const starts = [
      "2026-08-03T10:00:00+09:00",
      "2026-08-20T10:00:00+09:00",
      "2026-09-01T10:00:00+09:00",
      "2026-09-15T10:00:00+09:00",
      "2026-09-16T10:00:00+09:00",
      "2026-09-20T10:00:00+09:00",
    ];
    const counts = sessionCountsForNextBooking(starts, now);
    assert.equal(counts.prevMonthCount, 2);
    assert.equal(counts.thisMonthCount, 3);
    assert.equal(counts.firstHalfCount, 2);
  });
});
