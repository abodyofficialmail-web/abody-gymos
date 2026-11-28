import type { SupabaseClient } from "@supabase/supabase-js";
import { DateTime } from "luxon";

/** midMonthLowBooking の運営・テスト会員と同じ */
const EXCLUDE_CODES = new Set(["EBI020", "UEN055"]);

const TZ = "Asia/Tokyo";

export type StoreLowBookingMember = {
  id: string;
  memberCode: string;
  name: string;
  count: number;
  hasLine: boolean;
  lineUserId: string | null;
  lineChannelKey: string | null;
};

type MemberRow = {
  id: string;
  member_code: string | null;
  name: string | null;
  display_name: string | null;
  is_active: boolean | null;
  membership_status: string | null;
  line_user_id: string | null;
  line_channel_key: string | null;
  created_at: string;
};

export function isFinishedMonthSession(
  row: { status?: string | null; startAt: string; endAt: string },
  now: DateTime,
  monthStart: DateTime,
  monthEnd: DateTime
): boolean {
  if (String(row.status ?? "").toLowerCase() === "cancelled") return false;
  const start = DateTime.fromISO(row.startAt);
  const end = DateTime.fromISO(row.endAt);
  if (!start.isValid || !end.isValid) return false;
  if (end.toMillis() > now.toMillis()) return false;
  return start.toMillis() >= monthStart.toMillis() && start.toMillis() < monthEnd.toMillis();
}

export function isLowBookingListMember(
  member: { membership_status?: string | null; is_active?: boolean | null; member_code?: string | null; created_at?: string | null },
  monthKey: string
): boolean {
  const status = String(member.membership_status ?? "").toLowerCase();
  const active = status === "active" || (status !== "hiatus" && status !== "withdrawn" && member.is_active === true);
  if (!active) return false;
  const code = String(member.member_code ?? "").trim().toUpperCase();
  if (!code || EXCLUDE_CODES.has(code)) return false;
  const joined = DateTime.fromISO(String(member.created_at ?? "")).setZone(TZ).toFormat("yyyy-MM");
  return joined !== monthKey;
}

export async function listStoreLowBookingMembers(
  supabase: SupabaseClient,
  storeId: string,
  now = DateTime.now().setZone(TZ)
): Promise<{ monthLabel: string; members: StoreLowBookingMember[] }> {
  const monthStart = now.startOf("month");
  const nextMonth = monthStart.plus({ months: 1 });
  const monthKey = now.toFormat("yyyy-MM");
  const members = await fetchStoreMembers(supabase, storeId);
  const eligible = members.filter((member) => isLowBookingListMember(member, monthKey));
  const counts = await countFinishedSessions(
    supabase,
    eligible.map((member) => member.id),
    monthStart,
    nextMonth,
    now
  );
  const list = eligible
    .map((member) => {
      const code = String(member.member_code ?? "").trim().toUpperCase();
      return {
        id: member.id,
        memberCode: code,
        name: String(member.display_name || member.name || "").trim() || "会員",
        count: counts.get(member.id) ?? 0,
        hasLine: Boolean(member.line_user_id),
        lineUserId: member.line_user_id,
        lineChannelKey: member.line_channel_key,
      };
    })
    .sort((a, b) => a.count - b.count || a.memberCode.localeCompare(b.memberCode));
  return { monthLabel: now.setLocale("ja").toFormat("M月"), members: list };
}

async function fetchStoreMembers(supabase: SupabaseClient, storeId: string): Promise<MemberRow[]> {
  const page = 1000;
  let from = 0;
  const out: MemberRow[] = [];
  for (;;) {
    const { data, error } = await supabase
      .from("members")
      .select("id, member_code, name, display_name, is_active, membership_status, line_user_id, line_channel_key, created_at")
      .eq("store_id", storeId)
      .range(from, from + page - 1);
    if (error) throw error;
    out.push(...((data ?? []) as MemberRow[]));
    if (!data || data.length < page) break;
    from += page;
  }
  return out;
}

async function countFinishedSessions(
  supabase: SupabaseClient,
  memberIds: string[],
  monthStart: DateTime,
  monthEnd: DateTime,
  now: DateTime
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  const startIso = monthStart.toUTC().toISO() ?? "";
  const endIso = monthEnd.toUTC().toISO() ?? "";
  const nowIso = now.toUTC().toISO() ?? "";
  for (let i = 0; i < memberIds.length; i += 80) {
    const slice = memberIds.slice(i, i + 80);
    let from = 0;
    for (;;) {
      const { data, error } = await supabase
        .from("reservations")
        .select("member_id, status, start_at, end_at")
        .in("member_id", slice)
        .neq("status", "cancelled")
        .gte("start_at", startIso)
        .lt("start_at", endIso)
        .lte("end_at", nowIso)
        .range(from, from + 999);
      if (error) throw error;
      for (const row of data ?? []) {
        const item = row as { member_id?: string | null; status?: string | null; start_at?: string; end_at?: string };
        const id = String(item.member_id ?? "");
        if (!id || !item.start_at || !item.end_at) continue;
        if (!isFinishedMonthSession({ status: item.status, startAt: item.start_at, endAt: item.end_at }, now, monthStart, monthEnd)) {
          continue;
        }
        counts.set(id, (counts.get(id) ?? 0) + 1);
      }
      if (!data || data.length < 1000) break;
      from += 1000;
    }
  }
  return counts;
}
