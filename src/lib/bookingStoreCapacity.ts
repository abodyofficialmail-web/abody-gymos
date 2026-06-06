/** シフトが複数重なっても同時予約枠を1つに固定する店舗 */
const SINGLE_SLOT_STORE_NAMES = new Set(["新宿"]);

/**
 * 店舗ごとの同時予約可能数を返す。
 * 通常はシフト人数＝capacity。新宿店のみ常に最大1。
 */
export function effectiveBookingCapacity(params: {
  storeName?: string | null;
  trainerCount: number;
}): number {
  const { storeName, trainerCount } = params;
  if (trainerCount <= 0) return 0;
  const name = String(storeName ?? "").trim();
  if (SINGLE_SLOT_STORE_NAMES.has(name)) return 1;
  return trainerCount;
}
