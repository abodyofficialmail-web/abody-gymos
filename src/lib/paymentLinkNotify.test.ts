import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildPaymentLinkNotifyText } from "./paymentLinkNotify.ts";

describe("buildPaymentLinkNotifyText", () => {
  it("names the member and includes the message that was sent", () => {
    const text = buildPaymentLinkNotifyText({
      memberCode: "SHI001",
      memberName: "山田",
      storeName: "新宿",
      sentText: "お支払いが完了できませんでした。\n決済リンク\nhttps://buy.stripe.com/example",
    });
    assert.match(text, /【決済リンクを送信しました】/);
    assert.match(text, /会員: 山田（SHI001）/);
    assert.match(text, /店舗: 新宿/);
    assert.match(text, /お支払いが完了できませんでした/);
    assert.match(text, /https:\/\/buy\.stripe\.com\/example/);
  });
});
