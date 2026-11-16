import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildStaffSameDayCancel,
  consumedCancelLabelFromNotes,
  isConsumedCancelNote,
  staffCanCancelReservation,
} from "./karteConsumedCancel.ts";

const noon = "2026-11-16T03:00:00.000Z"; // 12:00 JST
const evening = "2026-11-16T10:00:00.000Z"; // 19:00 JST

describe("staffCanCancelReservation", () => {
  it("allows a future reservation and a same-day no-show", () => {
    assert.equal(staffCanCancelReservation(evening, noon), true);
    assert.equal(staffCanCancelReservation("2026-11-16T01:00:00.000Z", noon), true);
  });

  it("blocks a session that already started on an earlier day", () => {
    assert.equal(staffCanCancelReservation("2026-11-15T01:00:00.000Z", noon), false);
  });
});

describe("buildStaffSameDayCancel", () => {
  it("records a no-show as consumed and keeps it out of the send count", () => {
    const plan = buildStaffSameDayCancel({
      nowIso: noon,
      startAt: "2026-11-16T01:00:00.000Z",
      endAt: "2026-11-16T02:00:00.000Z",
      memberId: "m1",
      notes: null,
    });
    assert.equal(plan.reason, "no_show");
    assert.equal(plan.consumeQuota, true);
    assert.match(plan.notes ?? "", /karte_consumed_cancel=no_show/);
    assert.equal(plan.karte?.date, "2026-11-16");
    assert.match(plan.karte?.content ?? "", /【予約消化】/);
    assert.match(plan.karte?.content ?? "", /未来店/);
    assert.match(plan.karte?.content ?? "", /カルテ送信カウントには含めていません/);
    assert.equal(isConsumedCancelNote({ content: plan.karte?.content }), true);
    assert.equal(consumedCancelLabelFromNotes(plan.notes), "未来店");
  });

  it("does not consume the monthly quota for a paid same-day slot", () => {
    const plan = buildStaffSameDayCancel({
      nowIso: noon,
      startAt: evening,
      endAt: "2026-11-16T11:00:00.000Z",
      memberId: "m1",
      notes: "same_day_fee_yen=2200",
    });
    assert.equal(plan.reason, "same_day");
    assert.equal(plan.consumeQuota, false);
    assert.equal(consumedCancelLabelFromNotes(plan.notes), "当日キャンセル");
  });

  it("keeps a staff choice of 未来店 even before the session starts", () => {
    const plan = buildStaffSameDayCancel({
      nowIso: noon,
      startAt: evening,
      endAt: "2026-11-16T11:00:00.000Z",
      memberId: "m1",
      notes: null,
      reason: "no_show",
    });
    assert.equal(plan.reason, "no_show");
    assert.equal(consumedCancelLabelFromNotes(plan.notes), "未来店");
  });

  it("leaves a future-day cancel unchanged", () => {
    const plan = buildStaffSameDayCancel({
      nowIso: noon,
      startAt: "2026-11-17T01:00:00.000Z",
      endAt: "2026-11-17T02:00:00.000Z",
      memberId: "m1",
      notes: null,
    });
    assert.equal(plan.sameDay, false);
    assert.equal(plan.karte, null);
    assert.equal(plan.consumeQuota, false);
  });
});
