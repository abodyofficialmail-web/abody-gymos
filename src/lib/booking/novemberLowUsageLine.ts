import type { SupabaseClient } from "@supabase/supabase-js";
import { NOVEMBER_LOW_USAGE_LEDGER_REASON, isExcludedNovemberGrantName } from "@/lib/booking/novemberEarlyAccess";
import { linePushTokenForMemberRow } from "@/lib/lineChannel";
import { pushLineTextAsChunks } from "@/lib/lineMessagingPush";

export const NOVEMBER_LOW_USAGE_LINE_REASON = "november_2026_low_usage_line";

export const NOVEMBER_LOW_USAGE_LINE_MESSAGE = `こんにちは！

11月分の先行予約受付がスタートしました！✨

今回は、最近ご利用回数が少なめの会員様限定で
30分の追加チケットを2枚プレゼントしています🎁
追加チケットを活用して、60分セッションのご予約も可能です！

11月はぜひこの特典を活用して、定期的にトレーニングに取り組み、運動習慣を一緒につくっていきましょう！💪

トレーナー一同全力でサポートさせていただきます😊
ご予約お待ちしております！`;

const PAGE = 1000;

async function memberIdsForReason(supabase: SupabaseClient, reason: string): Promise<Set<string>> {
  const ids = new Set<string>();
  let from = 0;
  for (;;) {
    const { data, error } = await (supabase as any)
      .from("member_ticket_ledger")
      .select("member_id")
      .eq("reason", reason)
      .range(from, from + PAGE - 1);
    if (error) throw error;
    for (const row of data ?? []) {
      if (row.member_id) ids.add(String(row.member_id));
    }
    if (!data || data.length < PAGE) break;
    from += PAGE;
  }
  return ids;
}

type MemberRow = {
  id: string;
  member_code: string | null;
  name: string | null;
  display_name: string | null;
  line_user_id: string | null;
  line_channel_key: string | null;
};

async function loadMembers(supabase: SupabaseClient, ids: string[]): Promise<MemberRow[]> {
  const out: MemberRow[] = [];
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100);
    const { data, error } = await (supabase as any)
      .from("members")
      .select("id, member_code, name, display_name, line_user_id, line_channel_key")
      .in("id", chunk);
    if (error) throw error;
    out.push(...((data ?? []) as MemberRow[]));
  }
  return out;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function sendNovemberLowUsageTicketLine(supabase: SupabaseClient): Promise<{
  targets: number;
  sent: number;
  skipped: number;
  skippedNoLine: number;
  failed: Array<{ memberCode: string; error: string }>;
}> {
  const targets = await memberIdsForReason(supabase, NOVEMBER_LOW_USAGE_LEDGER_REASON);
  const already = await memberIdsForReason(supabase, NOVEMBER_LOW_USAGE_LINE_REASON);
  const pendingIds = [...targets].filter((id) => !already.has(id));
  const members = await loadMembers(supabase, pendingIds);

  let sent = 0;
  let skipped = already.size;
  let skippedNoLine = 0;
  const failed: Array<{ memberCode: string; error: string }> = [];

  for (const member of members) {
    const memberCode = String(member.member_code ?? "").trim().toUpperCase();
    if (isExcludedNovemberGrantName(member.name) || isExcludedNovemberGrantName(member.display_name)) {
      const skipLog = await (supabase as any).from("member_ticket_ledger").insert({
        member_id: member.id,
        delta: 0,
        reason: NOVEMBER_LOW_USAGE_LINE_REASON,
        note: "skipped_test_name",
      });
      if (skipLog.error) {
        failed.push({ memberCode, error: `skip_log_failed:${skipLog.error.message}` });
      } else {
        skipped += 1;
      }
      continue;
    }
    if (!member.line_user_id) {
      skippedNoLine += 1;
      continue;
    }
    const line = linePushTokenForMemberRow(member);
    if (!line.token) {
      failed.push({ memberCode, error: "no_token" });
      continue;
    }
    const pushed = await pushLineTextAsChunks(line.token, member.line_user_id, NOVEMBER_LOW_USAGE_LINE_MESSAGE);
    if (!pushed.ok) {
      failed.push({ memberCode, error: pushed.body || "line_push_failed" });
      continue;
    }
    const ledger = await (supabase as any).from("member_ticket_ledger").insert({
      member_id: member.id,
      delta: 0,
      reason: NOVEMBER_LOW_USAGE_LINE_REASON,
      note: "2026-10-27",
    });
    if (ledger.error) {
      failed.push({ memberCode, error: `sent_but_log_failed:${ledger.error.message}` });
      continue;
    }
    sent += 1;
    await sleep(200);
  }

  return { targets: targets.size, sent, skipped, skippedNoLine, failed };
}
