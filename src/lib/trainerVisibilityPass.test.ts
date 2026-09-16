import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isTrainerVisibilityPassActive,
  isTrainerVisibilityTestAccount,
  resolveTrainerVisibilityPassActive,
} from "./trainerVisibilityPass.ts";
import { formatOnShiftTrainerNames, trainerIdsOnShiftForSlot } from "./onShiftTrainers.ts";
import { unixSecondsToIso, verifyStripeSignature } from "./stripeWebhook.ts";
import { createHmac } from "crypto";

describe("isTrainerVisibilityPassActive", () => {
  const now = new Date("2026-08-24T10:00:00+09:00");

  it("grants access for active and trialing", () => {
    assert.equal(isTrainerVisibilityPassActive({ trainer_visibility_pass_status: "active" }, now), true);
    assert.equal(isTrainerVisibilityPassActive({ trainer_visibility_pass_status: "trialing" }, now), true);
    assert.equal(isTrainerVisibilityPassActive({ trainer_visibility_pass_status: "past_due" }, now), true);
  });

  it("keeps canceled pass until period end", () => {
    assert.equal(
      isTrainerVisibilityPassActive(
        {
          trainer_visibility_pass_status: "canceled",
          trainer_visibility_pass_current_period_end: "2026-09-01T00:00:00.000Z",
        },
        now
      ),
      true
    );
    assert.equal(
      isTrainerVisibilityPassActive(
        {
          trainer_visibility_pass_status: "canceled",
          trainer_visibility_pass_current_period_end: "2026-08-01T00:00:00.000Z",
        },
        now
      ),
      false
    );
  });

  it("denies inactive", () => {
    assert.equal(isTrainerVisibilityPassActive({ trainer_visibility_pass_status: "inactive" }, now), false);
    assert.equal(isTrainerVisibilityPassActive(null, now), false);
  });
});

describe("isTrainerVisibilityTestAccount", () => {
  it("grants the official test member", () => {
    assert.equal(isTrainerVisibilityTestAccount("abodyofficial.mail@gmail.com"), true);
    assert.equal(isTrainerVisibilityTestAccount("  AbodyOfficial.mail@gmail.com  "), true);
    assert.equal(isTrainerVisibilityTestAccount(null, "ebi020"), true);
    assert.equal(isTrainerVisibilityTestAccount("someone@example.com", "ebi020"), true);
    assert.equal(isTrainerVisibilityTestAccount("someone@example.com", "other"), false);
    assert.equal(isTrainerVisibilityTestAccount(""), false);
  });
});

describe("resolveTrainerVisibilityPassActive", () => {
  it("treats the official test member as active even if the member API omits the pass", () => {
    assert.equal(resolveTrainerVisibilityPassActive(undefined, "abodyofficial.mail@gmail.com", "EBI020"), true);
    assert.equal(resolveTrainerVisibilityPassActive(false, "abodyofficial.mail@gmail.com", "EBI020"), true);
    assert.equal(resolveTrainerVisibilityPassActive(true, "someone@example.com", "UEN001"), true);
    assert.equal(resolveTrainerVisibilityPassActive(false, "someone@example.com", "UEN001"), false);
    assert.equal(resolveTrainerVisibilityPassActive(undefined, "someone@example.com", "UEN001"), false);
  });
});

describe("buildPreSessionReminderText", () => {
  it("shows on-shift trainers for pass members", async () => {
    const { buildPreSessionReminderText } = await import("./preSessionReminderLine.ts");
    const text = buildPreSessionReminderText({
      startAtUtcIso: "2026-08-24T10:00:00.000Z",
      storeName: "上野",
      trainerName: "担当トレーナー",
      sessionType: "store",
      onShiftTrainerNames: "田中 / 佐藤",
    });
    assert.match(text, /出勤トレーナー：田中 \/ 佐藤/);
    assert.equal(text.includes("担当："), false);
  });
});

describe("trainerIdsOnShiftForSlot", () => {
  it("returns trainers whose shift covers the slot and skips breaks", () => {
    const ids = trainerIdsOnShiftForSlot({
      shifts: [
        { id: "s1", trainer_id: "t-a", start_local: "10:00:00", end_local: "18:00:00" },
        { id: "s2", trainer_id: "t-b", start_local: "10:00:00", end_local: "14:00:00" },
        { id: "s3", trainer_id: "t-c", start_local: "15:00:00", end_local: "18:00:00" },
        { id: "s4", trainer_id: "t-d", start_local: "10:00:00", end_local: "18:00:00", is_break: true },
      ],
      breaksByShiftId: new Map([["s1", [{ start_time: "12:00:00", end_time: "13:00:00" }]]]),
      slotStartMin: 12 * 60,
      slotEndMin: 12 * 60 + 30,
    });
    assert.deepEqual(ids, ["t-b"]);
  });

  it("formats names", () => {
    assert.equal(formatOnShiftTrainerNames([{ display_name: "田中" }, { display_name: " 佐藤 " }]), "田中 / 佐藤");
  });
});

describe("verifyStripeSignature", () => {
  it("accepts a valid v1 signature", () => {
    const payload = '{"id":"evt_1"}';
    const secret = "whsec_test";
    const t = 1_777_000_000;
    const v1 = createHmac("sha256", secret).update(`${t}.${payload}`, "utf8").digest("hex");
    assert.equal(verifyStripeSignature(payload, `t=${t},v1=${v1}`, secret, t), true);
    assert.equal(verifyStripeSignature(payload, `t=${t},v1=deadbeef`, secret, t), false);
  });

  it("converts unix seconds", () => {
    assert.equal(unixSecondsToIso(1_777_000_000), "2026-04-24T03:06:40.000Z");
    assert.equal(unixSecondsToIso(null), null);
  });
});
