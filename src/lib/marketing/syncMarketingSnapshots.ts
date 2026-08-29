import { DateTime } from "luxon";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import {
  LINE_CHANNEL_KEYS,
  lineAccessTokenForChannelKey,
} from "@/lib/lineChannel";
import type { MetaStoreAccountConfig } from "@/lib/marketing/types";
import { storeIdForLineChannelKey } from "@/lib/marketing/lineFollowEvents";

const TZ = "Asia/Tokyo";
const META_GRAPH_VERSION = "v21.0";

type ServiceClient = SupabaseClient<Database>;

export function parseMetaStoreAccounts(raw: string | null | undefined): MetaStoreAccountConfig[] {
  const text = String(raw ?? "").trim();
  if (!text) return [];
  try {
    const parsed = JSON.parse(text) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((row) => {
      if (!row || typeof row !== "object") return [];
      const r = row as Record<string, unknown>;
      const store_name = String(r.store_name ?? r.storeName ?? "").trim();
      if (!store_name) return [];
      const cfg: MetaStoreAccountConfig = { store_name };
      const ad = String(r.ad_account_id ?? r.adAccountId ?? "").trim();
      const ig = String(r.ig_user_id ?? r.igUserId ?? "").trim();
      const username = String(r.instagram_username ?? r.instagramUsername ?? "").trim();
      if (ad) cfg.ad_account_id = ad;
      if (ig) cfg.ig_user_id = ig;
      if (username) cfg.instagram_username = username;
      return [cfg];
    });
  } catch {
    return [];
  }
}

function normalizeAdAccountId(raw: string): string {
  const id = raw.trim();
  if (!id) return "";
  return id.startsWith("act_") ? id : `act_${id}`;
}

async function fetchJson(
  url: string,
  headers?: Record<string, string>
): Promise<{ ok: boolean; status: number; json: any; text: string }> {
  const res = await fetch(url, { cache: "no-store", headers });
  const text = await res.text().catch(() => "");
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { ok: res.ok, status: res.status, json, text };
}

async function fetchLineFollowerInsight(
  token: string
): Promise<{ followers: number; blocks: number | null } | null> {
  const res = await fetchJson("https://api.line.me/v2/bot/insight/followers", {
    Authorization: `Bearer ${token}`,
  });
  if (!res.ok) return null;
  const status = String(res.json?.status ?? "");
  if (status && status !== "ready") return null;
  const followers = Number(res.json?.followers);
  if (!Number.isFinite(followers)) return null;
  const blocksRaw = res.json?.blocks;
  const blocks = blocksRaw == null ? null : Number(blocksRaw);
  return { followers, blocks: Number.isFinite(blocks as number) ? (blocks as number) : null };
}

async function fetchInstagramFollowers(
  token: string,
  igUserId: string
): Promise<{ followers: number; username: string | null } | null> {
  const url = new URL(`https://graph.facebook.com/${META_GRAPH_VERSION}/${encodeURIComponent(igUserId)}`);
  url.searchParams.set("fields", "followers_count,username");
  url.searchParams.set("access_token", token);
  const res = await fetchJson(url.toString());
  if (!res.ok) return null;
  const followers = Number(res.json?.followers_count);
  if (!Number.isFinite(followers)) return null;
  return { followers, username: res.json?.username ? String(res.json.username) : null };
}

async function fetchMetaAdsSpend(
  token: string,
  adAccountId: string,
  ymd: string
): Promise<{ spend: number; impressions: number | null; clicks: number | null; reach: number | null; raw: unknown } | null> {
  const url = new URL(
    `https://graph.facebook.com/${META_GRAPH_VERSION}/${encodeURIComponent(normalizeAdAccountId(adAccountId))}/insights`
  );
  url.searchParams.set("fields", "spend,impressions,clicks,reach");
  url.searchParams.set("level", "account");
  url.searchParams.set("time_range", JSON.stringify({ since: ymd, until: ymd }));
  url.searchParams.set("access_token", token);
  const res = await fetchJson(url.toString());
  if (!res.ok) return null;
  const row = Array.isArray(res.json?.data) ? res.json.data[0] : null;
  if (!row) {
    return { spend: 0, impressions: 0, clicks: 0, reach: 0, raw: res.json };
  }
  const spend = Number(row.spend ?? 0);
  const impressions = row.impressions == null ? null : Number(row.impressions);
  const clicks = row.clicks == null ? null : Number(row.clicks);
  const reach = row.reach == null ? null : Number(row.reach);
  return {
    spend: Number.isFinite(spend) ? spend : 0,
    impressions: Number.isFinite(impressions as number) ? impressions : null,
    clicks: Number.isFinite(clicks as number) ? clicks : null,
    reach: Number.isFinite(reach as number) ? reach : null,
    raw: row,
  };
}

async function loadActiveStores(supabase: ServiceClient): Promise<Array<{ id: string; name: string }>> {
  const { data, error } = await supabase.from("stores").select("id,name").eq("is_active", true);
  if (error) throw new Error(error.message);
  return (data ?? []).map((s) => ({ id: String(s.id), name: String(s.name) }));
}

async function applyEnvAccounts(supabase: ServiceClient, stores: Array<{ id: string; name: string }>) {
  const configs = parseMetaStoreAccounts(process.env.META_STORE_ACCOUNTS);
  if (configs.length === 0) return;
  for (const cfg of configs) {
    const store = stores.find((s) => s.name === cfg.store_name);
    if (!store) continue;
    const { error } = await supabase.from("store_marketing_accounts" as any).upsert(
      {
        store_id: store.id,
        instagram_username: cfg.instagram_username ?? null,
        instagram_user_id: cfg.ig_user_id ?? null,
        meta_ad_account_id: cfg.ad_account_id ? normalizeAdAccountId(cfg.ad_account_id) : null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "store_id" }
    );
    if (error) console.warn("[marketingSync] account upsert failed", store.name, error.message);
  }
}

export async function syncMarketingSnapshots(params: {
  supabase: ServiceClient;
  insightDateYmd: string;
  snapshotDateYmd?: string;
}): Promise<{
  insight_date: string;
  snapshot_date: string;
  line: Array<{ store: string; ok: boolean; followers?: number; error?: string }>;
  instagram: Array<{ store: string; ok: boolean; followers?: number; error?: string }>;
  ads: Array<{ store: string; ok: boolean; spend?: number; error?: string }>;
}> {
  const insightDate = params.insightDateYmd;
  const snapshotDate = params.snapshotDateYmd ?? DateTime.now().setZone(TZ).toISODate()!;
  const stores = await loadActiveStores(params.supabase);
  await applyEnvAccounts(params.supabase, stores);

  const metaToken = process.env.META_ACCESS_TOKEN?.trim() || "";
  const { data: accountRows } = await params.supabase
    .from("store_marketing_accounts" as any)
    .select("store_id, instagram_username, instagram_user_id, meta_ad_account_id");
  const accountByStore = new Map<string, any>(
    (accountRows ?? []).map((r: any) => [String(r.store_id), r])
  );

  const line: Array<{ store: string; ok: boolean; followers?: number; error?: string }> = [];
  const instagram: Array<{ store: string; ok: boolean; followers?: number; error?: string }> = [];
  const ads: Array<{ store: string; ok: boolean; spend?: number; error?: string }> = [];

  for (const key of LINE_CHANNEL_KEYS) {
    const storeId = await storeIdForLineChannelKey(params.supabase, key);
    const token = lineAccessTokenForChannelKey(key);
    const storeName = stores.find((s) => s.id === storeId)?.name ?? key;
    if (!storeId || !token) {
      line.push({ store: storeName, ok: false, error: !storeId ? "store_missing" : "token_missing" });
      continue;
    }
    const insight = await fetchLineFollowerInsight(token);
    if (!insight) {
      line.push({ store: storeName, ok: false, error: "insight_unready" });
      continue;
    }
    const { error } = await params.supabase.from("line_follower_snapshots" as any).upsert(
      {
        store_id: storeId,
        line_channel_key: key,
        snapshot_date: snapshotDate,
        followers_count: insight.followers,
        blocks: insight.blocks,
        source: "line_insight",
        captured_at: new Date().toISOString(),
      },
      { onConflict: "store_id,snapshot_date" }
    );
    if (error) line.push({ store: storeName, ok: false, error: error.message });
    else line.push({ store: storeName, ok: true, followers: insight.followers });
  }

  for (const store of stores) {
    const acc = accountByStore.get(store.id);
    const igUserId = String(acc?.instagram_user_id ?? "").trim();
    const adAccountId = String(acc?.meta_ad_account_id ?? "").trim();

    if (metaToken && igUserId) {
      const ig = await fetchInstagramFollowers(metaToken, igUserId);
      if (!ig) {
        instagram.push({ store: store.name, ok: false, error: "ig_fetch_failed" });
      } else {
        const { error } = await params.supabase.from("instagram_follower_snapshots" as any).upsert(
          {
            store_id: store.id,
            snapshot_date: snapshotDate,
            followers_count: ig.followers,
            source: "meta_api",
            captured_at: new Date().toISOString(),
          },
          { onConflict: "store_id,snapshot_date" }
        );
        if (error) instagram.push({ store: store.name, ok: false, error: error.message });
        else instagram.push({ store: store.name, ok: true, followers: ig.followers });
      }
    } else {
      instagram.push({ store: store.name, ok: false, error: metaToken ? "ig_user_id_missing" : "meta_token_missing" });
    }

    if (metaToken && adAccountId) {
      const insight = await fetchMetaAdsSpend(metaToken, adAccountId, insightDate);
      if (!insight) {
        ads.push({ store: store.name, ok: false, error: "ads_fetch_failed" });
      } else {
        const { error } = await params.supabase.from("meta_ads_daily_insights" as any).upsert(
          {
            store_id: store.id,
            insight_date: insightDate,
            spend: insight.spend,
            impressions: insight.impressions,
            clicks: insight.clicks,
            reach: insight.reach,
            source: "meta_api",
            raw: insight.raw,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "store_id,insight_date" }
        );
        if (error) ads.push({ store: store.name, ok: false, error: error.message });
        else ads.push({ store: store.name, ok: true, spend: insight.spend });
      }
    } else {
      ads.push({ store: store.name, ok: false, error: metaToken ? "ad_account_missing" : "meta_token_missing" });
    }
  }

  return { insight_date: insightDate, snapshot_date: snapshotDate, line, instagram, ads };
}
