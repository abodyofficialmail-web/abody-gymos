import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { validateOpenSlotSupplies } from "./openSlotSupplies.ts";

describe("open slot supplies", () => {
  it("lists selected items with quantities and the receipt count", () => {
    const result = validateOpenSlotSupplies({
      items: [
        { key: "tissue", quantity: 2 },
        { key: "other", quantity: 1, note: "ゴミ袋" },
        { key: "wet-wipes", quantity: 3 },
      ],
      receiptCount: 1,
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.detail, "ウェットティッシュ × 3\nティッシュ × 2\nその他: ゴミ袋 × 1\n領収書: 1枚");
  });

  it("requires an item, a quantity, a name for その他, and a receipt", () => {
    assert.equal(validateOpenSlotSupplies({ items: [], receiptCount: 1 }).ok, false);
    assert.equal(validateOpenSlotSupplies({ items: [{ key: "tissue", quantity: 0 }], receiptCount: 1 }).ok, false);
    assert.equal(validateOpenSlotSupplies({ items: [{ key: "other", quantity: 1, note: "  " }], receiptCount: 1 }).ok, false);
    assert.equal(validateOpenSlotSupplies({ items: [{ key: "tissue", quantity: 1 }], receiptCount: 0 }).ok, false);
  });
});
