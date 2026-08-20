/**
 * 会員向け予約を閉じる日付（YYYY-MM-DD）。
 * available-dates / available-slots / reservations POST で共通利用。
 */
export function isBookingClosedDate(ymd: string): boolean {
  const d = String(ymd);
  // 2026年4月: 一旦クローズ
  if (d.startsWith("2026-04-")) return true;
  // 2026-08-17: 研修のため全店舗クローズ
  if (d === "2026-08-17") return true;
  // 2026-08-25: 講習会（シフトなし運用と併用）
  if (d === "2026-08-25") return true;
  return false;
}
