import type { SupabaseClient } from "@supabase/supabase-js";
import {
  NOVEMBER_LOW_USAGE_LEDGER_NOTE,
  NOVEMBER_LOW_USAGE_LEDGER_REASON,
  NOVEMBER_TICKET_KOMA,
  OCTOBER_USAGE_END_ISO,
  OCTOBER_USAGE_START_ISO,
  NOVEMBER_USAGE_CREATED_BEFORE_ISO,
  selectNovemberLowUsageMembers,
  type NovemberLowUsageCandidate,
  type NovemberLowUsageMember,
} from "@/lib/booking/novemberEarlyAccess";

const PAGE = 1000;

async function fetchAll<T>(supabase: SupabaseClient, table: string, select: string, apply?: (q: any) => any): Promise<T[]> {
  const out: T[] = [];
  let from = 0;
  for (;;) {
    let q = (supabase as any).from(table).select(select).range(from, from + PAGE - 1);
    if (apply) q = apply(q);
    const { data, error } = await q;
    if (error) throw error;
    out.push(...((data ?? []) as T[]));
    if (!data || data.length < PAGE) break;
    from += PAGE;
  }
  return out;
}

export async function listNovemberLowUsageMembers(supabase: SupabaseClient): Promise<NovemberLowUsageMember[]> {
  const memberSelect =
    "id, member_code, name, display_name, is_active, membership_status";
  let members: NovemberLowUsageCandidate[];
  try {
    members = await fetchAll<NovemberLowUsageCandidate>(supabase, "members", memberSelect);
  } catch (e) {
    const msg =
      e instanceof Error
        ? e.message
        : String((e as { message?: unknown } | null)?.message ?? e);
    if (!/membership_status|display_name|does not exist|schema cache/i.test(msg)) throw e;
    members = await fetchAll<NovemberLowUsageCandidate>(supabase, "members", "id, member_code, name, is_active");
  }

  const reservations = await fetchAll<{ member_id: string | null }>(
    supabase,
    "reservations",
    "member_id",
    (q) =>
      q
        .gte("start_at", OCTOBER_USAGE_START_ISO)
        .lt("start_at", OCTOBER_USAGE_END_ISO)
        .lt("created_at", NOVEMBER_USAGE_CREATED_BEFORE_ISO)
        .neq("status", "cancelled")
        .not("member_id", "is", null)
  );

  const counts = new Map<string, number>();
  for (const row of reservations) {
    if (!row.member_id) continue;
    counts.set(row.member_id, (counts.get(row.member_id) ?? 0) + 1);
  }
  return selectNovemberLowUsageMembers(members, counts);
}

async function alreadyGrantedIds(supabase: SupabaseClient, memberIds: string[]): Promise<Set<string>> {
  const granted = new Set<string>();
  for (let i = 0; i < memberIds.length; i += 100) {
    const chunk = memberIds.slice(i, i + 100);
    const { data, error } = await (supabase as any)
      .from("member_ticket_ledger")
      .select("member_id")
      .eq("reason", NOVEMBER_LOW_USAGE_LEDGER_REASON)
      .in("member_id", chunk);
    if (error) throw error;
    for (const row of data ?? []) granted.add(String(row.member_id));
  }
  return granted;
}

async function grantTwoTickets(
  supabase: SupabaseClient,
  memberId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const cur = await (supabase as any).from("members").select("bonus_ticket_koma").eq("id", memberId).maybeSingle();
  if (cur.error) return { ok: false, error: cur.error.message };
  const current = Math.max(0, Number(cur.data?.bonus_ticket_koma ?? 0) || 0);
  const next = current + NOVEMBER_TICKET_KOMA;
  const upd = await (supabase as any)
    .from("members")
    .update({ bonus_ticket_koma: next, updated_at: new Date().toISOString() })
    .eq("id", memberId);
  if (upd.error) return { ok: false, error: upd.error.message };

  const ledger = await (supabase as any).from("member_ticket_ledger").insert({
    member_id: memberId,
    delta: NOVEMBER_TICKET_KOMA,
    reason: NOVEMBER_LOW_USAGE_LEDGER_REASON,
    note: NOVEMBER_LOW_USAGE_LEDGER_NOTE,
  });
  if (ledger.error) {
    await (supabase as any)
      .from("members")
      .update({ bonus_ticket_koma: current, updated_at: new Date().toISOString() })
      .eq("id", memberId);
    return { ok: false, error: ledger.error.message };
  }
  return { ok: true };
}

export async function grantNovemberLowUsageTickets(supabase: SupabaseClient): Promise<{
  eligible: number;
  granted: number;
  skipped: number;
  failed: Array<{ memberCode: string; error: string }>;
}> {
  const members = await listNovemberLowUsageMembers(supabase);
  const grantedIds = await alreadyGrantedIds(
    supabase,
    members.map((m) => m.id)
  );
  const failed: Array<{ memberCode: string; error: string }> = [];
  let granted = 0;
  let skipped = 0;
  for (const member of members) {
    if (grantedIds.has(member.id)) {
      skipped += 1;
      continue;
    }
    const result = await grantTwoTickets(supabase, member.id);
    if (!result.ok) {
      failed.push({ memberCode: member.memberCode, error: result.error });
      continue;
    }
    granted += 1;
  }
  return { eligible: members.length, granted, skipped, failed };
}
