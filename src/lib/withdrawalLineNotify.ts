import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { dailyReportChannelToken } from "@/lib/dailyLineRecipients";
import { formatWithdrawnAt } from "@/lib/memberMembershipStatus";
import { pushOpsTexts } from "@/lib/trainerOpsScope";

export type WithdrawalNotifyInput = {
  memberCode: string | null | undefined;
  memberName: string | null | undefined;
  storeName: string | null | undefined;
  withdrawnAt: string | null | undefined;
  trainerName: string | null | undefined;
};

export function buildWithdrawalNotifyText(input: WithdrawalNotifyInput): string {
  const code = String(input.memberCode ?? "").trim() || "—";
  const name = String(input.memberName ?? "").trim() || "—";
  const store = String(input.storeName ?? "").trim() || "—";
  const date = formatWithdrawnAt(input.withdrawnAt);
  const trainer = String(input.trainerName ?? "").trim() || "—";
  return [
    "【退会連絡】",
    `会員: ${name}（${code}）`,
    `店舗: ${store}`,
    `退会日: ${date}`,
    `担当トレーナー: ${trainer}`,
  ].join("\n");
}

export type WithdrawalNotifyResult = {
  attempted: boolean;
  ok: boolean;
  recipient_count: number;
  error?: string;
};

/** 退会手続き完了時に EBI020（日報と同じ送信先）へ LINE 通知 */
export async function notifyWithdrawalToOpsLine(
  supabase: SupabaseClient<Database>,
  input: WithdrawalNotifyInput
): Promise<WithdrawalNotifyResult> {
  try {
    const token = dailyReportChannelToken();
    if (!token) {
      return { attempted: false, ok: false, recipient_count: 0, error: "missing_line_token" };
    }

    const text = buildWithdrawalNotifyText(input);
    const pushed = await pushOpsTexts(supabase, (r) => {
      if (r.all_stores) return text;
      const store = String(input.storeName ?? "").trim();
      if (store && r.store_names.includes(store)) return text;
      return null;
    });

    return { attempted: true, ok: pushed.ok, recipient_count: pushed.sent, error: pushed.error };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("withdrawal LINE notify unexpected error", message);
    return { attempted: true, ok: false, recipient_count: 0, error: message };
  }
}
