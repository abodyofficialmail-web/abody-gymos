import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DateTime } from "luxon";
import { isFinishedMonthSession, isLowBookingListMember } from "./storeLowBookingMembers.ts";

const now = DateTime.fromISO("2026-11-28T06:00:00.000Z");
const monthStart = now.setZone("Asia/Tokyo").startOf("month");
const monthEnd = monthStart.plus({ months: 1 });

describe("store low booking members", () => {
  it("keeps active members who joined before this month", () => {
    assert.equal(
      isLowBookingListMember(
        { membership_status: "active", member_code: "UEN010", created_at: "2026-10-02T00:00:00.000Z" },
        "2026-11"
      ),
      true
    );
  });

  it("drops inactive, excluded, and newly joined members", () => {
    assert.equal(
      isLowBookingListMember(
        { membership_status: "hiatus", is_active: true, member_code: "UEN010", created_at: "2026-10-02T00:00:00.000Z" },
        "2026-11"
      ),
      false
    );
    assert.equal(
      isLowBookingListMember(
        { membership_status: "active", member_code: "EBI020", created_at: "2026-01-01T00:00:00.000Z" },
        "2026-11"
      ),
      false
    );
    assert.equal(
      isLowBookingListMember(
        { membership_status: "active", member_code: "UEN010", created_at: "2026-11-03T00:00:00.000Z" },
        "2026-11"
      ),
      false
    );
  });

  it("counts a session only after it has ended this month", () => {
    assert.equal(
      isFinishedMonthSession(
        { status: "confirmed", startAt: "2026-11-27T01:00:00.000Z", endAt: "2026-11-27T02:00:00.000Z" },
        now,
        monthStart,
        monthEnd
      ),
      true
    );
    assert.equal(
      isFinishedMonthSession(
        { status: "confirmed", startAt: "2026-11-28T08:00:00.000Z", endAt: "2026-11-28T09:00:00.000Z" },
        now,
        monthStart,
        monthEnd
      ),
      false
    );
    assert.equal(
      isFinishedMonthSession(
        { status: "cancelled", startAt: "2026-11-27T01:00:00.000Z", endAt: "2026-11-27T02:00:00.000Z" },
        now,
        monthStart,
        monthEnd
      ),
      false
    );
  });
});
