import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  costPer,
  formatAdsMarketingReport,
  formatHourHistogram,
  formatYen,
  peakHourLabel,
  sumNullable,
} from "./formatAdsMarketingReport.ts";
import type { AdsMarketingReport, StoreAdsSlice } from "./types.ts";

function slice(overrides: Partial<StoreAdsSlice> = {}): StoreAdsSlice {
  return {
    store_id: "s1",
    store_name: "恵比寿",
    line_channel_key: "default",
    spend: 12000,
    impressions: 10000,
    clicks: 80,
    instagram_followers: 1252,
    instagram_followers_delta: 12,
    line_followers: 800,
    line_followers_delta: 6,
    line_adds: 6,
    line_unfollows: 1,
    hour_counts: Array.from({ length: 24 }, (_, h) => (h === 21 ? 4 : h === 12 ? 2 : 0)),
    weekday_counts: [1, 2, 0, 0, 3, 0, 0],
    ...overrides,
  };
}

const daily: AdsMarketingReport = {
  kind: "daily",
  startYmd: "2026-08-28",
  endYmd: "2026-08-28",
  generatedAtYmd: "2026-08-29",
  stores: [
    slice(),
    slice({
      store_id: "s2",
      store_name: "上野",
      spend: null,
      instagram_followers: null,
      instagram_followers_delta: null,
      line_adds: 0,
      line_unfollows: 0,
      hour_counts: Array.from({ length: 24 }, () => 0),
    }),
  ],
};

describe("ads marketing report copy", () => {
  it("formats yen and CPA", () => {
    assert.equal(formatYen(12000), "¥12,000");
    assert.equal(formatYen(null), "未取得");
    assert.equal(costPer(12000, 6), "¥2,000");
    assert.equal(costPer(null, 6), "—");
    assert.equal(costPer(12000, 0), "—");
    assert.equal(sumNullable([12000, null, 8000]), 20000);
  });

  it("picks the peak LINE-add hour", () => {
    const hours = Array.from({ length: 24 }, () => 0);
    hours[21] = 4;
    hours[12] = 2;
    assert.equal(peakHourLabel(hours), "21時（4人）");
    assert.match(formatHourHistogram(hours), /21時 4人/);
    assert.match(formatHourHistogram(hours), /12時 2人/);
  });

  it("builds a daily LINE text with spend, followers, and add timing", () => {
    const text = formatAdsMarketingReport(daily, { allStores: true });
    assert.match(text, /【広告日次】2026年8月28日/);
    assert.match(text, /全店舗/);
    assert.match(text, /消化: ¥12,000/);
    assert.match(text, /LINE追加 6人/);
    assert.match(text, /━━ 恵比寿 ━━/);
    assert.match(text, /Instagramフォロワー: 1,252（\+12）/);
    assert.match(text, /公式LINE追加: 6人（ブロック 1）/);
    assert.match(text, /いちばん多い時間: 21時（4人）/);
    assert.match(text, /━━ 上野 ━━/);
    assert.match(text, /消化: 未取得/);
  });

  it("filters to a store manager's shops", () => {
    const text = formatAdsMarketingReport(daily, { allStores: false, storeNames: ["上野"] });
    assert.match(text, /━━ 上野 ━━/);
    assert.doesNotMatch(text, /恵比寿/);
    assert.doesNotMatch(text, /全店舗/);
  });

  it("says there is no data instead of showing every shop", () => {
    const text = formatAdsMarketingReport(daily, { allStores: false, storeNames: ["福岡"] });
    assert.match(text, /担当店舗の広告データがありません/);
    assert.doesNotMatch(text, /恵比寿/);
  });
});
