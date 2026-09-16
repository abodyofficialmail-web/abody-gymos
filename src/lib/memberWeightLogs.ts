import { DateTime } from "luxon";
import type { SupabaseClient } from "@supabase/supabase-js";

export const WEIGHT_LOG_TZ = "Asia/Tokyo";
export const WEIGHT_LOG_MIN_KG = 15;
export const WEIGHT_LOG_MAX_KG = 300;
export const WEIGHT_LOG_MIN_FAT = 3;
export const WEIGHT_LOG_MAX_FAT = 60;
export const WEIGHT_LOG_HISTORY_DAYS = 90;
export const WEIGHT_LOG_BACKFILL_DAYS = 30;

export type MemberWeightLogRow = {
  id: string;
  member_id: string;
  log_date: string;
  weight_kg: number;
  body_fat_pct?: number | null;
  created_at: string;
  updated_at: string;
};

export type MemberWeightLogView = {
  id: string;
  log_date: string;
  weight_kg: number;
  body_fat_pct: number | null;
  updated_at: string;
};

export type MemberWeightLogStats = {
  latest_kg: number | null;
  previous_kg: number | null;
  delta_kg: number | null;
  latest_fat_pct: number | null;
  previous_fat_pct: number | null;
  delta_fat_pct: number | null;
  week_avg_kg: number | null;
  month_avg_kg: number | null;
  change_7d_kg: number | null;
  change_7d_fat_pct: number | null;
  logged_days_30: number;
};

export function tokyoTodayYmd(now = DateTime.now().setZone(WEIGHT_LOG_TZ)): string {
  return now.toFormat("yyyy-MM-dd");
}

export function isYmd(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && DateTime.fromISO(value, { zone: WEIGHT_LOG_TZ }).isValid;
}

export function parseWeightKg(raw: unknown): number | null {
  const n = typeof raw === "number" ? raw : typeof raw === "string" ? Number(String(raw).trim().replace(",", ".")) : NaN;
  if (!Number.isFinite(n)) return null;
  const rounded = Math.round(n * 10) / 10;
  if (rounded < WEIGHT_LOG_MIN_KG || rounded > WEIGHT_LOG_MAX_KG) return null;
  return rounded;
}

export function parseBodyFatPct(raw: unknown): number | null {
  if (raw == null || raw === "") return null;
  const n = typeof raw === "number" ? raw : Number(String(raw).trim().replace(",", "."));
  if (!Number.isFinite(n)) return null;
  const rounded = Math.round(n * 10) / 10;
  if (rounded < WEIGHT_LOG_MIN_FAT || rounded > WEIGHT_LOG_MAX_FAT) return null;
  return rounded;
}

export function isEmptyBodyFatInput(raw: unknown): boolean {
  return raw == null || String(raw).trim() === "";
}

export function isLogDateAllowed(logDate: string, today = tokyoTodayYmd()): boolean {
  if (!isYmd(logDate) || logDate > today) return false;
  const min = DateTime.fromISO(today, { zone: WEIGHT_LOG_TZ }).minus({ days: WEIGHT_LOG_BACKFILL_DAYS }).toFormat("yyyy-MM-dd");
  return logDate >= min;
}

function avg(values: number[]): number | null {
  if (values.length === 0) return null;
  return Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10;
}

function kgOf(row: { weight_kg: unknown } | null | undefined): number | null {
  if (!row) return null;
  const n = Number(row.weight_kg);
  return Number.isFinite(n) ? Math.round(n * 10) / 10 : null;
}

export function toWeightLogView(row: MemberWeightLogRow): MemberWeightLogView {
  const fat = row.body_fat_pct == null ? null : Number(row.body_fat_pct);
  return {
    id: row.id,
    log_date: row.log_date,
    weight_kg: kgOf(row) ?? 0,
    body_fat_pct: Number.isFinite(fat) ? Math.round((fat as number) * 10) / 10 : null,
    updated_at: row.updated_at,
  };
}

export function buildWeightLogStats(logs: MemberWeightLogView[], today = tokyoTodayYmd()): MemberWeightLogStats {
  const sorted = [...logs].sort((a, b) => (a.log_date < b.log_date ? 1 : a.log_date > b.log_date ? -1 : 0));
  const latest = sorted[0] ?? null;
  const previous = sorted[1] ?? null;
  const latestKg = latest?.weight_kg ?? null;
  const previousKg = previous?.weight_kg ?? null;
  const todayDt = DateTime.fromISO(today, { zone: WEIGHT_LOG_TZ });
  const weekFrom = todayDt.minus({ days: 6 }).toFormat("yyyy-MM-dd");
  const monthFrom = todayDt.minus({ days: 29 }).toFormat("yyyy-MM-dd");
  const week7From = todayDt.minus({ days: 7 }).toFormat("yyyy-MM-dd");

  const weekVals = sorted.filter((r) => r.log_date >= weekFrom).map((r) => r.weight_kg);
  const monthVals = sorted.filter((r) => r.log_date >= monthFrom).map((r) => r.weight_kg);
  const around7d = sorted.find((r) => r.log_date <= week7From)?.weight_kg ?? null;
  const latestFatRow = sorted.find((r) => r.body_fat_pct != null) ?? null;
  const latestFat = latestFatRow?.body_fat_pct ?? null;
  const previousFat =
    sorted.find((r) => r.body_fat_pct != null && r.log_date !== latestFatRow?.log_date)?.body_fat_pct ?? null;
  const around7dFat = sorted.find((r) => r.log_date <= week7From && r.body_fat_pct != null)?.body_fat_pct ?? null;

  return {
    latest_kg: latestKg,
    previous_kg: previousKg,
    delta_kg: latestKg != null && previousKg != null ? Math.round((latestKg - previousKg) * 10) / 10 : null,
    latest_fat_pct: latestFat,
    previous_fat_pct: previousFat,
    delta_fat_pct: latestFat != null && previousFat != null ? Math.round((latestFat - previousFat) * 10) / 10 : null,
    week_avg_kg: avg(weekVals),
    month_avg_kg: avg(monthVals),
    change_7d_kg: latestKg != null && around7d != null ? Math.round((latestKg - around7d) * 10) / 10 : null,
    change_7d_fat_pct: latestFat != null && around7dFat != null ? Math.round((latestFat - around7dFat) * 10) / 10 : null,
    logged_days_30: monthVals.length,
  };
}

export function isMissingWeightLogTable(err: { code?: string; message?: string } | null | undefined): boolean {
  const c = String(err?.code ?? "");
  const m = String(err?.message ?? "");
  return (
    c === "PGRST205" ||
    m.includes("member_weight_logs") ||
    m.includes("morning_weight_reminder_dispatches") ||
    m.includes("Could not find the table")
  );
}

function isMissingBodyFatColumn(err: { message?: string } | null | undefined): boolean {
  const m = String(err?.message ?? "");
  return /body_fat_pct/i.test(m) && (/does not exist|column|PGRST/i.test(m) || /schema cache/i.test(m));
}

export async function listMemberWeightLogs(
  supabase: SupabaseClient,
  memberId: string,
  today = tokyoTodayYmd()
): Promise<{ ok: true; logs: MemberWeightLogView[] } | { ok: false; error: string; missingTable?: boolean }> {
  const from = DateTime.fromISO(today, { zone: WEIGHT_LOG_TZ })
    .minus({ days: WEIGHT_LOG_HISTORY_DAYS })
    .toFormat("yyyy-MM-dd");
  const first = await supabase
    .from("member_weight_logs")
    .select("id, member_id, log_date, weight_kg, body_fat_pct, created_at, updated_at")
    .eq("member_id", memberId)
    .gte("log_date", from)
    .lte("log_date", today)
    .order("log_date", { ascending: false });
  let data: unknown = first.data;
  let error = first.error;
  if (error && isMissingBodyFatColumn(error)) {
    const second = await supabase
      .from("member_weight_logs")
      .select("id, member_id, log_date, weight_kg, created_at, updated_at")
      .eq("member_id", memberId)
      .gte("log_date", from)
      .lte("log_date", today)
      .order("log_date", { ascending: false });
    data = second.data;
    error = second.error;
  }
  if (error) {
    return { ok: false, error: error.message, missingTable: isMissingWeightLogTable(error) };
  }
  const logs = ((data ?? []) as MemberWeightLogRow[]).map(toWeightLogView);
  return { ok: true, logs };
}

export async function upsertMemberWeightLog(
  supabase: SupabaseClient,
  params: { memberId: string; logDate: string; weightKg: number; bodyFatPct?: number | null }
): Promise<{ ok: true; log: MemberWeightLogView } | { ok: false; error: string; missingTable?: boolean }> {
  const now = new Date().toISOString();
  const withFat = {
    member_id: params.memberId,
    log_date: params.logDate,
    weight_kg: params.weightKg,
    body_fat_pct: params.bodyFatPct ?? null,
    updated_at: now,
  };
  const legacy = {
    member_id: params.memberId,
    log_date: params.logDate,
    weight_kg: params.weightKg,
    updated_at: now,
  };
  const first = await supabase
    .from("member_weight_logs")
    .upsert(withFat, { onConflict: "member_id,log_date" })
    .select("id, member_id, log_date, weight_kg, body_fat_pct, created_at, updated_at")
    .maybeSingle();
  let data: unknown = first.data;
  let error = first.error;
  if (error && isMissingBodyFatColumn(error)) {
    if (params.bodyFatPct != null) {
      return { ok: false, error: "体脂肪を保存する準備ができていません。しばらくしてからお試しください。" };
    }
    const second = await supabase
      .from("member_weight_logs")
      .upsert(legacy, { onConflict: "member_id,log_date" })
      .select("id, member_id, log_date, weight_kg, created_at, updated_at")
      .maybeSingle();
    data = second.data;
    error = second.error;
  }
  if (error) {
    return { ok: false, error: error.message, missingTable: isMissingWeightLogTable(error) };
  }
  if (!data) return { ok: false, error: "保存結果を取得できませんでした" };
  return { ok: true, log: toWeightLogView(data as MemberWeightLogRow) };
}
