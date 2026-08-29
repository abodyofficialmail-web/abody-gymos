import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import type { LineChannelKey } from "@/lib/lineChannel";
import { storeNameForLineChannelKey } from "@/lib/lineChannel";

type ServiceClient = SupabaseClient<Database>;

const storeIdCache = new Map<string, string | null>();

export async function storeIdForLineChannelKey(
  supabase: ServiceClient,
  key: LineChannelKey
): Promise<string | null> {
  if (storeIdCache.has(key)) return storeIdCache.get(key) ?? null;
  const name = storeNameForLineChannelKey(key);
  if (!name) {
    storeIdCache.set(key, null);
    return null;
  }
  const { data, error } = await supabase.from("stores").select("id").eq("name", name).maybeSingle();
  if (error) {
    console.warn("[lineFollowEvents] store lookup failed", key, error.message);
    return null;
  }
  const id = data?.id ? String(data.id) : null;
  storeIdCache.set(key, id);
  return id;
}

export async function recordLineFollowEvent(params: {
  supabase: ServiceClient;
  channelKey: LineChannelKey;
  lineUserId: string;
  eventType: "follow" | "unfollow";
  timestampMs?: number | null;
}): Promise<{ ok: boolean; skipped?: boolean; error?: string }> {
  const userId = params.lineUserId.trim();
  if (!userId) return { ok: false, error: "missing_line_user_id" };
  const followedAt = params.timestampMs
    ? new Date(params.timestampMs).toISOString()
    : new Date().toISOString();
  const storeId = await storeIdForLineChannelKey(params.supabase, params.channelKey);

  const { error } = await params.supabase.from("line_follow_events").upsert(
    {
      line_channel_key: params.channelKey,
      store_id: storeId,
      line_user_id: userId,
      event_type: params.eventType,
      followed_at: followedAt,
    },
    { onConflict: "line_channel_key,line_user_id,event_type,followed_at", ignoreDuplicates: true }
  );
  if (error) {
    const msg = String(error.message ?? "");
    if (/line_follow_events|does not exist|schema cache/i.test(msg)) {
      console.warn("[lineFollowEvents] table missing", msg);
      return { ok: false, error: "table_missing" };
    }
    console.error("[lineFollowEvents] insert failed", msg);
    return { ok: false, error: msg };
  }
  return { ok: true };
}
