import { jsonResponse } from "@/app/api/booking-v2/_cors";
import { MembershipLedgerError, listMembershipPayments, stopMembershipRenewal } from "@/lib/membershipPayments";
import { importRecentMembershipCheckouts } from "@/lib/paymentLinkSuccess";
import { createSupabaseServiceClient } from "@/lib/supabase/admin";

export async function GET(request: Request) {
  try {
    const supabase = createSupabaseServiceClient();
    const imported = await importRecentMembershipCheckouts(supabase);
    const snapshot = await listMembershipPayments(supabase);
    const probe = new URL(request.url).searchParams.get("probe") === "1";
    return jsonResponse({
      ...(probe
        ? {
            charge_amounts: imported.chargeAmounts,
            charge_count: imported.chargeAmounts.length,
            has_15400: imported.chargeAmounts.includes(15400),
          }
        : {}),
      month_label: snapshot.monthLabel,
      sales_yen: snapshot.salesYen,
      month_counts: snapshot.monthCounts,
      records: snapshot.records,
    });
  } catch (error) {
    if (error instanceof MembershipLedgerError && error.unavailable) {
      return jsonResponse({ error: "決済の記録をまだ保存できません。SQLの適用が必要です。" }, 503);
    }
    const message = error instanceof Error ? error.message : "";
    if (/SUPABASE_SERVICE_ROLE_KEY|NEXT_PUBLIC_SUPABASE_URL/.test(message)) {
      return jsonResponse({ error: "決済記録の取得に失敗しました" }, 500);
    }
    return jsonResponse({ error: "決済記録の取得に失敗しました" }, 500);
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as { id?: unknown };
    const supabase = createSupabaseServiceClient();
    const result = await stopMembershipRenewal(supabase, String(body.id ?? ""));
    if (!result.ok) return jsonResponse({ error: result.error }, 400);
    return jsonResponse({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (/SUPABASE_SERVICE_ROLE_KEY|NEXT_PUBLIC_SUPABASE_URL|STRIPE_SECRET_KEY/.test(message)) {
      return jsonResponse({ error: "決済を止められませんでした" }, 500);
    }
    return jsonResponse({ error: "決済を止められませんでした" }, 500);
  }
}
