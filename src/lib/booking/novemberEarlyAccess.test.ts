import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  NOVEMBER_EARLY_AT_ISO,
  NOVEMBER_LOW_USAGE_MAX,
  NOVEMBER_PUBLIC_AT_ISO,
  NOVEMBER_TICKET_KOMA,
  isActiveForNovemberGrant,
  isExcludedNovemberGrantName,
  isNovemberBookingMonth,
  isNovemberLowUsageCount,
  isTokyoNovemberStore,
  novemberBookingPhase,
  selectNovemberLowUsageMembers,
} from "./novemberEarlyAccess.ts";

describe("november booking release", () => {
  it("opens early access at 2026-10-26 18:00 JST and everyone at 2026-10-27 18:00 JST", () => {
    assert.equal(novemberBookingPhase(new Date("2026-10-26T17:59:59+09:00")), "hidden");
    assert.equal(novemberBookingPhase(new Date(NOVEMBER_EARLY_AT_ISO)), "early");
    assert.equal(novemberBookingPhase(new Date("2026-10-27T17:59:59+09:00")), "early");
    assert.equal(novemberBookingPhase(new Date(NOVEMBER_PUBLIC_AT_ISO)), "public");
    assert.equal(novemberBookingPhase(new Date("2026-11-01T00:00:00+09:00")), "public");
    assert.equal(novemberBookingPhase(new Date(Number.NaN)), "hidden");
  });

  it("targets November at the Tokyo 4 stores", () => {
    assert.equal(isNovemberBookingMonth("2026-11"), true);
    assert.equal(isNovemberBookingMonth("2026-11-01"), true);
    assert.equal(isNovemberBookingMonth("2026-10-31"), false);
    assert.equal(isTokyoNovemberStore("恵比寿"), true);
    assert.equal(isTokyoNovemberStore("上野"), true);
    assert.equal(isTokyoNovemberStore("新宿"), true);
    assert.equal(isTokyoNovemberStore("桜木町"), true);
    assert.equal(isTokyoNovemberStore("福岡"), false);
  });

  it("treats 8 October visits as low usage and 9 as not", () => {
    assert.equal(NOVEMBER_LOW_USAGE_MAX, 8);
    assert.equal(NOVEMBER_TICKET_KOMA, 2);
    assert.equal(isNovemberLowUsageCount(0), true);
    assert.equal(isNovemberLowUsageCount(8), true);
    assert.equal(isNovemberLowUsageCount(9), false);
  });

  it("keeps active members, including a blank status that is still active", () => {
    assert.equal(isActiveForNovemberGrant({ membership_status: "active", is_active: false }), true);
    assert.equal(isActiveForNovemberGrant({ membership_status: "", is_active: true }), true);
    assert.equal(isActiveForNovemberGrant({ membership_status: "hiatus", is_active: true }), false);
    assert.equal(isActiveForNovemberGrant({ membership_status: "withdrawn", is_active: true }), false);
    assert.equal(isActiveForNovemberGrant({ membership_status: "", is_active: false }), false);
  });

  it("snapshots only the low-usage active members", () => {
    assert.equal(isExcludedNovemberGrantName("テスト会員"), true);
    const counts = new Map<string, number>([
      ["low", 8],
      ["high", 9],
      ["none", 0],
      ["paused", 1],
      ["test", 0],
    ]);
    const selected = selectNovemberLowUsageMembers(
      [
        { id: "low", member_code: "ebi001", membership_status: "active", name: "低" },
        { id: "high", member_code: "EBI002", membership_status: "active", name: "多" },
        { id: "none", member_code: "sak003", membership_status: "", is_active: true, name: "ゼロ" },
        { id: "paused", member_code: "UEN004", membership_status: "hiatus", name: "休会" },
        { id: "test", member_code: "SHI099", membership_status: "active", display_name: "テスト用" },
      ],
      counts
    );
    assert.deepEqual(
      selected.map((m) => m.memberCode),
      ["SAK003", "EBI001"]
    );
    assert.deepEqual(
      selected.map((m) => m.count),
      [0, 8]
    );
  });

  it("keeps the manual grant script on the same clock, cap, and ledger reason", () => {
    const script = readFileSync(new URL("../../../scripts/grant-november-2026-low-usage-tickets.mjs", import.meta.url), "utf8");
    const shifts = readFileSync(new URL("../../../scripts/sync-final-shifts-2026-11.mjs", import.meta.url), "utf8");
    assert.match(script, /2026-10-26T18:00:00\+09:00/);
    assert.match(script, /2026-10-01T00:00:00\+09:00/);
    assert.match(script, /2026-11-01T00:00:00\+09:00/);
    assert.match(script, /november_2026_low_usage_tickets/);
    assert.match(script, /LOW_MAX = 8/);
    assert.match(script, /TICKET_KOMA = 2/);
    assert.match(shifts, /2026-10-27T18:00:00\+09:00/);
    assert.match(shifts, /shiftStatusForApply/);
  });
});
