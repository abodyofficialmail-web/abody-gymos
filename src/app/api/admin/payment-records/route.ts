import { jsonResponse } from "@/app/api/booking-v2/_cors";
import { MembershipLedgerError, listMembershipPayments } from "@/lib/membershipPayments";
import { importRecentMembershipCheckouts } from "@/lib/paymentLinkSuccess";
import { createSupabaseServiceClient } from "@/lib/supabase/admin";

export async function GET() {
  try {
    const supabase = createSupabaseServiceClient();
    await importRecentMembershipCheckouts(supabase);
    const snapshot = await listMembershipPayments(supabase);
    return jsonResponse({
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
