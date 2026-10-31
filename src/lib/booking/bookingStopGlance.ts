import { DateTime } from "luxon";

function komaForVisit(startAtIso: string, endAtIso: string, zone: string): number {
  const start = DateTime.fromISO(startAtIso, { setZone: true }).setZone(zone);
  const end = DateTime.fromISO(endAtIso, { setZone: true }).setZone(zone);
  const minutes = end.diff(start, "minutes").minutes;
  if (!Number.isFinite(minutes) || minutes <= 0) return 1;
  return Math.max(1, Math.round(minutes / 30));
}

export const BOOKING_STOP_LAST_MONTH_VISITS = 12;
export const BOOKING_STOP_FIRST_WEEK_KOMA = 4;

export type BookingStopGlance = {
  proposed: boolean;
  blockedDates: string[];
  lastMonthVisits?: number | null;
  firstWeekKoma?: number | null;
};

export type BookingStopCountReservation = {
  start_at: string;
  end_at: string;
  status?: string | null;
};

/** 先月1日〜今月末日の前日までが先月。1週目は今月1日〜7日。 */
export function bookingStopCountQueryRange(todayYmd: string, zone = "Asia/Tokyo") {
  const monthStart = DateTime.fromISO(todayYmd, { zone }).startOf("month");
  const lastMonthStart = monthStart.minus({ months: 1 });
  const firstWeekEnd = monthStart.plus({ days: 7 });
  return {
    queryStartIso: lastMonthStart.toUTC().toISO()!,
    queryEndIso: firstWeekEnd.toUTC().toISO()!,
  };
}

export function summarizeBookingStopCounts(params: {
  reservations: BookingStopCountReservation[];
  todayYmd: string;
  zone?: string;
}): { lastMonthVisits: number; firstWeekKoma: number } {
  const zone = params.zone ?? "Asia/Tokyo";
  const monthStart = DateTime.fromISO(params.todayYmd, { zone }).startOf("month");
  const lastMonthStart = monthStart.minus({ months: 1 });
  const firstWeekEnd = monthStart.plus({ days: 7 });
  let lastMonthVisits = 0;
  let firstWeekKoma = 0;
  for (const row of params.reservations) {
    if (String(row.status ?? "confirmed").trim().toLowerCase() === "cancelled") continue;
    const start = DateTime.fromISO(row.start_at, { setZone: true }).setZone(zone);
    if (!start.isValid) continue;
    if (start >= lastMonthStart && start < monthStart) lastMonthVisits += 1;
    if (start >= monthStart && start < firstWeekEnd) {
      firstWeekKoma += komaForVisit(row.start_at, row.end_at, zone);
    }
  }
  return { lastMonthVisits, firstWeekKoma };
}

export function bookingStopCountReasons(input: {
  lastMonthVisits?: number | null;
  firstWeekKoma?: number | null;
}): string[] {
  const reasons: string[] = [];
  if ((input.lastMonthVisits ?? 0) >= BOOKING_STOP_LAST_MONTH_VISITS) {
    reasons.push(`先月${input.lastMonthVisits}回`);
  }
  if ((input.firstWeekKoma ?? 0) >= BOOKING_STOP_FIRST_WEEK_KOMA) {
    reasons.push(`1週目${input.firstWeekKoma}コマ`);
  }
  return reasons;
}

function upcomingDates(blockedDates: string[], todayYmd: string): string[] {
  const seen = new Set<string>();
  for (const raw of blockedDates) {
    const ymd = String(raw ?? "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/u.test(ymd)) continue;
    if (ymd < todayYmd) continue;
    seen.add(ymd);
  }
  return [...seen].sort();
}

function shortDate(ymd: string): string {
  return ymd.slice(5).replace("-", "/");
}

/** カルテと予約に出す一文。提案も日付の×も回数の基準もなければ null。 */
export function bookingStopGlanceLabel(input: BookingStopGlance & { todayYmd: string }): string | null {
  const dates = upcomingDates(input.blockedDates, input.todayYmd);
  const reasons = bookingStopCountReasons(input);
  if (!input.proposed && dates.length === 0 && reasons.length === 0) return null;
  const head = input.proposed ? "予約止め提案中" : dates.length > 0 ? "予約止め中" : "止め候補";
  const parts = [head];
  if (dates.length > 0) {
    const shown = dates.slice(0, 3).map(shortDate);
    const extra = dates.length > 3 ? ` ほか${dates.length - 3}日` : "";
    parts.push(`${shown.join("・")}${extra}`);
  }
  if (reasons.length > 0) parts.push(reasons.join("・"));
  return parts.join(" ");
}
