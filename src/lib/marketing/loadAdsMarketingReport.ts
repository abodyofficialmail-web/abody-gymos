import { DateTime } from "luxon";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { lineChannelKeyForStoreName } from "@/lib/lineChannel";
import type { AdsMarketingReport, AdsReportKind, StoreAdsSlice } from "@/lib/marketing/types";

const TZ = "Asia/Tokyo";
const STORE_ORDER = ["恵比寿", "上野", "桜木町", "新宿", "福岡"];

type ServiceClient = SupabaseClient<Database>;

export function jstDayRangeUtc(startYmd: string, endYmd: string): { startIso: string; endExclusiveIso: string } {
  const start = DateTime.fromISO(startYmd, { zone: TZ }).startOf("day");
  const endExclusive = DateTime.fromISO(endYmd, { zone: TZ }).startOf("day").plus({ days: 1 });
  return { startIso: start.toUTC().toISO()!, endExclusiveIso: endExclusive.toUTC().toISO()! };
}

export function previousDateYmd(ymd: string): string {
  return DateTime.fromISO(ymd, { zone: TZ }).minus({ days: 1 }).toISODate()!;
}

function emptyHourCounts(): number[] {
  return Array.from({ length: 24 }, () => 0);
}

function emptyWeekdayCounts(): number[] {
  return Array.from({ length: 7 }, () => 0);
}

function weekdayIndexMon0(dt: DateTime): number {
  return (dt.weekday + 6) % 7;
}

function sortStores<T extends { store_name: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    const ai = STORE_ORDER.indexOf(a.store_name);
    const bi = STORE_ORDER.indexOf(b.store_name);
    const av = ai === -1 ? 99 : ai;
    const bv = bi === -1 ? 99 : bi;
    if (av !== bv) return av - bv;
    return a.store_name.localeCompare(b.store_name, "ja");
  });
}

function asMap<T>(rows: T[] | null | undefined, key: (row: T) => string): Map<string, T> {
  const out = new Map<string, T>();
  for (const row of rows ?? []) out.set(key(row), row);
  return out;
}

function num(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export async function loadAdsMarketingReport(params: {
  supabase: ServiceClient;
  kind: AdsReportKind;
  startYmd: string;
  endYmd: string;
  generatedAtYmd?: string;
}): Promise<AdsMarketingReport> {
  const { supabase, kind, startYmd, endYmd } = params;
  const generatedAtYmd = params.generatedAtYmd ?? DateTime.now().setZone(TZ).toISODate()!;
  const { startIso, endExclusiveIso } = jstDayRangeUtc(startYmd, endYmd);
  const prevStart = previousDateYmd(startYmd);

  const { data: storeRows, error: storeErr } = await supabase
    .from("stores")
    .select("id,name")
    .eq("is_active", true);
  if (storeErr) throw new Error(storeErr.message);
  const stores = (storeRows ?? []).map((s) => ({ id: String(s.id), name: String(s.name) }));

  const [followsQ, adsQ, igQ, lineSnapQ] = await Promise.all([
    supabase
      .from("line_follow_events" as any)
      .select("store_id,line_channel_key,line_user_id,event_type,followed_at")
      .gte("followed_at", startIso)
      .lt("followed_at", endExclusiveIso),
    supabase
      .from("meta_ads_daily_insights" as any)
      .select("store_id,insight_date,spend,impressions,clicks")
      .gte("insight_date", startYmd)
      .lte("insight_date", endYmd),
    supabase
      .from("instagram_follower_snapshots" as any)
      .select("store_id,snapshot_date,followers_count")
      .gte("snapshot_date", prevStart)
      .lte("snapshot_date", endYmd),
    supabase
      .from("line_follower_snapshots" as any)
      .select("store_id,snapshot_date,followers_count")
      .gte("snapshot_date", prevStart)
      .lte("snapshot_date", endYmd),
  ]);

  const missing = [followsQ, adsQ, igQ, lineSnapQ].find((q) => q.error && /does not exist|schema cache/i.test(q.error.message ?? ""));
  if (missing?.error) {
    const err = new Error("TABLE_MISSING");
    (err as any).detail = missing.error.message;
    throw err;
  }
  if (followsQ.error) throw new Error(followsQ.error.message);
  if (adsQ.error) throw new Error(adsQ.error.message);
  if (igQ.error) throw new Error(igQ.error.message);
  if (lineSnapQ.error) throw new Error(lineSnapQ.error.message);

  const adsByStore = new Map<string, { spend: number; impressions: number | null; clicks: number | null }>();
  for (const row of (adsQ.data ?? []) as any[]) {
    const id = String(row.store_id);
    const cur = adsByStore.get(id) ?? { spend: 0, impressions: 0, clicks: 0 };
    cur.spend += Number(row.spend ?? 0);
    const imp = num(row.impressions);
    const clk = num(row.clicks);
    cur.impressions = (cur.impressions ?? 0) + (imp ?? 0);
    cur.clicks = (cur.clicks ?? 0) + (clk ?? 0);
    adsByStore.set(id, cur);
  }
  const adsStoreIds = new Set(((adsQ.data ?? []) as any[]).map((r) => String(r.store_id)));

  const igByStoreDate = asMap((igQ.data ?? []) as any[], (r) => `${r.store_id}:${r.snapshot_date}`);
  const lineSnapByStoreDate = asMap((lineSnapQ.data ?? []) as any[], (r) => `${r.store_id}:${r.snapshot_date}`);

  const slices: StoreAdsSlice[] = stores.map((store) => {
    const events = ((followsQ.data ?? []) as any[]).filter((e) => String(e.store_id ?? "") === store.id);
    const hourCounts = emptyHourCounts();
    const weekdayCounts = emptyWeekdayCounts();
    const followUsers = new Set<string>();
    let unfollows = 0;
    for (const e of events) {
      const at = DateTime.fromISO(String(e.followed_at), { zone: "utc" }).setZone(TZ);
      if (!at.isValid) continue;
      if (e.event_type === "follow") {
        followUsers.add(String(e.line_user_id));
        hourCounts[at.hour] += 1;
        weekdayCounts[weekdayIndexMon0(at)] += 1;
      } else if (e.event_type === "unfollow") {
        unfollows += 1;
      }
    }

    const igEnd = igByStoreDate.get(`${store.id}:${endYmd}`);
    const igPrev = igByStoreDate.get(`${store.id}:${previousDateYmd(startYmd)}`);
    const igCount = num(igEnd?.followers_count);
    const igPrevCount = num(igPrev?.followers_count);

    const lineEnd = lineSnapByStoreDate.get(`${store.id}:${endYmd}`);
    const linePrev = lineSnapByStoreDate.get(`${store.id}:${previousDateYmd(startYmd)}`);
    const lineCount = num(lineEnd?.followers_count);
    const linePrevCount = num(linePrev?.followers_count);
    const lineDelta = lineCount != null && linePrevCount != null ? lineCount - linePrevCount : null;

    const ads = adsByStore.get(store.id);

    return {
      store_id: store.id,
      store_name: store.name,
      line_channel_key: lineChannelKeyForStoreName(store.name),
      spend: adsStoreIds.has(store.id) ? ads?.spend ?? 0 : null,
      impressions: adsStoreIds.has(store.id) ? ads?.impressions ?? null : null,
      clicks: adsStoreIds.has(store.id) ? ads?.clicks ?? null : null,
      instagram_followers: igCount,
      instagram_followers_delta: igCount != null && igPrevCount != null ? igCount - igPrevCount : null,
      line_followers: lineCount,
      line_followers_delta: lineDelta,
      line_adds: followUsers.size,
      line_unfollows: unfollows,
      hour_counts: hourCounts,
      weekday_counts: weekdayCounts,
    };
  });

  return {
    kind,
    startYmd,
    endYmd,
    generatedAtYmd,
    stores: sortStores(slices),
  };
}

export function dailyRangeYmd(now = DateTime.now().setZone(TZ)): { startYmd: string; endYmd: string } {
  const ymd = now.minus({ days: 1 }).toISODate()!;
  return { startYmd: ymd, endYmd: ymd };
}

export function weeklyRangeYmd(now = DateTime.now().setZone(TZ)): { startYmd: string; endYmd: string } {
  const endYmd = now.minus({ days: 1 }).toISODate()!;
  const startYmd = DateTime.fromISO(endYmd, { zone: TZ }).minus({ days: 6 }).toISODate()!;
  return { startYmd, endYmd };
}
