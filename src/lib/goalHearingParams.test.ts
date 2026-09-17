import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { signedPayloadDestination } from "./goalHearingParams.ts";

function b64url(obj: unknown) {
  return Buffer.from(JSON.stringify(obj), "utf8").toString("base64url");
}

describe("signedPayloadDestination", () => {
  it("routes goal hearing payloads", () => {
    const s = b64url({
      member_id: "11111111-1111-1111-1111-111111111111",
      invite_id: null,
      exp: Date.now() + 1000,
    });
    assert.equal(signedPayloadDestination(s), "/goal-hearing");
  });

  it("routes session survey payloads", () => {
    const s = b64url({
      member_id: "11111111-1111-1111-1111-111111111111",
      trainer_id: "t",
      store_id: "s",
      session_date: "2026-09-17",
      exp: Date.now() + 1000,
    });
    assert.equal(signedPayloadDestination(s), "/survey");
  });

  it("routes pre-session survey payloads", () => {
    const s = b64url({
      reservation_id: "r",
      member_id: "11111111-1111-1111-1111-111111111111",
      exp: Date.now() + 1000,
    });
    assert.equal(signedPayloadDestination(s), "/pre-session-survey");
  });
});
