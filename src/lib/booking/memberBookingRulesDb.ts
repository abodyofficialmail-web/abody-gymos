import { DateTime } from "luxon";
import type { SupabaseClient } from "@supabase/supabase-js";
import { pickBookableMember } from "@/lib/memberMembershipStatus";
import { parseMembershipPlan, type MembershipPlan } from "@/lib/memberPlans";
import {
  BOOKING_RULES_ZONE,
  evaluateMemberBooking,
  type BookingCandidate,
  type BookingRuleResult,
  type MemberBookingSnapshot,
  type RuleReservation,
  summarizeMemberBookingState,
} from "@/lib/booking/memberBookingRules";

export type MemberBookingRuleContext = {
  memberId: string;
  plan: MembershipPlan | null;
  ticketKoma: number;
  reservations: RuleReservation[];
  blockedDates: string[];
  schemaReady: boolean;
  joinedAtYmd: string | null;
};

function isMissingColumn(err: unknown): boolean {
  const msg = String((err as { message?: string })?.message ?? "");
  return (
    /membership_plan|bonus_ticket_koma|quota_consumed|tickets_consumed|member_booking_date_blocks|member_ticket_ledger|does not exist|schema cache/i.test(
      msg
    ) || (/PGRST/i.test(msg) && /column|relation/i.test(msg))
  );
}

export async function lookupBookableMemberId(
  supabase: SupabaseClient,
  params: { email?: string | null; memberId?: string | null; storeId?: string | null }
): Promise<string | null> {
  if (params.memberId) return params.memberId;
  const email = String(params.email ?? "").trim();
  if (!email) return null;
  const { data, error } = await supabase
    .from("members")
    .select("id, is_active, membership_status, store_id")
    .ilike("email", email)
    .limit(10);
  if (error) return null;
  const member = pickBookableMember(data ?? [], params.storeId);
  return member?.id ?? null;
}

export async function loadMemberBookingRuleContextByEmail(
  supabase: SupabaseClient,
  params: { email?: string | null; memberId?: string | null; storeId?: string | null; nowIso?: string }
): Promise<MemberBookingRuleContext | null> {
  const memberId = await lookupBookableMemberId(supabase, params);
  if (!memberId) return null;
  return loadMemberBookingRuleContext(supabase, { memberId, nowIso: params.nowIso });
}

export async function loadMemberBookingRuleContext(
  supabase: SupabaseClient,
  params: { memberId: string; nowIso?: string; zone?: string }
): Promise<MemberBookingRuleContext> {
  const zone = params.zone ?? BOOKING_RULES_ZONE;
  const now = params.nowIso ? DateTime.fromISO(params.nowIso) : DateTime.now().setZone(zone);
  const from = now.setZone(zone).minus({ months: 1 }).startOf("month").toUTC().toISO()!;

  const memberFull = await (supabase as any)
    .from("members")
    .select("id, membership_plan, bonus_ticket_koma")
    .eq("id", params.memberId)
    .maybeSingle();

  if (memberFull.error && isMissingColumn(memberFull.error)) {
    return {
      memberId: params.memberId,
      plan: null,
      ticketKoma: 0,
      reservations: [],
      blockedDates: [],
      schemaReady: false,
      joinedAtYmd: null,
    };
  }
  if (memberFull.error || !memberFull.data) {
    return {
      memberId: params.memberId,
      plan: null,
      ticketKoma: 0,
      reservations: [],
      blockedDates: [],
      schemaReady: false,
      joinedAtYmd: null,
    };
  }

  const plan = parseMembershipPlan(memberFull.data.membership_plan);
  const ticketKoma = Math.max(0, Number(memberFull.data.bonus_ticket_koma ?? 0) || 0);

  const selectFull = "id, start_at, end_at, store_id, session_type, status, quota_consumed";
  const selectLite = "id, start_at, end_at, store_id, session_type, status";
  let resQuery = await (supabase as any)
    .from("reservations")
    .select(selectFull)
    .eq("member_id", params.memberId)
    .gte("start_at", from)
    .order("start_at", { ascending: true });
  if (resQuery.error && isMissingColumn(resQuery.error)) {
    resQuery = await (supabase as any)
      .from("reservations")
      .select(selectLite)
      .eq("member_id", params.memberId)
      .gte("start_at", from)
      .order("start_at", { ascending: true });
  }

  const reservations: RuleReservation[] = ((resQuery.data ?? []) as any[]).map((r) => ({
    id: String(r.id),
    start_at: String(r.start_at),
    end_at: String(r.end_at),
    store_id: String(r.store_id ?? ""),
    session_type: r.session_type ?? "store",
    status: r.status ?? "confirmed",
    quota_consumed: Boolean(r.quota_consumed),
  }));

  let blockedDates: string[] = [];
  const fromYmd = now.setZone(zone).minus({ days: 1 }).toISODate()!;
  const blocks = await (supabase as any)
    .from("member_booking_date_blocks")
    .select("blocked_date")
    .eq("member_id", params.memberId)
    .gte("blocked_date", fromYmd);
  if (!blocks.error) {
    blockedDates = ((blocks.data ?? []) as any[])
      .map((b) => String(b.blocked_date ?? "").slice(0, 10))
      .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d));
  }

  return {
    memberId: params.memberId,
    plan,
    ticketKoma,
    reservations,
    blockedDates,
    schemaReady: true,
    joinedAtYmd: null,
  };
}

export async function evaluateLoadedMemberBooking(
  ctx: MemberBookingRuleContext,
  candidate: BookingCandidate,
  params?: { nowIso?: string; excludeReservationId?: string }
): Promise<BookingRuleResult> {
  if (!ctx.schemaReady) return { ok: true, ticketsToConsume: 0, reason: null, offerPlanConversion: null };
  return evaluateMemberBooking({
    plan: ctx.plan,
    ticketKoma: ctx.ticketKoma,
    reservations: ctx.reservations,
    blockedDates: ctx.blockedDates,
    candidate,
    nowIso: params?.nowIso ?? new Date().toISOString(),
    excludeReservationId: params?.excludeReservationId,
  });
}

export function snapshotFromContext(
  ctx: MemberBookingRuleContext,
  nowIso: string
): MemberBookingSnapshot {
  return summarizeMemberBookingState({
    plan: ctx.plan,
    ticketKoma: ctx.ticketKoma,
    reservations: ctx.reservations,
    blockedDates: ctx.blockedDates,
    nowIso,
  });
}

export async function applyTicketDelta(
  supabase: SupabaseClient,
  params: {
    memberId: string;
    delta: number;
    reason: string;
    note?: string | null;
    reservationId?: string | null;
  }
): Promise<{ ok: boolean; ticketKoma: number; error?: string }> {
  if (!params.delta) {
    const cur = await (supabase as any)
      .from("members")
      .select("bonus_ticket_koma")
      .eq("id", params.memberId)
      .maybeSingle();
    return { ok: true, ticketKoma: Math.max(0, Number(cur.data?.bonus_ticket_koma ?? 0) || 0) };
  }

  const cur = await (supabase as any)
    .from("members")
    .select("bonus_ticket_koma")
    .eq("id", params.memberId)
    .maybeSingle();
  if (cur.error && isMissingColumn(cur.error)) {
    return { ok: true, ticketKoma: 0 };
  }
  if (cur.error) return { ok: false, ticketKoma: 0, error: cur.error.message };

  const current = Math.max(0, Number(cur.data?.bonus_ticket_koma ?? 0) || 0);
  const next = current + params.delta;
  if (next < 0) return { ok: false, ticketKoma: current, error: "チケットが不足しています" };

  const upd = await (supabase as any)
    .from("members")
    .update({ bonus_ticket_koma: next, updated_at: new Date().toISOString() })
    .eq("id", params.memberId);
  if (upd.error) return { ok: false, ticketKoma: current, error: upd.error.message };

  const ledger = await (supabase as any).from("member_ticket_ledger").insert({
    member_id: params.memberId,
    delta: params.delta,
    reason: params.reason,
    note: params.note ?? null,
    reservation_id: params.reservationId ?? null,
  });
  if (ledger.error && !isMissingColumn(ledger.error)) {
    console.error("member_ticket_ledger insert failed", ledger.error.message);
  }

  return { ok: true, ticketKoma: next };
}
