import type { SupabaseClient } from "@supabase/supabase-js";
import {
  NOVEMBER_LOW_USAGE_LEDGER_REASON,
  NOVEMBER_PUBLIC_LINE_REASON,
  selectNovemberPublicLineMembers,
  type NovemberPublicLineCandidate,
} from "@/lib/booking/novemberEarlyAccess";
import { NOVEMBER_LOW_USAGE_LINE_REASON } from "@/lib/booking/novemberLowUsageLine";
import { linePushTokenForMemberRow } from "@/lib/lineChannel";
import { pushLineTextAsChunks } from "@/lib/lineMessagingPush";

export const NOVEMBER_PUBLIC_LINE_MESSAGE = `こんにちは！

本日18時より、11月分の予約受付がスタートしました！✨

スポーツの秋！🍁
身体を動かすのにぴったりな季節ですね！
11月もそれぞれの目標に向けて、トレーニングを楽しみながら頑張っていきましょう💪

お仕事やプライベートで忙しい時期かと思いますが、是非お早めにご予定を確認して、ご予約いただけると嬉しいです！

11月もトレーナー一同、全力でサポートさせていただきます😊

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

type MemberRow = NovemberPublicLineCandidate & {
  line_user_id: string | null;
  line_channel_key: string | null;
};

async function loadMembers(supabase: SupabaseClient): Promise<MemberRow[]> {
  const out: MemberRow[] = [];
  let from = 0;
  const select = "id, member_code, name, display_name, membership_status, is_active, line_user_id, line_channel_key";
  for (;;) {
    const { data, error } = await (supabase as any).from("members").select(select).range(from, from + PAGE - 1);
    if (error) throw error;
    out.push(...((data ?? []) as MemberRow[]));
    if (!data || data.length < PAGE) break;
    from += PAGE;
  }
  return out;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function sendNovemberPublicReleaseLine(supabase: SupabaseClient): Promise<{
  targets: number;
  sent: number;
  skipped: number;
  skippedNoLine: number;
  excludedPrior: number;
  failed: Array<{ memberCode: string; error: string }>;
}> {
  const [ticketIds, priorLineIds, alreadyIds] = await Promise.all([
    memberIdsForReason(supabase, NOVEMBER_LOW_USAGE_LEDGER_REASON),
    memberIdsForReason(supabase, NOVEMBER_LOW_USAGE_LINE_REASON),
    memberIdsForReason(supabase, NOVEMBER_PUBLIC_LINE_REASON),
  ]);
  const exclude = new Set<string>([...ticketIds, ...priorLineIds, ...alreadyIds]);
  const members = await loadMembers(supabase);
  const pending = selectNovemberPublicLineMembers(members, exclude);

  let sent = 0;
  const skipped = alreadyIds.size;
  let skippedNoLine = 0;
  const failed: Array<{ memberCode: string; error: string }> = [];

  for (let i = 0; i < pending.length; i += 1) {
    if (i % 25 === 0) {
      const [freshTickets, freshPrior] = await Promise.all([
        memberIdsForReason(supabase, NOVEMBER_LOW_USAGE_LEDGER_REASON),
        memberIdsForReason(supabase, NOVEMBER_LOW_USAGE_LINE_REASON),
      ]);
      for (const id of freshTickets) exclude.add(id);
      for (const id of freshPrior) exclude.add(id);
    }
    const member = pending[i];
    if (exclude.has(member.id)) continue;
    const memberCode = String(member.member_code ?? "").trim().toUpperCase();
    if (!member.line_user_id) {
      skippedNoLine += 1;
      continue;
    }
    const line = linePushTokenForMemberRow(member);
    if (!line.token) {
      failed.push({ memberCode, error: "no_token" });
      continue;
    }
    const pushed = await pushLineTextAsChunks(line.token, member.line_user_id, NOVEMBER_PUBLIC_LINE_MESSAGE);
    if (!pushed.ok) {
      failed.push({ memberCode, error: pushed.body || "line_push_failed" });
      continue;
    }
    const ledger = await (supabase as any).from("member_ticket_ledger").insert({
      member_id: member.id,
      delta: 0,
      reason: NOVEMBER_PUBLIC_LINE_REASON,
      note: "2026-10-27",
    });
    if (ledger.error) {
      failed.push({ memberCode, error: `sent_but_log_failed:${ledger.error.message}` });
      continue;
    }
    sent += 1;
    await sleep(120);
  }

  return {
    targets: pending.length,
    sent,
    skipped,
    skippedNoLine,
    excludedPrior: exclude.size,
    failed,
  };
}
