import { DateTime } from "luxon";

const TZ = "Asia/Tokyo";

/** 当月はこの回数未満なら対象。前月はこの回数以下なら対象 */
export const NEXT_BOOKING_MONTH_MAX = 8;

/** 15日以降、当月1〜15日がこの回数未満なら追加対象 */
export const NEXT_BOOKING_FIRST_HALF_MIN = 5;

/** これ以降は「前月の回数」で見る（2026-09-01 = 8月実績） */
export const NEXT_BOOKING_PREV_MONTH_RULE_START = "2026-09-01";

/** これ以降、毎月15日から前半月の回数も見る */
export const NEXT_BOOKING_FIRST_HALF_RULE_START = "2026-09-15";

export type NextBookingAudienceCounts = {
  thisMonthCount: number;
  prevMonthCount: number;
  firstHalfCount: number;
};

export type NextBookingAudienceReason = "this_month_under_8" | "prev_month_max_8" | "first_half_under_5";

export function countSessionsInRange(
  startAts: string[],
  rangeStart: DateTime,
  rangeEnd: DateTime
): number {
  return startAts.filter((iso) => {
    const d = DateTime.fromISO(iso).setZone(TZ);
    return d.isValid && d >= rangeStart && d <= rangeEnd;
  }).length;
}

export function sessionCountsForNextBooking(
  startAts: string[],
  now = DateTime.now().setZone(TZ)
): NextBookingAudienceCounts {
  const n = now.setZone(TZ);
  const monthStart = n.startOf("month");
  const prevStart = monthStart.minus({ months: 1 });
  const firstHalfEnd = n.set({ day: 15 }).endOf("day");
  return {
    thisMonthCount: countSessionsInRange(startAts, monthStart, n),
    prevMonthCount: countSessionsInRange(startAts, prevStart, monthStart.minus({ milliseconds: 1 })),
    firstHalfCount: countSessionsInRange(startAts, monthStart, firstHalfEnd < n ? firstHalfEnd : n),
  };
}

export function nextBookingAudience(
  now: DateTime,
  counts: NextBookingAudienceCounts
): { eligible: boolean; reasons: NextBookingAudienceReason[] } {
  const n = now.setZone(TZ);
  const prevRuleStart = DateTime.fromISO(NEXT_BOOKING_PREV_MONTH_RULE_START, { zone: TZ }).startOf("day");
  const firstHalfRuleStart = DateTime.fromISO(NEXT_BOOKING_FIRST_HALF_RULE_START, { zone: TZ }).startOf("day");
  const reasons: NextBookingAudienceReason[] = [];

  if (n < prevRuleStart) {
    if (counts.thisMonthCount < NEXT_BOOKING_MONTH_MAX) reasons.push("this_month_under_8");
    return { eligible: reasons.length > 0, reasons };
  }

  if (counts.prevMonthCount <= NEXT_BOOKING_MONTH_MAX) reasons.push("prev_month_max_8");
  if (n >= firstHalfRuleStart && n.day >= 15 && counts.firstHalfCount < NEXT_BOOKING_FIRST_HALF_MIN) {
    reasons.push("first_half_under_5");
  }
  return { eligible: reasons.length > 0, reasons };
}
