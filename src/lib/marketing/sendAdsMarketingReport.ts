import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import type { OpsRecipient } from "@/lib/trainerOpsScope";
import { pushOpsTexts } from "@/lib/trainerOpsScope";
import { formatAdsMarketingReport } from "@/lib/marketing/formatAdsMarketingReport";
import type { AdsMarketingReport } from "@/lib/marketing/types";

type ServiceClient = SupabaseClient<Database>;

export function adsReportTextForRecipient(report: AdsMarketingReport, recipient: OpsRecipient): string | null {
  const text = formatAdsMarketingReport(report, {
    allStores: recipient.all_stores,
    storeNames: recipient.store_names,
  });
  return text.trim() ? text : null;
}

export async function sendAdsMarketingReport(
  supabase: ServiceClient,
  report: AdsMarketingReport
): Promise<{ ok: boolean; sent: number; skipped: number; error?: string }> {
  return pushOpsTexts(supabase, (r) => adsReportTextForRecipient(report, r));
}

export async function alreadySentMarketingReport(
  supabase: ServiceClient,
  kind: AdsMarketingReport["kind"],
  periodKey: string
): Promise<boolean> {
  const { data, error } = await supabase
    .from("marketing_report_dispatches" as any)
    .select("id")
    .eq("report_kind", kind)
    .eq("period_key", periodKey)
    .maybeSingle();
  if (error) {
    if (/does not exist|schema cache/i.test(error.message ?? "")) return false;
    throw new Error(error.message);
  }
  return Boolean(data);
}

export async function markMarketingReportSent(
  supabase: ServiceClient,
  kind: AdsMarketingReport["kind"],
  periodKey: string
): Promise<void> {
  const { error } = await supabase.from("marketing_report_dispatches" as any).upsert(
    {
      report_kind: kind,
      period_key: periodKey,
      sent_at: new Date().toISOString(),
    },
    { onConflict: "report_kind,period_key" }
  );
  if (error && !/does not exist|schema cache/i.test(error.message ?? "")) {
    throw new Error(error.message);
  }
}
