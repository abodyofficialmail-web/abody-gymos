import { DateTime } from "luxon";
import { z } from "zod";
import { jsonResponse } from "@/app/api/booking-v2/_cors";
import { createSupabaseServiceClient } from "@/lib/supabase/admin";
import {
  dailyRangeYmd,
  loadAdsMarketingReport,
  weeklyRangeYmd,
} from "@/lib/marketing/loadAdsMarketingReport";
import { formatAdsMarketingReport } from "@/lib/marketing/formatAdsMarketingReport";
import { sendAdsMarketingReport } from "@/lib/marketing/sendAdsMarketingReport";
import { syncMarketingSnapshots } from "@/lib/marketing/syncMarketingSnapshots";
import type { AdsReportKind } from "@/lib/marketing/types";

const TZ = "Asia/Tokyo";

const getSchema = z.object({
  kind: z.enum(["daily", "weekly"]).optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

const manualSchema = z.object({
  action: z.literal("manual_metrics"),
  store_id: z.string().uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  spend: z.coerce.number().min(0).nullable().optional(),
  instagram_followers: z.coerce.number().int().min(0).nullable().optional(),
});

const accountSchema = z.object({
  action: z.literal("save_account"),
  store_id: z.string().uuid(),
  instagram_username: z.string().trim().nullable().optional(),
  instagram_user_id: z.string().trim().nullable().optional(),
  meta_ad_account_id: z.string().trim().nullable().optional(),
});

const sendSchema = z.object({
  action: z.literal("send"),
  kind: z.enum(["daily", "weekly"]),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

const syncSchema = z.object({
  action: z.literal("sync"),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

function rangeFor(kind: AdsReportKind, opts: { date?: string; start?: string; end?: string }) {
  const now = DateTime.now().setZone(TZ);
  if (kind === "weekly") {
    if (opts.start && opts.end) return { startYmd: opts.start, endYmd: opts.end };
    if (opts.date) {
      const end = DateTime.fromISO(opts.date, { zone: TZ });
      return { startYmd: end.minus({ days: 6 }).toISODate()!, endYmd: end.toISODate()! };
    }
    return weeklyRangeYmd(now);
  }
  const ymd = opts.date ?? dailyRangeYmd(now).startYmd;
  return { startYmd: ymd, endYmd: ymd };
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const parsed = getSchema.safeParse({
      kind: url.searchParams.get("kind") ?? undefined,
      date: url.searchParams.get("date") ?? undefined,
      start: url.searchParams.get("start") ?? undefined,
      end: url.searchParams.get("end") ?? undefined,
    });
    if (!parsed.success) return jsonResponse({ error: "invalid_query", detail: parsed.error.flatten() }, 400);

    const kind = parsed.data.kind ?? "daily";
    const range = rangeFor(kind, parsed.data);
    const supabase = createSupabaseServiceClient();

    const [{ data: stores }, accountsQ] = await Promise.all([
      supabase.from("stores").select("id,name").eq("is_active", true).order("name"),
      supabase.from("store_marketing_accounts").select("store_id,instagram_username,instagram_user_id,meta_ad_account_id"),
    ]);
    const accountsMissing = accountsQ.error && /does not exist|schema cache/i.test(accountsQ.error.message ?? "");
    if (accountsQ.error && !accountsMissing) {
      return jsonResponse({ error: "accounts_fetch_failed", detail: accountsQ.error.message }, 500);
    }

    const report = await loadAdsMarketingReport({
      supabase,
      kind,
      startYmd: range.startYmd,
      endYmd: range.endYmd,
    });

    return jsonResponse({
      ok: true,
      kind,
      start: range.startYmd,
      end: range.endYmd,
      report,
      preview: formatAdsMarketingReport(report, { allStores: true }),
      stores: stores ?? [],
      accounts: accountsMissing ? [] : accountsQ.data ?? [],
      meta_token_configured: Boolean(process.env.META_ACCESS_TOKEN?.trim()),
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const status = message === "TABLE_MISSING" ? 503 : 500;
    return jsonResponse(
      {
        error: status === 503 ? "tables_missing" : "unexpected_error",
        detail: (e as any)?.detail ?? message,
      },
      status
    );
  }
}

export async function POST(req: Request) {
  try {
    const json = await req.json().catch(() => null);
    const action = String((json as any)?.action ?? "");
    const supabase = createSupabaseServiceClient();

    if (action === "manual_metrics") {
      const parsed = manualSchema.safeParse(json);
      if (!parsed.success) return jsonResponse({ error: "invalid_body", detail: parsed.error.flatten() }, 400);
      const now = new Date().toISOString();
      if (parsed.data.spend != null) {
        const { error } = await supabase.from("meta_ads_daily_insights" as any).upsert(
          {
            store_id: parsed.data.store_id,
            insight_date: parsed.data.date,
            spend: parsed.data.spend,
            source: "manual",
            updated_at: now,
          },
          { onConflict: "store_id,insight_date" }
        );
        if (error) return jsonResponse({ error: "spend_save_failed", detail: error.message }, 500);
      }
      if (parsed.data.instagram_followers != null) {
        const { error } = await supabase.from("instagram_follower_snapshots" as any).upsert(
          {
            store_id: parsed.data.store_id,
            snapshot_date: parsed.data.date,
            followers_count: parsed.data.instagram_followers,
            source: "manual",
            captured_at: now,
          },
          { onConflict: "store_id,snapshot_date" }
        );
        if (error) return jsonResponse({ error: "followers_save_failed", detail: error.message }, 500);
      }
      return jsonResponse({ ok: true });
    }

    if (action === "save_account") {
      const parsed = accountSchema.safeParse(json);
      if (!parsed.success) return jsonResponse({ error: "invalid_body", detail: parsed.error.flatten() }, 400);
      const adId = String(parsed.data.meta_ad_account_id ?? "").trim();
      const { error } = await supabase.from("store_marketing_accounts" as any).upsert(
        {
          store_id: parsed.data.store_id,
          instagram_username: parsed.data.instagram_username || null,
          instagram_user_id: parsed.data.instagram_user_id || null,
          meta_ad_account_id: adId ? (adId.startsWith("act_") ? adId : `act_${adId}`) : null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "store_id" }
      );
      if (error) return jsonResponse({ error: "account_save_failed", detail: error.message }, 500);
      return jsonResponse({ ok: true });
    }

    if (action === "sync") {
      const parsed = syncSchema.safeParse(json);
      if (!parsed.success) return jsonResponse({ error: "invalid_body", detail: parsed.error.flatten() }, 400);
      const date = parsed.data.date ?? DateTime.now().setZone(TZ).minus({ days: 1 }).toISODate()!;
      const sync = await syncMarketingSnapshots({
        supabase,
        insightDateYmd: date,
        snapshotDateYmd: date,
      });
      return jsonResponse({ ok: true, sync });
    }

    if (action === "send") {
      const parsed = sendSchema.safeParse(json);
      if (!parsed.success) return jsonResponse({ error: "invalid_body", detail: parsed.error.flatten() }, 400);
      const range = rangeFor(parsed.data.kind, { date: parsed.data.date });
      const report = await loadAdsMarketingReport({
        supabase,
        kind: parsed.data.kind,
        startYmd: range.startYmd,
        endYmd: range.endYmd,
      });
      const pushed = await sendAdsMarketingReport(supabase, report);
      return jsonResponse({
        ok: pushed.ok,
        sent: pushed.sent,
        skipped: pushed.skipped,
        error: pushed.error,
        preview: formatAdsMarketingReport(report, { allStores: true }),
      }, pushed.ok ? 200 : 502);
    }

    return jsonResponse({ error: "unknown_action" }, 400);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return jsonResponse({ error: "unexpected_error", detail: message }, 500);
  }
}
