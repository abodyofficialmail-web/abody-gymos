/** 今月の目標コマ数（30分換算） */
export const MONTHLY_SESSION_TARGET = 10;

/** 月半ば（15日）時点でフォローする予約回数の上限 */
export const MID_MONTH_LOW_BOOKING_MAX = 4;

export function isLowBookingMotivationNeed(count: number): boolean {
  return count <= MID_MONTH_LOW_BOOKING_MAX;
}

export function lowBookingMotivationBadgeClass(count: number): string {
  const base = "rounded-md px-1.5 py-0.5 text-[10px] font-bold";
  if (count === 0) return `${base} bg-rose-100 text-rose-900`;
  return `${base} bg-amber-100 text-amber-950`;
}

export function lowBookingMotivationBadgeLabel(count: number): string {
  return `今月${count}回・モチベアップ`;
}

export function lowBookingMotivationBannerText(count: number, monthLabel: string): string {
  return `${monthLabel}の予約が${count}回です。残り期間で${MONTHLY_SESSION_TARGET}コマを目標に、モチベーションアップをお願いします。`;
}
