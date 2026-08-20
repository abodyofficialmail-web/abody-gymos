import { DateTime } from "luxon";
import type { SupabaseClient } from "@supabase/supabase-js";
import { GET as getAvailableDates } from "@/app/api/booking-v2/available-dates/route";
import { GET as getAvailableSlots } from "@/app/api/booking-v2/available-slots/route";
import { MONTHLY_SESSION_TARGET } from "@/lib/lowBookingMotivation";
import { isBookingClosedDate } from "@/lib/bookingClosedDates";

const TZ = "Asia/Tokyo";

/** 月平均この回数以下なら、セッション後に次回予約を案内する */
export const NEXT_BOOKING_MONTHLY_AVG_MAX = 8;

/** 平均を取るカレンダー月数（当月含む） */
const LOOKBACK_MONTHS = 3;

/** 何日先まで空きを探すか */
const LOOKAHEAD_DAYS = 14;

/** 画面に出す候補の上限 */
const MAX_SUGGESTIONS = 8;

/** 未来にこれ以上持っている人は案内しない（常に2コマ先） */
export const NEXT_BOOKING_MAX_FUTURE_HOLDS = 2;

const SLOT_FETCH_CONCURRENCY = 4;

export type PreferredTimeWindow = {
  label: string;
  days: "weekday" | "weekend" | "any";
  startHour: number;
  endHour: number;
};

export type SuggestedBookingSlot = {
  start_at: string;
  end_at: string;
  date_label: string;
  time_label: string;
  match_label: string;
};

export type NextBookingOffer = {
  eligible: boolean;
  monthly_average: number;
  month_count: number;
  future_hold_count: number;
  remaining_holds: number;
  preferred_labels: string[];
  slots: SuggestedBookingSlot[];
  booking_url: string;
};

export function parsePreferredSlotLabel(label: string): PreferredTimeWindow | null {
  const t = String(label ?? "").trim();
  if (!t) return null;
  if (t === "不定") return { label: t, days: "any", startHour: 0, endHour: 24 };
  const m = t.match(/^(平日|土日)の(\d+)時〜(\d+)時$/u);
  if (!m) return null;
  const startHour = Number(m[2]);
  const endHour = Number(m[3]);
  if (!Number.isFinite(startHour) || !Number.isFinite(endHour) || endHour <= startHour) return null;
  return {
    label: t,
    days: m[1] === "平日" ? "weekday" : "weekend",
    startHour,
    endHour,
  };
}

export function slotMatchesWindow(startLocal: DateTime, window: PreferredTimeWindow): boolean {
  const weekday = startLocal.weekday;
  const isWeekend = weekday === 6 || weekday === 7;
  if (window.days === "weekday" && isWeekend) return false;
  if (window.days === "weekend" && !isWeekend) return false;
  const hour = startLocal.hour + startLocal.minute / 60;
  return hour >= window.startHour && hour < window.endHour;
}

export function computeMonthlyAverage(params: {
  startAts: string[];
  memberCreatedAt?: string | null;
  now?: DateTime;
  lookbackMonths?: number;
}): { average: number; monthCount: number } {
  const now = params.now ?? DateTime.now().setZone(TZ);
  const lookback = params.lookbackMonths ?? LOOKBACK_MONTHS;
  const created = params.memberCreatedAt
    ? DateTime.fromISO(params.memberCreatedAt, { zone: TZ })
    : null;
  const firstMonth = now.startOf("month").minus({ months: lookback - 1 });
  const joinMonth = created?.isValid ? created.startOf("month") : firstMonth;
  const windowStart = joinMonth > firstMonth ? joinMonth : firstMonth;

  const counts = new Map<string, number>();
  for (let dt = windowStart; dt <= now.startOf("month"); dt = dt.plus({ months: 1 })) {
    counts.set(dt.toFormat("yyyy-MM"), 0);
  }
  for (const iso of params.startAts) {
    const d = DateTime.fromISO(iso).setZone(TZ);
    if (!d.isValid) continue;
    const key = d.toFormat("yyyy-MM");
    if (!counts.has(key)) continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const monthCount = counts.size || 1;
  const total = Array.from(counts.values()).reduce((a, b) => a + b, 0);
  const average = Math.round((total / monthCount) * 10) / 10;
  return { average, monthCount };
}

type HabitKey = { weekday: number; hour: number };

function habitKeyOf(dt: DateTime): string {
  return `${dt.weekday}|${dt.hour}`;
}

function topHabits(startAts: string[], limit = 2): HabitKey[] {
  const counts = new Map<string, number>();
  for (const iso of startAts) {
    const d = DateTime.fromISO(iso).setZone(TZ);
    if (!d.isValid) continue;
    const key = habitKeyOf(d);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .filter(([, n]) => n >= 2)
    .slice(0, limit)
    .map(([key]) => {
      const [weekday, hour] = key.split("|").map(Number);
      return { weekday, hour };
    });
}

async function jsonFromHandler(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

async function fetchAvailableDateCounts(storeId: string, month: string): Promise<Map<string, number>> {
  const req = new Request(
    `http://session-survey.internal/api/booking-v2/available-dates?store_id=${encodeURIComponent(storeId)}&month=${encodeURIComponent(month)}`
  );
  const res = await getAvailableDates(req);
  const json = await jsonFromHandler(res);
  const dates = (json as { dates?: Array<{ date: string; count: number }> } | null)?.dates;
  const map = new Map<string, number>();
  if (!res.ok || !Array.isArray(dates)) return map;
  for (const d of dates) {
    if (d?.date) map.set(d.date, Number(d.count) || 0);
  }
  return map;
}

async function fetchAvailableSlotsForDate(
  storeId: string,
  date: string
): Promise<Array<{ start_at: string; end_at: string }>> {
  const req = new Request(
    `http://session-survey.internal/api/booking-v2/available-slots?store_id=${encodeURIComponent(storeId)}&date=${encodeURIComponent(date)}`
  );
  const res = await getAvailableSlots(req);
  const json = await jsonFromHandler(res);
  if (!res.ok || !Array.isArray(json)) return [];
  return (json as Array<{ start_at?: string; end_at?: string }>)
    .filter((s) => s.start_at && s.end_at)
    .map((s) => ({ start_at: String(s.start_at), end_at: String(s.end_at) }));
}

async function mapPool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx]!);
    }
  });
  await Promise.all(workers);
  return out;
}

function formatSlot(startAt: string, endAt: string): Pick<SuggestedBookingSlot, "date_label" | "time_label"> {
  const start = DateTime.fromISO(startAt).setZone(TZ);
  const end = DateTime.fromISO(endAt).setZone(TZ);
  return {
    date_label: start.setLocale("ja").toFormat("M月d日（ccc）"),
    time_label: `${start.toFormat("HH:mm")}〜${end.toFormat("HH:mm")}`,
  };
}

function scoreSlot(params: {
  startLocal: DateTime;
  windows: PreferredTimeWindow[];
  habits: HabitKey[];
  sessionWeekday: number | null;
  sessionHour: number | null;
  now: DateTime;
}): { score: number; match_label: string } {
  const { startLocal, windows, habits, sessionWeekday, sessionHour, now } = params;
  let score = 0;
  const labels: string[] = [];
  const matchingWindow = windows.find((w) => w.days !== "any" && slotMatchesWindow(startLocal, w));
  if (matchingWindow) {
    score += 20;
    labels.push(matchingWindow.label);
  }
  const habitHit = habits.find((h) => h.weekday === startLocal.weekday && h.hour === startLocal.hour);
  if (habitHit) {
    score += 24;
    labels.push("いつもの時間");
  } else if (habits.some((h) => h.hour === startLocal.hour)) {
    score += 8;
  }
  if (sessionWeekday != null && startLocal.weekday === sessionWeekday && sessionHour != null && startLocal.hour === sessionHour) {
    score += 16;
    if (!labels.includes("いつもの時間")) labels.push("今回と同じ時間帯");
  }
  const daysAhead = Math.floor(startLocal.startOf("day").diff(now.startOf("day"), "days").days);
  score += Math.max(0, LOOKAHEAD_DAYS - daysAhead);
  return {
    score,
    match_label: labels[0] ?? "空き枠",
  };
}

export async function loadNextBookingEligibility(
  supabase: SupabaseClient,
  memberId: string,
  now = DateTime.now().setZone(TZ)
): Promise<{
  eligible: boolean;
  monthly_average: number;
  month_count: number;
  future_hold_count: number;
  remaining_holds: number;
}> {
  const lookbackStart = now.startOf("month").minus({ months: LOOKBACK_MONTHS - 1 });
  const [{ data: member }, { data: reservations }] = await Promise.all([
    supabase.from("members").select("id, created_at, member_code").eq("id", memberId).maybeSingle(),
    supabase
      .from("reservations")
      .select("start_at, status")
      .eq("member_id", memberId)
      .neq("status", "cancelled")
      .gte("start_at", lookbackStart.toUTC().toISO()!),
  ]);

  const rows = (reservations ?? []) as Array<{ start_at: string; status: string }>;
  const { average, monthCount } = computeMonthlyAverage({
    startAts: rows.map((r) => r.start_at),
    memberCreatedAt: member?.created_at ?? null,
    now,
  });
  const nowMs = now.toUTC().toMillis();
  const futureHoldCount = rows.filter((r) => DateTime.fromISO(r.start_at).toMillis() > nowMs).length;
  const remaining = Math.max(0, NEXT_BOOKING_MAX_FUTURE_HOLDS - futureHoldCount);
  const previewMember = String(member?.member_code ?? "").toUpperCase() === "EBI020";
  const eligible = previewMember || (average <= NEXT_BOOKING_MONTHLY_AVG_MAX && remaining > 0);
  return {
    eligible,
    monthly_average: average,
    month_count: monthCount,
    future_hold_count: futureHoldCount,
    remaining_holds: previewMember ? Math.max(1, remaining) : remaining,
  };
}

export async function loadNextBookingOffer(
  supabase: SupabaseClient,
  params: {
    memberId: string;
    storeId: string;
    sessionDate: string;
    now?: DateTime;
  }
): Promise<NextBookingOffer> {
  const now = params.now ?? DateTime.now().setZone(TZ);
  const eligibility = await loadNextBookingEligibility(supabase, params.memberId, now);
  const bookingUrl = "/booking";
  const empty: NextBookingOffer = {
    ...eligibility,
    preferred_labels: [],
    slots: [],
    booking_url: bookingUrl,
  };
  if (!eligibility.eligible) return empty;

  const lookbackStart = now.startOf("month").minus({ months: LOOKBACK_MONTHS - 1 });
  const [{ data: hearing }, { data: history }, { data: todayRes }] = await Promise.all([
    supabase
      .from("goal_hearing_responses")
      .select("preferred_slots, created_at")
      .eq("member_id", params.memberId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("reservations")
      .select("start_at")
      .eq("member_id", params.memberId)
      .neq("status", "cancelled")
      .gte("start_at", lookbackStart.toUTC().toISO()!),
    supabase
      .from("reservations")
      .select("start_at, end_at, session_type")
      .eq("member_id", params.memberId)
      .neq("status", "cancelled")
      .gte("start_at", DateTime.fromISO(params.sessionDate, { zone: TZ }).startOf("day").toUTC().toISO()!)
      .lt(
        "start_at",
        DateTime.fromISO(params.sessionDate, { zone: TZ }).plus({ days: 1 }).startOf("day").toUTC().toISO()!
      )
      .order("start_at", { ascending: true })
      .limit(1),
  ]);

  const preferredRaw = Array.isArray((hearing as { preferred_slots?: string[] } | null)?.preferred_slots)
    ? ((hearing as { preferred_slots: string[] }).preferred_slots as string[])
    : [];
  const windows = preferredRaw
    .map(parsePreferredSlotLabel)
    .filter((w): w is PreferredTimeWindow => Boolean(w));
  const preferredLabels = windows.filter((w) => w.days !== "any").map((w) => w.label);
  const anyPreferred = windows.some((w) => w.days === "any") || windows.length === 0;

  const historyStarts = ((history ?? []) as Array<{ start_at: string }>).map((r) => r.start_at);
  const habits = topHabits(historyStarts);
  const todayRow = Array.isArray(todayRes) ? todayRes[0] : todayRes;
  const sessionStart = todayRow?.start_at ? DateTime.fromISO(todayRow.start_at).setZone(TZ) : null;
  const sessionWeekday = sessionStart?.isValid ? sessionStart.weekday : null;
  const sessionHour = sessionStart?.isValid ? sessionStart.hour : null;

  const months = new Set<string>();
  const candidateDates: string[] = [];
  for (let i = 1; i <= LOOKAHEAD_DAYS; i++) {
    const d = now.plus({ days: i }).toISODate();
    if (!d || isBookingClosedDate(d)) continue;
    const local = DateTime.fromISO(d, { zone: TZ });
    const isWeekend = local.weekday === 6 || local.weekday === 7;
    const dayOk =
      anyPreferred ||
      windows.some((w) => (w.days === "weekday" ? !isWeekend : w.days === "weekend" ? isWeekend : true));
    if (!dayOk && sessionWeekday !== local.weekday) continue;
    candidateDates.push(d);
    months.add(local.toFormat("yyyy-MM"));
  }

  const dateCounts = new Map<string, number>();
  for (const month of months) {
    const part = await fetchAvailableDateCounts(params.storeId, month);
    for (const [date, count] of part) dateCounts.set(date, count);
  }

  const datesWithSlots = candidateDates.filter((d) => (dateCounts.get(d) ?? 0) > 0).slice(0, 10);
  const slotLists = await mapPool(datesWithSlots, SLOT_FETCH_CONCURRENCY, (date) =>
    fetchAvailableSlotsForDate(params.storeId, date)
  );

  const existingFuture = new Set(
    historyStarts.filter((iso) => DateTime.fromISO(iso).toMillis() > now.toUTC().toMillis())
  );

  const scored: Array<SuggestedBookingSlot & { score: number }> = [];
  for (const list of slotLists) {
    for (const slot of list) {
      if (existingFuture.has(slot.start_at)) continue;
      const startLocal = DateTime.fromISO(slot.start_at).setZone(TZ);
      if (!startLocal.isValid || startLocal <= now) continue;
      const inWindow = windows.length === 0 || anyPreferred || windows.some((w) => slotMatchesWindow(startLocal, w));
      const inHabit =
        habits.some((h) => h.weekday === startLocal.weekday && h.hour === startLocal.hour) ||
        (sessionWeekday != null &&
          sessionHour != null &&
          startLocal.weekday === sessionWeekday &&
          startLocal.hour === sessionHour);
      if (!inWindow && !inHabit) continue;
      const { score, match_label } = scoreSlot({
        startLocal,
        windows,
        habits,
        sessionWeekday,
        sessionHour,
        now,
      });
      scored.push({
        ...slot,
        ...formatSlot(slot.start_at, slot.end_at),
        match_label,
        score,
      });
    }
  }

  scored.sort((a, b) => b.score - a.score || a.start_at.localeCompare(b.start_at));
  let picked = scored.slice(0, MAX_SUGGESTIONS);

  if (picked.length < 3) {
    const fill: Array<SuggestedBookingSlot & { score: number }> = [];
    for (const list of slotLists) {
      for (const slot of list) {
        if (picked.some((p) => p.start_at === slot.start_at) || existingFuture.has(slot.start_at)) continue;
        const startLocal = DateTime.fromISO(slot.start_at).setZone(TZ);
        if (!startLocal.isValid || startLocal <= now) continue;
        const { score } = scoreSlot({
          startLocal,
          windows,
          habits,
          sessionWeekday,
          sessionHour,
          now,
        });
        fill.push({
          ...slot,
          ...formatSlot(slot.start_at, slot.end_at),
          match_label: "空き枠",
          score,
        });
      }
    }
    fill.sort((a, b) => a.start_at.localeCompare(b.start_at));
    picked = [...picked, ...fill.slice(0, MAX_SUGGESTIONS - picked.length)];
  }

  return {
    ...eligibility,
    preferred_labels: preferredLabels.length
      ? preferredLabels
      : windows.length
        ? windows.map((w) => w.label)
        : [],
    slots: picked.map(({ score: _score, ...slot }) => slot),
    booking_url: bookingUrl,
  };
}

export function nextBookingTargetCopy(average: number): string {
  const avgText = Number.isInteger(average) ? String(average) : average.toFixed(1);
  return `直近の平均は月${avgText}回です。月${MONTHLY_SESSION_TARGET}回を目標に、通いやすい時間の空きから次回を確保できます。`;
}

