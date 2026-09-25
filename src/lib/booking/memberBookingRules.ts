import { DateTime } from "luxon";
import {
  limitsForMembershipPlan,
  type MembershipPlan,
  type MemberPlanLimits,
} from "@/lib/memberPlans";

export const MEMBER_BOOKING_BLOCKED_MESSAGE = "この時間は予約できません";
export const BOOKING_RULES_ZONE = "Asia/Tokyo";

export type RuleReservation = {
  id?: string;
  start_at: string;
  end_at: string;
  store_id: string;
  session_type?: string | null;
  status?: string | null;
  quota_consumed?: boolean | null;
};

export type BookingCandidate = {
  start_at: string;
  end_at: string;
  store_id: string;
  session_type?: string | null;
};

export type BookingRuleInput = {
  plan: MembershipPlan | null;
  ticketKoma: number;
  reservations: RuleReservation[];
  blockedDates: string[];
  candidate: BookingCandidate;
  nowIso: string;
  zone?: string;
  excludeReservationId?: string;
  /** 入会日 YYYY-MM-DD。未設定・不正は毎月1日始まり */
  joinedAtYmd?: string | null;
};

export type PlanConversionOffer = "monthly_10" | "monthly_20";

export type BookingRuleResult = {
  ok: boolean;
  ticketsToConsume: number;
  reason: string | null;
  offerPlanConversion: PlanConversionOffer | null;
};

export function conversionOfferFor(
  plan: MembershipPlan | null | undefined,
  reason: string | null | undefined
): PlanConversionOffer | null {
  if (reason !== "quota") return null;
  if (plan === "unlimited_30") return "monthly_10";
  if (plan === "session_60") return "monthly_20";
  return null;
}

function blocked(reason: string, plan: MembershipPlan | null): BookingRuleResult {
  return {
    ok: false,
    ticketsToConsume: 0,
    reason,
    offerPlanConversion: conversionOfferFor(plan, reason),
  };
}

function allowed(ticketsToConsume = 0): BookingRuleResult {
  return { ok: true, ticketsToConsume, reason: null, offerPlanConversion: null };
}

export type MemberBookingSnapshot = {
  plan: MembershipPlan | null;
  ticketKoma: number;
  holdKoma: number;
  maxHoldKoma: number | null;
  dailyKomaToday: number;
  maxDailyKoma: number | null;
  weekKoma: number;
  weeklyMaxKoma: number | null;
  mixThisWeek: boolean;
  monthKoma: number;
  monthlyMaxKoma: number | null;
  monthCycleStartYmd: string | null;
  monthCycleEndExclusiveYmd: string | null;
  blockedDates: string[];
};

export type MembershipCycle = {
  startYmd: string;
  endExclusiveYmd: string;
};

function toDt(iso: string, zone: string): DateTime {
  const dt = DateTime.fromISO(iso, { setZone: true }).setZone(zone);
  return dt.isValid ? dt : DateTime.fromISO(iso, { zone: "utc" }).setZone(zone);
}

export function komaForRange(startAtIso: string, endAtIso: string, zone = BOOKING_RULES_ZONE): number {
  const start = toDt(startAtIso, zone);
  const end = toDt(endAtIso, zone);
  const minutes = end.diff(start, "minutes").minutes;
  if (!Number.isFinite(minutes) || minutes <= 0) return 1;
  return Math.max(1, Math.round(minutes / 30));
}

export function isOnlineSession(sessionType: string | null | undefined): boolean {
  return String(sessionType ?? "").trim().toLowerCase() === "online";
}

export function weekStartYmd(iso: string, zone = BOOKING_RULES_ZONE): string {
  const dt = toDt(iso, zone);
  const monday = dt.minus({ days: dt.weekday - 1 }).startOf("day");
  return monday.toISODate()!;
}

function isConfirmed(row: RuleReservation): boolean {
  const status = String(row.status ?? "confirmed").trim().toLowerCase();
  return status !== "cancelled";
}

function isQuotaConsumedCancel(row: RuleReservation): boolean {
  const status = String(row.status ?? "").trim().toLowerCase();
  return status === "cancelled" && Boolean(row.quota_consumed);
}

export function visibleReservations(
  reservations: RuleReservation[],
  excludeReservationId?: string
): RuleReservation[] {
  if (!excludeReservationId) return reservations;
  return reservations.filter((r) => String(r.id ?? "") !== String(excludeReservationId));
}

export function usesCrossStoreOrOnline(rows: Array<Pick<RuleReservation, "store_id" | "session_type">>): boolean {
  const storeIds = new Set<string>();
  let hasOnline = false;
  for (const row of rows) {
    if (isOnlineSession(row.session_type)) {
      hasOnline = true;
      continue;
    }
    const storeId = String(row.store_id ?? "").trim();
    if (storeId) storeIds.add(storeId);
  }
  return storeIds.size > 1 || (hasOnline && storeIds.size >= 1);
}

function komaOnLocalDate(rows: RuleReservation[], ymd: string, zone: string): number {
  let total = 0;
  for (const row of rows) {
    if (!isConfirmed(row)) continue;
    if (toDt(row.start_at, zone).toISODate() !== ymd) continue;
    total += komaForRange(row.start_at, row.end_at, zone);
  }
  return total;
}

function komaInWeek(rows: RuleReservation[], weekStart: string, zone: string): number {
  let total = 0;
  for (const row of rows) {
    if (!isConfirmed(row)) continue;
    if (weekStartYmd(row.start_at, zone) !== weekStart) continue;
    total += komaForRange(row.start_at, row.end_at, zone);
  }
  return total;
}

export function parseJoinedAtYmd(raw: string | null | undefined): string | null {
  const ymd = String(raw ?? "").trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return null;
  const dt = DateTime.fromISO(ymd, { zone: BOOKING_RULES_ZONE });
  return dt.isValid ? ymd : null;
}

function cycleAnchorDay(joinedAtYmd: string | null | undefined): number {
  const ymd = parseJoinedAtYmd(joinedAtYmd);
  if (!ymd) return 1;
  return DateTime.fromISO(ymd, { zone: BOOKING_RULES_ZONE }).day;
}

function dateOnOrClamped(year: number, month: number, day: number, zone: string): DateTime {
  const dt = DateTime.fromObject({ year, month, day }, { zone });
  if (dt.isValid) return dt.startOf("day");
  return DateTime.fromObject({ year, month, day: 1 }, { zone }).endOf("month").startOf("day");
}

/** 入会日起点の1ヶ月周期。入会日なしは毎月1日〜翌月1日（暦月）。 */
export function membershipCycleContaining(params: {
  joinedAtYmd?: string | null;
  atIso: string;
  zone?: string;
}): MembershipCycle {
  const zone = params.zone ?? BOOKING_RULES_ZONE;
  const at = toDt(params.atIso, zone).startOf("day");
  const day = cycleAnchorDay(params.joinedAtYmd);
  let start = dateOnOrClamped(at.year, at.month, day, zone);
  if (at < start) {
    const prev = at.minus({ months: 1 });
    start = dateOnOrClamped(prev.year, prev.month, day, zone);
  }
  const next = start.plus({ months: 1 });
  const end = dateOnOrClamped(next.year, next.month, day, zone);
  return { startYmd: start.toISODate()!, endExclusiveYmd: end.toISODate()! };
}

function komaInCycle(
  rows: RuleReservation[],
  cycle: MembershipCycle,
  zone: string,
  includeConsumedCancels: boolean
): number {
  const start = DateTime.fromISO(cycle.startYmd, { zone }).startOf("day");
  const end = DateTime.fromISO(cycle.endExclusiveYmd, { zone }).startOf("day");
  let total = 0;
  for (const row of rows) {
    const counts = isConfirmed(row) || (includeConsumedCancels && isQuotaConsumedCancel(row));
    if (!counts) continue;
    const at = toDt(row.start_at, zone);
    if (at < start || at >= end) continue;
    total += komaForRange(row.start_at, row.end_at, zone);
  }
  return total;
}

function holdKoma(rows: RuleReservation[], nowIso: string, zone: string): number {
  const now = toDt(nowIso, zone);
  let total = 0;
  for (const row of rows) {
    if (!isConfirmed(row)) continue;
    if (toDt(row.start_at, zone).toMillis() <= now.toMillis()) continue;
    total += komaForRange(row.start_at, row.end_at, zone);
  }
  return total;
}

export function isLateCancelForQuota(params: {
  nowIso: string;
  startAtIso: string;
  zone?: string;
}): boolean {
  const zone = params.zone ?? BOOKING_RULES_ZONE;
  const now = toDt(params.nowIso, zone);
  const start = toDt(params.startAtIso, zone);
  if (!now.isValid || !start.isValid) return false;
  if (now.toISODate() !== start.toISODate()) return false;
  return now.toMillis() >= start.minus({ hours: 2 }).toMillis();
}

export function summarizeMemberBookingState(params: {
  plan: MembershipPlan | null;
  ticketKoma: number;
  reservations: RuleReservation[];
  blockedDates: string[];
  nowIso: string;
  zone?: string;
  joinedAtYmd?: string | null;
}): MemberBookingSnapshot {
  const zone = params.zone ?? BOOKING_RULES_ZONE;
  const limits = params.plan ? limitsForMembershipPlan(params.plan) : null;
  const rows = params.reservations;
  const cycle =
    limits?.monthlyMaxKoma != null
      ? membershipCycleContaining({ joinedAtYmd: params.joinedAtYmd, atIso: params.nowIso, zone })
      : null;
  return {
    plan: params.plan,
    ticketKoma: Math.max(0, params.ticketKoma),
    holdKoma: holdKoma(rows, params.nowIso, zone),
    maxHoldKoma: limits?.maxHoldKoma ?? null,
    dailyKomaToday: komaOnLocalDate(rows, toDt(params.nowIso, zone).toISODate()!, zone),
    maxDailyKoma: limits?.maxDailyKoma ?? null,
    weekKoma: komaInWeek(rows, weekStartYmd(params.nowIso, zone), zone),
    weeklyMaxKoma: limits?.weeklyMaxKoma ?? null,
    mixThisWeek: usesCrossStoreOrOnline(
      rows.filter((r) => isConfirmed(r) && weekStartYmd(r.start_at, zone) === weekStartYmd(params.nowIso, zone))
    ),
    monthKoma: cycle ? komaInCycle(rows, cycle, zone, true) : 0,
    monthlyMaxKoma: limits?.monthlyMaxKoma ?? null,
    monthCycleStartYmd: cycle?.startYmd ?? null,
    monthCycleEndExclusiveYmd: cycle?.endExclusiveYmd ?? null,
    blockedDates: [...params.blockedDates].sort(),
  };
}

/** いま追加で取れるコマ数。月10/20はチケットでも上限を超えない。未設定は制限なし。 */
export function remainingBookableKoma(snap: MemberBookingSnapshot): number | null {
  if (!snap.plan || snap.maxHoldKoma == null) return null;
  const holdLeft = Math.max(0, snap.maxHoldKoma - snap.holdKoma);
  const tickets = Math.max(0, snap.ticketKoma);
  const hardMonth =
    snap.plan === "monthly_10" || snap.plan === "monthly_20" || snap.plan === "this_month_10";
  if (hardMonth) {
    const monthLeft =
      snap.monthlyMaxKoma == null ? holdLeft : Math.max(0, snap.monthlyMaxKoma - snap.monthKoma);
    return Math.min(holdLeft, monthLeft);
  }
  if (snap.plan === "ticket") return Math.min(holdLeft, tickets);
  return holdLeft + tickets;
}

export function evaluateMemberBooking(input: BookingRuleInput): BookingRuleResult {
  const zone = input.zone ?? BOOKING_RULES_ZONE;
  const candidateYmd = toDt(input.candidate.start_at, zone).toISODate();
  if (candidateYmd && input.blockedDates.includes(candidateYmd)) {
    return blocked("staff_date_block", input.plan);
  }

  const plan = input.plan;
  if (!plan) return allowed();

  const rows = visibleReservations(input.reservations, input.excludeReservationId);

  const limits: MemberPlanLimits = limitsForMembershipPlan(plan);
  const newKoma = komaForRange(input.candidate.start_at, input.candidate.end_at, zone);
  const tickets = Math.max(0, Math.floor(input.ticketKoma));

  if (limits.maxDailyKoma != null && candidateYmd) {
    const daily = komaOnLocalDate(rows, candidateYmd, zone);
    if (daily + newKoma > limits.maxDailyKoma) {
      return blocked("daily_limit", plan);
    }
  }

  const nextRows = [...rows, { ...input.candidate, status: "confirmed" }];
  const weekStart = weekStartYmd(input.candidate.start_at, zone);
  const weekRows = nextRows.filter(
    (r) => isConfirmed(r) && weekStartYmd(r.start_at, zone) === weekStart
  );
  const mix = usesCrossStoreOrOnline(weekRows);

  let ticketsNeeded = 0;
  if (limits.requiresTickets) {
    ticketsNeeded = newKoma;
  }

  const currentHold = holdKoma(rows, input.nowIso, zone);
  const holdOverflow = currentHold + newKoma > limits.maxHoldKoma;
  const cycle =
    limits.monthlyMaxKoma != null
      ? membershipCycleContaining({
          joinedAtYmd: input.joinedAtYmd,
          atIso: input.candidate.start_at,
          zone,
        })
      : null;
  const monthly = cycle ? komaInCycle(rows, cycle, zone, true) : 0;
  const monthlyOverflow = limits.monthlyMaxKoma != null && monthly + newKoma > limits.monthlyMaxKoma;
  const hardMonthCap = plan === "monthly_10" || plan === "monthly_20" || plan === "this_month_10";

  if (hardMonthCap && (holdOverflow || monthlyOverflow)) {
    return blocked("quota", plan);
  }

  if (holdOverflow) {
    ticketsNeeded = Math.max(ticketsNeeded, currentHold + newKoma - limits.maxHoldKoma);
  }

  if (monthlyOverflow && limits.monthlyMaxKoma != null) {
    ticketsNeeded = Math.max(ticketsNeeded, monthly + newKoma - limits.monthlyMaxKoma);
  }

  if (mix) {
    const weekly = komaInWeek(rows, weekStart, zone);
    if (weekly + newKoma > limits.weeklyMaxKoma) {
      ticketsNeeded = Math.max(ticketsNeeded, weekly + newKoma - limits.weeklyMaxKoma);
    }
  }

  if (ticketsNeeded > tickets) {
    return blocked(limits.requiresTickets ? "tickets" : "quota", plan);
  }

  return allowed(ticketsNeeded);
}

/** カレンダーの×はスタッフ指定日だけ。保持上限は空きを出したまま、予約確定時に案内する。 */
export function isDateUnavailableForMember(params: {
  plan: MembershipPlan | null;
  ticketKoma: number;
  reservations: RuleReservation[];
  blockedDates: string[];
  ymd: string;
  storeId: string;
  sessionType?: string | null;
  nowIso: string;
  zone?: string;
  excludeReservationId?: string;
  joinedAtYmd?: string | null;
}): boolean {
  return params.blockedDates.includes(params.ymd);
}
