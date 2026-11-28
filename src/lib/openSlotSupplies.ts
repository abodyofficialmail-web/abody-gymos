export const OPEN_SLOT_SUPPLY_ITEMS = [
  { key: "wet-wipes", label: "ウェットティッシュ" },
  { key: "kitchen-paper", label: "キッチンペーパー" },
  { key: "tissue", label: "ティッシュ" },
  { key: "toilet-paper", label: "トイレットペーパー" },
  { key: "paper-cup", label: "紙コップ" },
  { key: "sanitizer", label: "消毒液" },
  { key: "detergent", label: "洗剤" },
  { key: "cleaning", label: "掃除用品" },
  { key: "other", label: "その他" },
] as const;

export type OpenSlotSupplyKey = (typeof OPEN_SLOT_SUPPLY_ITEMS)[number]["key"];

const ITEM_KEYS = new Set<string>(OPEN_SLOT_SUPPLY_ITEMS.map((item) => item.key));

export type OpenSlotSupplyLine = {
  key: string;
  quantity: number;
  note?: string | null;
};

export function validateOpenSlotSupplies(input: {
  items: OpenSlotSupplyLine[];
  receiptCount: number;
}): { ok: true; detail: string } | { ok: false; error: string } {
  if (input.items.length < 1) return { ok: false, error: "品目を1つ以上選んでください" };
  if (input.items.length > OPEN_SLOT_SUPPLY_ITEMS.length) return { ok: false, error: "品目の数が多すぎます" };

  const seen = new Set<string>();
  const byKey = new Map<string, OpenSlotSupplyLine>();
  for (const item of input.items) {
    if (!ITEM_KEYS.has(item.key)) return { ok: false, error: "品目を選び直してください" };
    if (seen.has(item.key)) return { ok: false, error: "同じ品目が重複しています" };
    seen.add(item.key);
    if (!Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 999) {
      return { ok: false, error: "個数は1から999で入れてください" };
    }
    const note = String(item.note ?? "").trim();
    if (item.key === "other" && !note) return { ok: false, error: "その他の品名を書いてください" };
    if (note.length > 80) return { ok: false, error: "その他の品名が長すぎます" };
    byKey.set(item.key, { ...item, note });
  }

  if (!Number.isInteger(input.receiptCount) || input.receiptCount < 1) {
    return { ok: false, error: "領収書の写真を付けてください" };
  }
  if (input.receiptCount > 3) return { ok: false, error: "領収書は3枚までです" };

  const lines = OPEN_SLOT_SUPPLY_ITEMS.flatMap((item) => {
    const picked = byKey.get(item.key);
    if (!picked) return [];
    if (item.key === "other") return [`その他: ${picked.note} × ${picked.quantity}`];
    return [`${item.label} × ${picked.quantity}`];
  });
  lines.push(`領収書: ${input.receiptCount}枚`);
  return { ok: true, detail: lines.join("\n") };
}
