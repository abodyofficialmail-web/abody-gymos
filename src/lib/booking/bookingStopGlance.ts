export type BookingStopGlance = {
  proposed: boolean;
  blockedDates: string[];
};

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

/** カルテと予約に出す一文。提案も日付の×もなければ null。 */
export function bookingStopGlanceLabel(input: BookingStopGlance & { todayYmd: string }): string | null {
  const dates = upcomingDates(input.blockedDates, input.todayYmd);
  if (!input.proposed && dates.length === 0) return null;
  const head = input.proposed ? "予約止め提案中" : "予約止め中";
  if (dates.length === 0) return head;
  const shown = dates.slice(0, 3).map(shortDate);
  const extra = dates.length > 3 ? ` ほか${dates.length - 3}日` : "";
  return `${head} ${shown.join("・")}${extra}`;
}
