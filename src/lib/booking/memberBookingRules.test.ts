import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DateTime } from "luxon";
import {
  evaluateMemberBooking,
  conversionOfferFor,
  isDateUnavailableForMember,
  isLateCancelForQuota,
  komaForRange,
  remainingBookableKoma,
  summarizeMemberBookingState,
  usesCrossStoreOrOnline,
  type RuleReservation,
} from "./memberBookingRules.ts";

const ZONE = "Asia/Tokyo";
const STORE_A = "11111111-1111-1111-1111-111111111111";
const STORE_B = "22222222-2222-2222-2222-222222222222";

function iso(ymd: string, hm: string): string {
  return DateTime.fromISO(`${ymd}T${hm}:00`, { zone: ZONE }).toUTC().toISO()!;
}

function res(partial: Partial<RuleReservation> & { start_at: string; end_at: string }): RuleReservation {
  return {
    id: partial.id,
    start_at: partial.start_at,
    end_at: partial.end_at,
    store_id: partial.store_id ?? STORE_A,
    session_type: partial.session_type ?? "store",
    status: partial.status ?? "confirmed",
    quota_consumed: partial.quota_consumed ?? false,
  };
}

describe("komaForRange", () => {
  it("counts 30 min as 1 and 60 min as 2", () => {
    assert.equal(komaForRange(iso("2026-09-21", "10:00"), iso("2026-09-21", "10:30")), 1);
    assert.equal(komaForRange(iso("2026-09-21", "10:00"), iso("2026-09-21", "11:00")), 2);
  });
});

describe("evaluateMemberBooking", () => {
  const nowIso = iso("2026-09-20", "12:00");

  it("allows booking when plan is unset", () => {
    const result = evaluateMemberBooking({
      plan: null,
      ticketKoma: 0,
      reservations: [
        res({ start_at: iso("2026-09-22", "10:00"), end_at: iso("2026-09-22", "10:30") }),
        res({ start_at: iso("2026-09-23", "10:00"), end_at: iso("2026-09-23", "10:30") }),
        res({ start_at: iso("2026-09-24", "10:00"), end_at: iso("2026-09-24", "10:30") }),
      ],
      blockedDates: [],
      candidate: { start_at: iso("2026-09-25", "10:00"), end_at: iso("2026-09-25", "10:30"), store_id: STORE_A },
      nowIso,
    });
    assert.equal(result.ok, true);
  });

  it("blocks a 3rd hold for 30-min unlimited", () => {
    const result = evaluateMemberBooking({
      plan: "unlimited_30",
      ticketKoma: 0,
      reservations: [
        res({ start_at: iso("2026-09-22", "10:00"), end_at: iso("2026-09-22", "10:30") }),
        res({ start_at: iso("2026-09-23", "10:00"), end_at: iso("2026-09-23", "10:30") }),
      ],
      blockedDates: [],
      candidate: { start_at: iso("2026-09-24", "10:00"), end_at: iso("2026-09-24", "10:30"), store_id: STORE_A },
      nowIso,
    });
    assert.equal(result.ok, false);
    assert.equal(result.reason, "quota");
    assert.equal(result.offerPlanConversion, "monthly_10");
  });

  it("lets the same 3rd hold through after switching to monthly 10", () => {
    const result = evaluateMemberBooking({
      plan: "monthly_10",
      ticketKoma: 0,
      reservations: [
        res({ start_at: iso("2026-09-22", "10:00"), end_at: iso("2026-09-22", "10:30") }),
        res({ start_at: iso("2026-09-23", "10:00"), end_at: iso("2026-09-23", "10:30") }),
      ],
      blockedDates: [],
      candidate: { start_at: iso("2026-09-24", "10:00"), end_at: iso("2026-09-24", "10:30"), store_id: STORE_A },
      nowIso,
    });
    assert.equal(result.ok, true);
  });

  it("blocks 2 koma on the same day for 30-min unlimited", () => {
    const result = evaluateMemberBooking({
      plan: "unlimited_30",
      ticketKoma: 5,
      reservations: [res({ start_at: iso("2026-09-22", "10:00"), end_at: iso("2026-09-22", "10:30") })],
      blockedDates: [],
      candidate: { start_at: iso("2026-09-22", "18:00"), end_at: iso("2026-09-22", "18:30"), store_id: STORE_A },
      nowIso,
    });
    assert.equal(result.ok, false);
    assert.equal(result.reason, "daily_limit");
    assert.equal(result.offerPlanConversion, null);
  });

  it("lets tickets cover extra hold but not same-day 2 koma", () => {
    const extraHold = evaluateMemberBooking({
      plan: "unlimited_30",
      ticketKoma: 1,
      reservations: [
        res({ start_at: iso("2026-09-22", "10:00"), end_at: iso("2026-09-22", "10:30") }),
        res({ start_at: iso("2026-09-23", "10:00"), end_at: iso("2026-09-23", "10:30") }),
      ],
      blockedDates: [],
      candidate: { start_at: iso("2026-09-24", "10:00"), end_at: iso("2026-09-24", "10:30"), store_id: STORE_A },
      nowIso,
    });
    assert.equal(extraHold.ok, true);
    assert.equal(extraHold.ticketsToConsume, 1);
  });

  it("blocks more than 2 koma on the same day for 60-min plan", () => {
    const result = evaluateMemberBooking({
      plan: "session_60",
      ticketKoma: 5,
      reservations: [res({ start_at: iso("2026-09-22", "10:00"), end_at: iso("2026-09-22", "11:00") })],
      blockedDates: [],
      candidate: { start_at: iso("2026-09-22", "18:00"), end_at: iso("2026-09-22", "18:30"), store_id: STORE_A },
      nowIso,
    });
    assert.equal(result.ok, false);
    assert.equal(result.reason, "daily_limit");
  });

  it("blocks a 5th hold koma for 60-min plan and allows 4", () => {
    const over = evaluateMemberBooking({
      plan: "session_60",
      ticketKoma: 0,
      reservations: [
        res({ start_at: iso("2026-09-22", "10:00"), end_at: iso("2026-09-22", "11:00") }),
        res({ start_at: iso("2026-09-23", "10:00"), end_at: iso("2026-09-23", "11:00") }),
      ],
      blockedDates: [],
      candidate: { start_at: iso("2026-09-24", "10:00"), end_at: iso("2026-09-24", "10:30"), store_id: STORE_A },
      nowIso,
    });
    assert.equal(over.ok, false);
    assert.equal(over.offerPlanConversion, "monthly_20");
    const switched = evaluateMemberBooking({
      plan: "monthly_20",
      ticketKoma: 0,
      reservations: [
        res({ start_at: iso("2026-09-22", "10:00"), end_at: iso("2026-09-22", "11:00") }),
        res({ start_at: iso("2026-09-23", "10:00"), end_at: iso("2026-09-23", "11:00") }),
      ],
      blockedDates: [],
      candidate: { start_at: iso("2026-09-24", "10:00"), end_at: iso("2026-09-24", "10:30"), store_id: STORE_A },
      nowIso,
    });
    assert.equal(switched.ok, true);
    const atCap = evaluateMemberBooking({
      plan: "session_60",
      ticketKoma: 0,
      reservations: [res({ start_at: iso("2026-09-22", "10:00"), end_at: iso("2026-09-22", "11:00") })],
      blockedDates: [],
      candidate: { start_at: iso("2026-09-23", "10:00"), end_at: iso("2026-09-23", "11:00"), store_id: STORE_A },
      nowIso,
    });
    assert.equal(atCap.ok, true);
  });

  it("lets monthly 10 book 10 koma at once and blocks the 11th", () => {
    const existing: RuleReservation[] = [];
    for (let d = 1; d <= 9; d += 1) {
      const day = String(d + 20).padStart(2, "0");
      existing.push(res({ start_at: iso(`2026-10-${day}`, "10:00"), end_at: iso(`2026-10-${day}`, "10:30") }));
    }
    const tenth = evaluateMemberBooking({
      plan: "monthly_10",
      ticketKoma: 0,
      reservations: existing,
      blockedDates: [],
      candidate: { start_at: iso("2026-10-31", "10:00"), end_at: iso("2026-10-31", "10:30"), store_id: STORE_A },
      nowIso: iso("2026-09-20", "12:00"),
    });
    assert.equal(tenth.ok, true);
    const eleventh = evaluateMemberBooking({
      plan: "monthly_10",
      ticketKoma: 5,
      reservations: [
        ...existing,
        res({ start_at: iso("2026-10-31", "10:00"), end_at: iso("2026-10-31", "10:30") }),
      ],
      blockedDates: [],
      candidate: { start_at: iso("2026-10-30", "18:00"), end_at: iso("2026-10-30", "18:30"), store_id: STORE_A },
      nowIso: iso("2026-09-20", "12:00"),
    });
    assert.equal(eleventh.ok, false);
    assert.equal(eleventh.reason, "quota");
  });

  it("lets monthly 10 book 2 koma on the same day and blocks a 3rd", () => {
    const second = evaluateMemberBooking({
      plan: "monthly_10",
      ticketKoma: 5,
      reservations: [res({ start_at: iso("2026-09-22", "10:00"), end_at: iso("2026-09-22", "10:30") })],
      blockedDates: [],
      candidate: { start_at: iso("2026-09-22", "18:00"), end_at: iso("2026-09-22", "18:30"), store_id: STORE_A },
      nowIso,
    });
    assert.equal(second.ok, true);
    const third = evaluateMemberBooking({
      plan: "monthly_10",
      ticketKoma: 5,
      reservations: [
        res({ start_at: iso("2026-09-22", "10:00"), end_at: iso("2026-09-22", "10:30") }),
        res({ start_at: iso("2026-09-22", "18:00"), end_at: iso("2026-09-22", "18:30") }),
      ],
      blockedDates: [],
      candidate: { start_at: iso("2026-09-22", "20:00"), end_at: iso("2026-09-22", "20:30"), store_id: STORE_A },
      nowIso,
    });
    assert.equal(third.ok, false);
    assert.equal(third.reason, "daily_limit");
  });

  it("does not apply weekly max when staying at one store", () => {
    const result = evaluateMemberBooking({
      plan: "unlimited_30",
      ticketKoma: 0,
      reservations: [res({ start_at: iso("2026-09-21", "10:00"), end_at: iso("2026-09-21", "10:30") })],
      blockedDates: [],
      candidate: { start_at: iso("2026-09-22", "10:00"), end_at: iso("2026-09-22", "10:30"), store_id: STORE_A },
      nowIso,
    });
    assert.equal(result.ok, true);
  });

  it("applies weekly max 3 when mixing stores", () => {
    const wedNow = iso("2026-09-23", "12:00");
    const result = evaluateMemberBooking({
      plan: "unlimited_30",
      ticketKoma: 0,
      reservations: [
        res({ start_at: iso("2026-09-21", "10:00"), end_at: iso("2026-09-21", "10:30"), store_id: STORE_A }),
        res({ start_at: iso("2026-09-22", "10:00"), end_at: iso("2026-09-22", "10:30"), store_id: STORE_A }),
      ],
      blockedDates: [],
      candidate: {
        start_at: iso("2026-09-24", "10:00"),
        end_at: iso("2026-09-24", "10:30"),
        store_id: STORE_B,
      },
      nowIso: wedNow,
    });
    assert.equal(result.ok, true);
    const over = evaluateMemberBooking({
      plan: "unlimited_30",
      ticketKoma: 0,
      reservations: [
        res({ start_at: iso("2026-09-21", "10:00"), end_at: iso("2026-09-21", "10:30"), store_id: STORE_A }),
        res({ start_at: iso("2026-09-22", "10:00"), end_at: iso("2026-09-22", "10:30"), store_id: STORE_A }),
        res({ start_at: iso("2026-09-23", "10:00"), end_at: iso("2026-09-23", "10:30"), store_id: STORE_B }),
      ],
      blockedDates: [],
      candidate: {
        start_at: iso("2026-09-24", "10:00"),
        end_at: iso("2026-09-24", "10:30"),
        store_id: STORE_B,
      },
      nowIso: wedNow,
    });
    assert.equal(over.ok, false);
  });

  it("applies weekly max 6 for 60-min plan when mixing online", () => {
    const wedNow = iso("2026-09-23", "12:00");
    const result = evaluateMemberBooking({
      plan: "session_60",
      ticketKoma: 0,
      reservations: [
        res({ start_at: iso("2026-09-21", "10:00"), end_at: iso("2026-09-21", "11:00") }),
        res({ start_at: iso("2026-09-22", "10:00"), end_at: iso("2026-09-22", "11:00") }),
      ],
      blockedDates: [],
      candidate: {
        start_at: iso("2026-09-24", "10:00"),
        end_at: iso("2026-09-24", "11:00"),
        store_id: STORE_A,
        session_type: "online",
      },
      nowIso: wedNow,
    });
    assert.equal(result.ok, true);
    const over = evaluateMemberBooking({
      plan: "session_60",
      ticketKoma: 0,
      reservations: [
        res({ start_at: iso("2026-09-21", "10:00"), end_at: iso("2026-09-21", "11:00") }),
        res({ start_at: iso("2026-09-22", "10:00"), end_at: iso("2026-09-22", "11:00") }),
        res({
          start_at: iso("2026-09-23", "10:00"),
          end_at: iso("2026-09-23", "11:00"),
          session_type: "online",
        }),
      ],
      blockedDates: [],
      candidate: { start_at: iso("2026-09-24", "10:00"), end_at: iso("2026-09-24", "10:30"), store_id: STORE_A },
      nowIso: wedNow,
    });
    assert.equal(over.ok, false);
  });

  it("requires tickets for the ticket plan", () => {
    const noTicket = evaluateMemberBooking({
      plan: "ticket",
      ticketKoma: 0,
      reservations: [],
      blockedDates: [],
      candidate: { start_at: iso("2026-09-22", "10:00"), end_at: iso("2026-09-22", "10:30"), store_id: STORE_A },
      nowIso,
    });
    assert.equal(noTicket.ok, false);
    const withTicket = evaluateMemberBooking({
      plan: "ticket",
      ticketKoma: 1,
      reservations: [],
      blockedDates: [],
      candidate: { start_at: iso("2026-09-22", "10:00"), end_at: iso("2026-09-22", "10:30"), store_id: STORE_A },
      nowIso,
    });
    assert.equal(withTicket.ok, true);
    assert.equal(withTicket.ticketsToConsume, 1);
  });

  it("blocks a staff-designated date", () => {
    const result = evaluateMemberBooking({
      plan: "unlimited_30",
      ticketKoma: 0,
      reservations: [],
      blockedDates: ["2026-09-22"],
      candidate: { start_at: iso("2026-09-22", "10:00"), end_at: iso("2026-09-22", "10:30"), store_id: STORE_A },
      nowIso,
    });
    assert.equal(result.ok, false);
    assert.equal(result.reason, "staff_date_block");
  });

  it("blocks a staff-designated date even when plan is unset", () => {
    const result = evaluateMemberBooking({
      plan: null,
      ticketKoma: 0,
      reservations: [],
      blockedDates: ["2026-09-22"],
      candidate: { start_at: iso("2026-09-22", "10:00"), end_at: iso("2026-09-22", "10:30"), store_id: STORE_A },
      nowIso,
    });
    assert.equal(result.ok, false);
    assert.equal(result.reason, "staff_date_block");
  });
});

describe("isLateCancelForQuota", () => {
  it("consumes quota within 2 hours on the same day", () => {
    assert.equal(
      isLateCancelForQuota({ nowIso: iso("2026-09-21", "09:00"), startAtIso: iso("2026-09-21", "10:30") }),
      true
    );
    assert.equal(
      isLateCancelForQuota({ nowIso: iso("2026-09-21", "08:00"), startAtIso: iso("2026-09-21", "10:30") }),
      false
    );
    assert.equal(
      isLateCancelForQuota({ nowIso: iso("2026-09-20", "23:00"), startAtIso: iso("2026-09-21", "10:30") }),
      false
    );
  });
});

describe("usesCrossStoreOrOnline", () => {
  it("detects mix of stores or online", () => {
    assert.equal(usesCrossStoreOrOnline([{ store_id: STORE_A, session_type: "store" }]), false);
    assert.equal(
      usesCrossStoreOrOnline([
        { store_id: STORE_A, session_type: "store" },
        { store_id: STORE_B, session_type: "store" },
      ]),
      true
    );
    assert.equal(
      usesCrossStoreOrOnline([
        { store_id: STORE_A, session_type: "store" },
        { store_id: STORE_A, session_type: "online" },
      ]),
      true
    );
  });
});

describe("conversionOfferFor", () => {
  it("offers monthly 10 for 30-min unlimited quota and monthly 20 for 60-min quota", () => {
    assert.equal(conversionOfferFor("unlimited_30", "quota"), "monthly_10");
    assert.equal(conversionOfferFor("session_60", "quota"), "monthly_20");
    assert.equal(conversionOfferFor("unlimited_30", "daily_limit"), null);
    assert.equal(conversionOfferFor("monthly_10", "quota"), null);
  });
});

describe("isDateUnavailableForMember", () => {
  it("marks a blocked date unavailable", () => {
    assert.equal(
      isDateUnavailableForMember({
        plan: "unlimited_30",
        ticketKoma: 0,
        reservations: [],
        blockedDates: ["2026-09-22"],
        ymd: "2026-09-22",
        storeId: STORE_A,
        nowIso: iso("2026-09-20", "12:00"),
      }),
      true
    );
  });

  it("keeps other days open so a 3rd hold can offer monthly-10 conversion", () => {
    assert.equal(
      isDateUnavailableForMember({
        plan: "unlimited_30",
        ticketKoma: 0,
        reservations: [
          res({ start_at: iso("2026-09-22", "10:00"), end_at: iso("2026-09-22", "10:30") }),
          res({ start_at: iso("2026-09-23", "10:00"), end_at: iso("2026-09-23", "10:30") }),
        ],
        blockedDates: [],
        ymd: "2026-09-24",
        storeId: STORE_A,
        nowIso: iso("2026-09-20", "12:00"),
      }),
      false
    );
  });

  it("keeps other days open so a 5th hold can offer monthly-20 conversion", () => {
    assert.equal(
      isDateUnavailableForMember({
        plan: "session_60",
        ticketKoma: 0,
        reservations: [
          res({ start_at: iso("2026-09-22", "10:00"), end_at: iso("2026-09-22", "11:00") }),
          res({ start_at: iso("2026-09-23", "10:00"), end_at: iso("2026-09-23", "11:00") }),
        ],
        blockedDates: [],
        ymd: "2026-09-24",
        storeId: STORE_A,
        nowIso: iso("2026-09-20", "12:00"),
      }),
      false
    );
  });

  it("keeps days open at monthly-10 cap so booking can show the cannot-book message", () => {
    const holds = Array.from({ length: 10 }, (_, i) => {
      const ymd = DateTime.fromISO("2026-09-21", { zone: ZONE }).plus({ days: i }).toISODate()!;
      return res({ start_at: iso(ymd, "10:00"), end_at: iso(ymd, "10:30") });
    });
    assert.equal(
      isDateUnavailableForMember({
        plan: "monthly_10",
        ticketKoma: 0,
        reservations: holds,
        blockedDates: [],
        ymd: "2026-10-01",
        storeId: STORE_A,
        nowIso: iso("2026-09-20", "12:00"),
      }),
      false
    );
  });

  it("keeps a same-day extra slot visible so daily limit is explained on submit", () => {
    assert.equal(
      isDateUnavailableForMember({
        plan: "unlimited_30",
        ticketKoma: 0,
        reservations: [res({ start_at: iso("2026-09-24", "10:00"), end_at: iso("2026-09-24", "10:30") })],
        blockedDates: [],
        ymd: "2026-09-24",
        storeId: STORE_A,
        nowIso: iso("2026-09-20", "12:00"),
      }),
      false
    );
  });
});

describe("summarizeMemberBookingState", () => {
  it("reports current hold", () => {
    const snap = summarizeMemberBookingState({
      plan: "unlimited_30",
      ticketKoma: 2,
      reservations: [res({ start_at: iso("2026-09-22", "10:00"), end_at: iso("2026-09-22", "10:30") })],
      blockedDates: ["2026-09-23"],
      nowIso: iso("2026-09-20", "12:00"),
    });
    assert.equal(snap.holdKoma, 1);
    assert.equal(snap.maxHoldKoma, 2);
    assert.equal(snap.ticketKoma, 2);
  });
});

describe("remainingBookableKoma", () => {
  const nowIso = iso("2026-09-20", "12:00");

  it("adds leftover hold and tickets for 30-min unlimited", () => {
    const oneLeft = summarizeMemberBookingState({
      plan: "unlimited_30",
      ticketKoma: 0,
      reservations: [res({ start_at: iso("2026-09-22", "10:00"), end_at: iso("2026-09-22", "10:30") })],
      blockedDates: [],
      nowIso,
    });
    assert.equal(remainingBookableKoma(oneLeft), 1);
    const atCapWithTickets = summarizeMemberBookingState({
      plan: "unlimited_30",
      ticketKoma: 2,
      reservations: [
        res({ start_at: iso("2026-09-22", "10:00"), end_at: iso("2026-09-22", "10:30") }),
        res({ start_at: iso("2026-09-23", "10:00"), end_at: iso("2026-09-23", "10:30") }),
      ],
      blockedDates: [],
      nowIso,
    });
    assert.equal(remainingBookableKoma(atCapWithTickets), 2);
  });

  it("does not let tickets raise monthly-10 over the hard cap", () => {
    const holds = Array.from({ length: 8 }, (_, i) => {
      const ymd = DateTime.fromISO("2026-09-02", { zone: ZONE }).plus({ days: i }).toISODate()!;
      return res({ start_at: iso(ymd, "10:00"), end_at: iso(ymd, "10:30") });
    });
    const snap = summarizeMemberBookingState({
      plan: "monthly_10",
      ticketKoma: 5,
      reservations: holds,
      blockedDates: [],
      nowIso,
    });
    assert.equal(snap.monthKoma, 8);
    assert.equal(remainingBookableKoma(snap), 2);
  });

  it("returns null when plan is unset", () => {
    const snap = summarizeMemberBookingState({
      plan: null,
      ticketKoma: 0,
      reservations: [],
      blockedDates: [],
      nowIso,
    });
    assert.equal(remainingBookableKoma(snap), null);
  });
});
