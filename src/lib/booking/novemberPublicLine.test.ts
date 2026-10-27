import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const MESSAGE = `こんにちは！

本日18時より、11月分の予約受付がスタートしました！✨

スポーツの秋！🍁
身体を動かすのにぴったりな季節ですね！
11月もそれぞれの目標に向けて、トレーニングを楽しみながら頑張っていきましょう💪

お仕事やプライベートで忙しい時期かと思いますが、是非お早めにご予定を確認して、ご予約いただけると嬉しいです！

11月もトレーナー一同、全力でサポートさせていただきます😊

ご予約お待ちしております！`;

describe("november public line", () => {
  it("keeps the requested announcement verbatim", () => {
    const src = readFileSync(new URL("./novemberPublicLine.ts", import.meta.url), "utf8");
    assert.ok(src.includes(MESSAGE));
    assert.match(src, /NOVEMBER_LOW_USAGE_LEDGER_REASON/);
    assert.match(src, /NOVEMBER_LOW_USAGE_LINE_REASON/);
    assert.match(src, /NOVEMBER_PUBLIC_LINE_REASON/);
  });

  it("runs at 18:00–21:00 JST on 2026-10-27 and stays off the shift-confirm cron", () => {
    const vercel = readFileSync(new URL("../../../vercel.json", import.meta.url), "utf8");
    const release = readFileSync(new URL("../../app/api/cron/november-booking-release/route.ts", import.meta.url), "utf8");
    const route = readFileSync(new URL("../../app/api/cron/november-public-line/route.ts", import.meta.url), "utf8");
    assert.match(vercel, /\/api\/cron\/november-public-line/);
    assert.match(vercel, /0 9-12 27 10 \*/);
    assert.match(route, /novemberPublicLineWindow/);
    assert.doesNotMatch(release, /sendNovemberPublicReleaseLine/);
  });
});
