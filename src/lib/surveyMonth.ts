import { DateTime } from "luxon";

const TZ = "Asia/Tokyo";

/** JST の現在月キー（例: 2026-06） */
export function currentSurveyMonthKey(now = DateTime.now().setZone(TZ)): string {
  return now.toFormat("yyyy-MM");
}

export function surveyMonthLabel(monthKey: string): string {
  const [y, m] = monthKey.split("-");
  return `${Number(y)}年${Number(m)}月`;
}

export type SurveyMonthRange = {
  monthKey: string;
  startDate: string;
  endDate: string;
};

export function surveyMonthRange(monthKey = currentSurveyMonthKey()): SurveyMonthRange {
  const start = DateTime.fromFormat(`${monthKey}-01`, "yyyy-MM-dd", { zone: TZ });
  const end = start.endOf("month");
  return {
    monthKey,
    startDate: start.toISODate()!,
    endDate: end.toISODate()!,
  };
}

export function isYmdInSurveyMonth(ymd: string, monthKey = currentSurveyMonthKey()): boolean {
  const date = String(ymd ?? "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const { startDate, endDate } = surveyMonthRange(monthKey);
  return date >= startDate && date <= endDate;
}

export function isIsoInSurveyMonth(iso: string, monthKey = currentSurveyMonthKey()): boolean {
  const dt = DateTime.fromISO(iso).setZone(TZ);
  if (!dt.isValid) return false;
  return dt.toFormat("yyyy-MM") === monthKey;
}
