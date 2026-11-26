import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DECEMBER_EARLY_ACCESS_CODES,
  DECEMBER_EARLY_AT_ISO,
  decemberBookingOpenForMember,
  decemberBookingPhase,
  isDecemberBookingMonth,
  isDecemberEarlyAccessCode,
  shouldIncludeDecemberDrafts,
} from "./decemberEarlyAccess.ts";

function membersById(codeById: Record<string, string>) {
  return {
    from() {
      return {
        select() {
          return {
            eq(_col: string, id: string) {
              return {
                maybeSingle: async () => ({ data: { member_code: codeById[id] ?? null }, error: null }),
              };
            },
            ilike() {
              return { limit: async () => ({ data: [], error: null }) };
            },
          };
        },
      };
    },
  };
}

describe("december early booking", () => {
  it("opens only at 2026-11-26 21:00 JST for the fixed list", () => {
    assert.equal(DECEMBER_EARLY_AT_ISO, "2026-11-26T21:00:00+09:00");
    assert.equal(decemberBookingPhase(new Date("2026-11-26T20:59:59+09:00")), "hidden");
    assert.equal(decemberBookingPhase(new Date(DECEMBER_EARLY_AT_ISO)), "early");
    assert.equal(decemberBookingPhase(new Date("2026-12-01T00:00:00+09:00")), "early");
    assert.equal(decemberBookingPhase(new Date(Number.NaN)), "hidden");
  });

  it("keeps the 39 named members and leaves the removed names out", () => {
    assert.equal(DECEMBER_EARLY_ACCESS_CODES.length, 39);
    assert.equal(new Set(DECEMBER_EARLY_ACCESS_CODES).size, 39);
    assert.equal(isDecemberEarlyAccessCode("uen013"), true);
    assert.equal(isDecemberEarlyAccessCode("SHI023"), true);
    assert.equal(isDecemberEarlyAccessCode("EBI027"), false);
    assert.equal(isDecemberEarlyAccessCode("UEN055"), false);
    assert.equal(isDecemberEarlyAccessCode("SAK051"), false);
    assert.equal(isDecemberEarlyAccessCode("FUK001"), false);
    assert.equal(isDecemberEarlyAccessCode("FUK006"), false);
    assert.equal(isDecemberEarlyAccessCode("FUK007"), false);
    assert.equal(isDecemberEarlyAccessCode("FUK008"), false);
    assert.equal(isDecemberEarlyAccessCode("FUK009"), false);
    assert.equal(isDecemberEarlyAccessCode("FUK010"), false);
    assert.equal(isDecemberBookingMonth("2026-12"), true);
    assert.equal(isDecemberBookingMonth("2026-12-01"), true);
    assert.equal(isDecemberBookingMonth("2026-11-30"), false);
  });

  it("shows December drafts and accepts a booking only for a listed member after 21:00", async () => {
    const supabase = membersById({ listed: "SAK063", other: "EBI027" });
    const openAt = new Date("2026-11-26T21:00:00+09:00");
    const before = new Date("2026-11-26T20:59:59+09:00");
    assert.equal(
      await shouldIncludeDecemberDrafts({ supabase, ymdOrMonth: "2026-12", memberId: "listed", now: openAt }),
      true
    );
    assert.equal(
      await shouldIncludeDecemberDrafts({ supabase, ymdOrMonth: "2026-12", memberId: "other", now: openAt }),
      false
    );
    assert.equal(
      await shouldIncludeDecemberDrafts({ supabase, ymdOrMonth: "2026-12", memberId: "listed", now: before }),
      false
    );
    assert.equal(
      await shouldIncludeDecemberDrafts({ supabase, ymdOrMonth: "2026-11-26", memberId: "listed", now: openAt }),
      false
    );
    assert.equal(
      await decemberBookingOpenForMember({ supabase, ymd: "2026-12-03", memberId: "listed", now: openAt }),
      true
    );
    assert.equal(
      await decemberBookingOpenForMember({ supabase, ymd: "2026-12-03", memberId: "other", now: openAt }),
      false
    );
    assert.equal(
      await decemberBookingOpenForMember({ supabase, ymd: "2026-11-30", memberId: "other", now: before }),
      true
    );
  });
});
