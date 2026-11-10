import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { dailyReportChannelToken } from "@/lib/dailyLineRecipients";
import { chunkLinePushText, pushLineTextChunks } from "@/lib/lineMessagingPush";

const YUTO_NAME = "ゆうと";
/** 日報と同じ運営のテストアカウント */
const TEST_ACCOUNT_CODE = "EBI020";

export type PaymentLinkNotifyTarget = {
  label: string;
  lineUserId: string;
};

export function buildPaymentLinkNotifyText(input: {
  memberCode: string;
  memberName?: string | null;
  storeName?: string | null;
  sentText: string;
}): string {
  const name = String(input.memberName ?? "").trim() || "会員";
  const store = String(input.storeName ?? "").trim();
  const lines = ["【決済リンクを送信しました】", `会員: ${name}（${input.memberCode}）`];
  if (store) lines.push(`店舗: ${store}`);
  lines.push("", "送った文章", input.sentText.trim());
  return lines.join("\n");
}

export async function loadPaymentLinkNotifyTargets(
  supabase: SupabaseClient<Database>
): Promise<PaymentLinkNotifyTarget[]> {
  const targets: PaymentLinkNotifyTarget[] = [];

  const { data: trainers, error: trainerErr } = await supabase
    .from("trainers")
    .select("display_name, line_user_id, is_active")
    .eq("is_active", true);
  if (trainerErr) throw new Error(trainerErr.message);
  const yuto = (trainers ?? []).find((row) => {
    return String(row.display_name ?? "").trim() === YUTO_NAME && String(row.line_user_id ?? "").trim();
  });
  if (yuto?.line_user_id) {
    targets.push({ label: YUTO_NAME, lineUserId: String(yuto.line_user_id).trim() });
  }

  const { data: testAccount, error: memberErr } = await supabase
    .from("members")
    .select("member_code, line_user_id")
    .eq("member_code", TEST_ACCOUNT_CODE)
    .maybeSingle();
  if (memberErr) throw new Error(memberErr.message);
  if (testAccount?.line_user_id) {
    targets.push({ label: "テストアカウント", lineUserId: String(testAccount.line_user_id).trim() });
  }

  return targets;
}

function groupNotifyTargets(targets: PaymentLinkNotifyTarget[]): Array<{ lineUserId: string; labels: string[] }> {
  const groups = new Map<string, string[]>();
  for (const target of targets) {
    const labels = groups.get(target.lineUserId) ?? [];
    if (!labels.includes(target.label)) labels.push(target.label);
    groups.set(target.lineUserId, labels);
  }
  return Array.from(groups, ([lineUserId, labels]) => ({ lineUserId, labels }));
}

/** ゆうととテストアカウント（EBI020）へ運営LINEを送る */
export async function pushOpsLineNotice(
  supabase: SupabaseClient<Database>,
  text: string
): Promise<{ ok: boolean; sent: string[]; missed: string[] }> {
  const wanted = ["ゆうと", "テストアカウント"];
  try {
    const token = dailyReportChannelToken();
    const targets = await loadPaymentLinkNotifyTargets(supabase);
    if (!token) return { ok: false, sent: [], missed: wanted };
    const sent: string[] = [];
    const missed = wanted.filter((label) => !targets.some((target) => target.label === label));
    for (const target of groupNotifyTargets(targets)) {
      const chunks = chunkLinePushText(text);
      const results = await pushLineTextChunks({ token, toUserId: target.lineUserId, chunks });
      if (results.length > 0 && results.every((result) => result.ok)) sent.push(...target.labels);
      else missed.push(...target.labels);
    }
    return { ok: missed.length === 0 && sent.length > 0, sent, missed };
  } catch (e) {
    console.error("[opsLineNotice]", e instanceof Error ? e.message : e);
    return { ok: false, sent: [], missed: wanted };
  }
}

export async function pushPaymentLinkNotice(
  supabase: SupabaseClient<Database>,
  text: string
): Promise<{ ok: boolean; sent: string[]; missed: string[] }> {
  return pushOpsLineNotice(supabase, text);
}

export async function notifyPaymentLinkSent(
  supabase: SupabaseClient<Database>,
  input: {
    memberCode: string;
    memberName?: string | null;
    storeName?: string | null;
    sentText: string;
  }
): Promise<{ ok: boolean; sent: string[]; missed: string[] }> {
  return pushPaymentLinkNotice(supabase, buildPaymentLinkNotifyText(input));
}
