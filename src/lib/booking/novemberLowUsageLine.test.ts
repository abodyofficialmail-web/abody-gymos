import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const MESSAGE = `こんにちは！

11月分の先行予約受付がスタートしました！✨

今回は、最近ご利用回数が少なめの会員様限定で
30分の追加チケットを2枚プレゼントしています🎁
追加チケットを活用して、60分セッションのご予約も可能です！

11月はぜひこの特典を活用して、定期的にトレーニングに取り組み、運動習慣を一緒につくっていきましょう！💪

トレーナー一同全力でサポートさせていただきます😊
ご予約お待ちしております！`;

describe("november low usage line", () => {
  it("keeps the requested announcement verbatim for ticket recipients only", () => {
    const src = readFileSync(new URL("./novemberLowUsageLine.ts", import.meta.url), "utf8");
    assert.ok(src.includes(MESSAGE));
    assert.match(src, /NOVEMBER_LOW_USAGE_LEDGER_REASON/);
    assert.match(src, /november_2026_low_usage_line/);
    assert.doesNotMatch(src, /october_public_release_line/);
  });

  it("retries through the afternoon of 2026-10-27 JST and again from the public release cron", () => {
    const vercel = readFileSync(new URL("../../../vercel.json", import.meta.url), "utf8");
    const release = readFileSync(new URL("../../app/api/cron/november-booking-release/route.ts", import.meta.url), "utf8");
    assert.match(vercel, /\/api\/cron\/november-low-usage-line/);
    assert.match(vercel, /0 5-8 27 10 \*/);
    assert.match(release, /await sendNovemberLowUsageTicketLine/);
    const confirmAt = release.indexOf('update({ status: "confirmed" })');
    const sendAt = release.indexOf("await sendNovemberLowUsageTicketLine");
    assert.ok(confirmAt > 0 && sendAt > confirmAt);
  });
});
