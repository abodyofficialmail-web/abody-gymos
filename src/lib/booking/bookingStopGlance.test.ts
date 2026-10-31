import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { bookingStopGlanceLabel, summarizeBookingStopCounts } from "./bookingStopGlance.ts";

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

  it("flags last month visits and the first seven days by koma", () => {
    const counts = summarizeBookingStopCounts({
      todayYmd: "2026-11-10",
      reservations: [
        ...Array.from({ length: 12 }, (_, i) => ({
          start_at: `2026-10-${String(i + 1).padStart(2, "0")}T10:00:00+09:00`,
          end_at: `2026-10-${String(i + 1).padStart(2, "0")}T10:30:00+09:00`,
        })),
        {
          start_at: "2026-11-02T10:00:00+09:00",
          end_at: "2026-11-02T11:00:00+09:00",
        },
        {
          start_at: "2026-11-03T10:00:00+09:00",
          end_at: "2026-11-03T11:00:00+09:00",
        },
        {
          start_at: "2026-11-08T10:00:00+09:00",
          end_at: "2026-11-08T12:00:00+09:00",
          status: "cancelled",
        },
      ],
    });
    assert.deepEqual(counts, { lastMonthVisits: 12, firstWeekKoma: 4 });
    assert.equal(
      bookingStopGlanceLabel({ proposed: false, blockedDates: [], todayYmd: "2026-11-05", ...counts }),
      "止め候補 先月12回・1週目4コマ"
    );
    assert.equal(
      bookingStopGlanceLabel({ proposed: false, blockedDates: [], todayYmd: "2026-11-10", ...counts }),
      "止め候補 1週目4コマ"
    );
  });

  it("drops last month after the 5th, including month-end", () => {
    const september = Array.from({ length: 12 }, (_, i) => ({
      start_at: `2026-09-${String(i + 1).padStart(2, "0")}T10:00:00+09:00`,
      end_at: `2026-09-${String(i + 1).padStart(2, "0")}T10:30:00+09:00`,
    }));
    const onThe31st = summarizeBookingStopCounts({ todayYmd: "2026-10-31", reservations: september });
    assert.equal(onThe31st.lastMonthVisits, 12);
    assert.equal(
      bookingStopGlanceLabel({ proposed: false, blockedDates: [], todayYmd: "2026-10-31", ...onThe31st }),
      null
    );
    assert.equal(
      bookingStopGlanceLabel({
        proposed: false,
        blockedDates: [],
        todayYmd: "2026-11-06",
        lastMonthVisits: 14,
        firstWeekKoma: 0,
      }),
      null
    );
  });

  it("keeps people under the count lines unmarked", () => {
    const counts = summarizeBookingStopCounts({
      todayYmd: "2026-11-10",
      reservations: [
        {
          start_at: "2026-10-02T10:00:00+09:00",
          end_at: "2026-10-02T11:00:00+09:00",
        },
        {
          start_at: "2026-11-02T10:00:00+09:00",
          end_at: "2026-11-02T11:00:00+09:00",
        },
      ],
    });
    assert.deepEqual(counts, { lastMonthVisits: 1, firstWeekKoma: 2 });
    assert.equal(
      bookingStopGlanceLabel({ proposed: false, blockedDates: [], todayYmd: "2026-11-10", ...counts }),
      null
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
