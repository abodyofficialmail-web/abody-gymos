import { DateTime } from "luxon";
import type { SupabaseClient } from "@supabase/supabase-js";
import { effectiveBookingCapacity } from "@/lib/bookingStoreCapacity";

const TZ = "Asia/Tokyo";
const YUTO_NAME = "ゆうと";
const DISPATCH_TABLE = "daily_karte_report_dispatches";
const STORE_ORDER = ["恵比寿", "上野", "新宿", "桜木町", "福岡"];

export type DailyKarteStore = { id: string; name: string };

export type DailyKarteSession = {
  storeId: string;
  trainerId: string | null;
  trainerName: string;
  memberId: string;
  memberCode: string;
  memberName: string;
  startAt: string;
  sent: boolean;
};

export type KarteNote = { memberId: string; trainerId: string | null };

export type YutoLineRecipient = {
  trainerId: string;
  lineUserId: string;
  displayName: string;
};

export type DailyKarteReportData = {
  dateYmd: string;
  stores: DailyKarteStore[];
  sessions: DailyKarteSession[];
  factsByStoreId: Record<string, StoreDayFacts>;
  recipient: YutoLineRecipient | null;
  summary: { sessions: number; sent: number; unsent: number };
};

type Db = SupabaseClient<any>;

function storeRank(name: string): number {
  const i = STORE_ORDER.indexOf(name);
  return i === -1 ? STORE_ORDER.length : i;
}

function isCancelledStatus(status: unknown): boolean {
  const s = String(status ?? "").trim().toLowerCase();
  return s === "cancelled" || s === "canceled";
}

function isMissingTable(error: { message?: string } | null | undefined): boolean {
  return /does not exist|schema cache|Could not find/i.test(String(error?.message ?? ""));
}

export function isKarteSent(
  session: { memberId: string; trainerId: string | null },
  notes: KarteNote[]
): boolean {
  return notes.some((note) => {
    if (note.memberId !== session.memberId) return false;
    if (!session.trainerId || !note.trainerId) return true;
    return note.trainerId === session.trainerId;
  });
}

export type ShiftCover = {
  storeId: string;
  trainerId: string;
  startMin: number;
  endMin: number;
};

export function localTimeToMinutes(value: string): number {
  const match = /^(\d{1,2}):(\d{2})/.exec(String(value ?? "").trim());
  if (!match) return NaN;
  return Number(match[1]) * 60 + Number(match[2]);
}

export function tokyoMinutes(iso: string): number {
  const dt = DateTime.fromISO(iso).setZone(TZ);
  if (!dt.isValid) return NaN;
  return dt.hour * 60 + dt.minute;
}

/** 休憩ではないシフトが、セッションの開始から終了まで覆っているトレーナー */
export function coveringTrainerIds(
  shifts: ShiftCover[],
  storeId: string,
  startMin: number,
  endMin: number
): string[] {
  if (!Number.isFinite(startMin) || !Number.isFinite(endMin) || endMin <= startMin) return [];
  const ids = new Set<string>();
  for (const shift of shifts) {
    if (shift.storeId !== storeId || !shift.trainerId) continue;
    if (!Number.isFinite(shift.startMin) || !Number.isFinite(shift.endMin)) continue;
    if (shift.startMin <= startMin && shift.endMin >= endMin) ids.add(shift.trainerId);
  }
  return Array.from(ids);
}

/**
 * 予約に担当が無いときは、その時間の出勤者を使う。
 * 複数人のときはカルテを書いた人、それも無ければ出勤者全員を返す。
 */
export function resolveSessionTrainer(input: {
  reservationTrainerId: string | null;
  noteTrainerIds: string[];
  coveringTrainerIds: string[];
}): string[] {
  if (input.reservationTrainerId) return [input.reservationTrainerId];
  const cover = Array.from(new Set(input.coveringTrainerIds.filter(Boolean)));
  const noteIds = Array.from(new Set(input.noteTrainerIds.filter(Boolean)));
  if (cover.length === 1) return cover;
  if (cover.length > 1) {
    const wrote = noteIds.filter((id) => cover.includes(id));
    if (wrote.length === 1) return wrote;
    return cover.sort();
  }
  if (noteIds.length === 1) return noteIds;
  return [];
}

const SLOT_MINUTES = 30;

export type StoreDayFacts = {
  shifts: { trainerName: string; ranges: string[] }[];
  reservations: number;
  openSlots: number;
  sameDayCancels: number;
};

export type OpenSlotShift = {
  id: string;
  trainerId: string;
  startMin: number;
  endMin: number;
  inviteOnly?: boolean;
};

export type MinuteSpan = { startMin: number; endMin: number; trainerId?: string | null; shiftId?: string };

function rangesOverlap(a0: number, a1: number, b0: number, b1: number): boolean {
  return a0 < b1 && a1 > b0;
}

/** 管理画面の空き枠と同じ30分枠。招待だけのシフトは数えない。 */
export function countOpenSlots(input: {
  storeName: string;
  shifts: OpenSlotShift[];
  breaks: MinuteSpan[];
  reservations: MinuteSpan[];
  events: MinuteSpan[];
}): number {
  const breaksByShift = new Map<string, MinuteSpan[]>();
  for (const item of input.breaks) {
    const id = item.shiftId ?? "";
    if (!id) continue;
    const list = breaksByShift.get(id) ?? [];
    list.push(item);
    breaksByShift.set(id, list);
  }
  const freeByStart = new Map<number, Set<string>>();
  for (const shift of input.shifts) {
    if (shift.inviteOnly || !shift.trainerId || !(shift.endMin > shift.startMin)) continue;
    const busy = input.reservations.filter((row) => row.trainerId && row.trainerId === shift.trainerId);
    const events = input.events.filter((row) => row.trainerId === shift.trainerId);
    const breaks = breaksByShift.get(shift.id) ?? [];
    for (let start = shift.startMin; start + SLOT_MINUTES <= shift.endMin; start += SLOT_MINUTES) {
      const end = start + SLOT_MINUTES;
      if (busy.some((row) => rangesOverlap(row.startMin, row.endMin, start, end))) continue;
      if (events.some((row) => rangesOverlap(row.startMin, row.endMin, start, end))) continue;
      if (breaks.some((row) => rangesOverlap(row.startMin, row.endMin, start, end))) continue;
      const trainers = freeByStart.get(start) ?? new Set<string>();
      trainers.add(shift.trainerId);
      freeByStart.set(start, trainers);
    }
  }
  const unassigned = input.reservations.filter((row) => !row.trainerId);
  let open = 0;
  for (const [start, trainers] of freeByStart) {
    const capacity = effectiveBookingCapacity({ storeName: input.storeName, trainerCount: trainers.size });
    const used = unassigned.filter((row) => rangesOverlap(row.startMin, row.endMin, start, start + SLOT_MINUTES)).length;
    if (capacity > used) open += 1;
  }
  return open;
}

export function isSameDayCancellation(input: {
  dateYmd: string;
  startAt: string;
  updatedAt?: string | null;
  notes?: string | null;
  status: string;
}): boolean {
  if (!isCancelledStatus(input.status)) return false;
  const start = DateTime.fromISO(input.startAt).setZone(TZ);
  if (!start.isValid || start.toISODate() !== input.dateYmd) return false;
  if (/same_day_cancel=(no_show|after_visit)/.test(String(input.notes ?? ""))) return true;
  if (!input.updatedAt) return false;
  const updated = DateTime.fromISO(input.updatedAt).setZone(TZ);
  return updated.isValid && updated.toISODate() === input.dateYmd;
}

function hhmm(value: string): string {
  const match = /^(\d{1,2}):(\d{2})/.exec(String(value ?? "").trim());
  if (!match) return String(value ?? "").slice(0, 5);
  return `${match[1].padStart(2, "0")}:${match[2]}`;
}

function spanFromIso(startAt: string, endAt: string): { startMin: number; endMin: number } | null {
  const startMin = tokyoMinutes(startAt);
  let endMin = tokyoMinutes(endAt);
  if (!Number.isFinite(startMin) || !Number.isFinite(endMin)) return null;
  if (endMin <= startMin) endMin += 24 * 60;
  return { startMin, endMin };
}

export function buildStoreDayFacts(input: {
  stores: DailyKarteStore[];
  dateYmd: string;
  shiftRows: Array<{
    id?: string;
    store_id?: string;
    trainer_id?: string | null;
    start_local?: string;
    end_local?: string;
    is_break?: boolean | null;
    booking_visibility?: string | null;
  }>;
  trainerNameById: Map<string, string>;
  reservationRows: Array<{
    id?: string;
    store_id?: string;
    trainer_id?: string | null;
    start_at?: string;
    end_at?: string;
    status?: string;
    notes?: string | null;
    updated_at?: string | null;
    blocks_capacity?: boolean | null;
  }>;
  breaks: Array<{ shift_id?: string; start_time?: string; end_time?: string }>;
  events: Array<{ store_id?: string; trainer_id?: string | null; start_local?: string; end_local?: string }>;
  cancelLogs: Array<{
    reservation_id?: string;
    before_store_id?: string | null;
    before_start_at?: string | null;
    created_at?: string | null;
  }>;
}): Record<string, StoreDayFacts> {
  const workShifts = input.shiftRows.filter((row) => row.is_break !== true && row.store_id && row.trainer_id);
  const cancelIds = new Set<string>();
  const cancelsByStore = new Map<string, number>();
  const addCancel = (storeId: string, reservationId: string) => {
    if (!storeId || !reservationId || cancelIds.has(reservationId)) return;
    cancelIds.add(reservationId);
    cancelsByStore.set(storeId, (cancelsByStore.get(storeId) ?? 0) + 1);
  };
  for (const row of input.reservationRows) {
    if (
      !isSameDayCancellation({
        dateYmd: input.dateYmd,
        startAt: String(row.start_at ?? ""),
        updatedAt: row.updated_at,
        notes: row.notes,
        status: String(row.status ?? ""),
      })
    ) {
      continue;
    }
    addCancel(String(row.store_id ?? ""), String(row.id ?? ""));
  }
  for (const log of input.cancelLogs) {
    const start = DateTime.fromISO(String(log.before_start_at ?? "")).setZone(TZ);
    const created = DateTime.fromISO(String(log.created_at ?? "")).setZone(TZ);
    if (!start.isValid || !created.isValid) continue;
    if (start.toISODate() !== input.dateYmd || created.toISODate() !== input.dateYmd) continue;
    addCancel(String(log.before_store_id ?? ""), String(log.reservation_id ?? ""));
  }

  const facts: Record<string, StoreDayFacts> = {};
  for (const store of input.stores) {
    const storeShifts = workShifts
      .filter((row) => String(row.store_id) === store.id)
      .map((row) => ({
        trainerId: String(row.trainer_id),
        trainerName: input.trainerNameById.get(String(row.trainer_id))?.trim() || "担当未設定",
        start: hhmm(String(row.start_local ?? "")),
        end: hhmm(String(row.end_local ?? "")),
        id: String(row.id ?? ""),
        inviteOnly: String(row.booking_visibility ?? "") === "invite",
        startMin: localTimeToMinutes(String(row.start_local ?? "")),
        endMin: localTimeToMinutes(String(row.end_local ?? "")),
      }))
      .sort((a, b) => a.start.localeCompare(b.start) || a.trainerName.localeCompare(b.trainerName, "ja"));
    const rangesByTrainer = new Map<string, string[]>();
    for (const shift of storeShifts) {
      const list = rangesByTrainer.get(shift.trainerName) ?? [];
      list.push(`${shift.start}–${shift.end}`);
      rangesByTrainer.set(shift.trainerName, list);
    }
    const reservations = input.reservationRows.filter((row) => {
      if (String(row.store_id ?? "") !== store.id) return false;
      if (isCancelledStatus(row.status)) return false;
      if (row.blocks_capacity === false) return false;
      return true;
    });
    const openReservations: MinuteSpan[] = [];
    for (const row of reservations) {
      const span = spanFromIso(String(row.start_at ?? ""), String(row.end_at ?? ""));
      if (!span) continue;
      openReservations.push({ ...span, trainerId: row.trainer_id ? String(row.trainer_id) : null });
    }
    const shiftIds = new Set(storeShifts.map((shift) => shift.id));
    const breaks: MinuteSpan[] = input.breaks
      .filter((row) => shiftIds.has(String(row.shift_id ?? "")))
      .map((row) => ({
        shiftId: String(row.shift_id ?? ""),
        startMin: localTimeToMinutes(String(row.start_time ?? "")),
        endMin: localTimeToMinutes(String(row.end_time ?? "")),
      }))
      .filter((row) => Number.isFinite(row.startMin) && Number.isFinite(row.endMin) && row.endMin > row.startMin);
    const events: MinuteSpan[] = [];
    for (const row of input.events) {
      if (String(row.store_id ?? "") !== store.id) continue;
      const startMin = localTimeToMinutes(String(row.start_local ?? ""));
      const endMin = localTimeToMinutes(String(row.end_local ?? ""));
      if (!Number.isFinite(startMin) || !Number.isFinite(endMin) || !(endMin > startMin)) continue;
      events.push({ trainerId: row.trainer_id ? String(row.trainer_id) : null, startMin, endMin });
    }
    facts[store.id] = {
      shifts: Array.from(rangesByTrainer.entries()).map(([trainerName, ranges]) => ({ trainerName, ranges })),
      reservations: reservations.length,
      openSlots: countOpenSlots({
        storeName: store.name,
        shifts: storeShifts.map((shift) => ({
          id: shift.id,
          trainerId: shift.trainerId,
          startMin: shift.startMin,
          endMin: shift.endMin,
          inviteOnly: shift.inviteOnly,
        })),
        breaks,
        reservations: openReservations,
        events,
      }),
      sameDayCancels: cancelsByStore.get(store.id) ?? 0,
    };
  }
  return facts;
}

/** 当日は終了済みだけ。過去日はその日の予約をすべて数える。 */
export function sessionIsReportable(
  session: { startAt: string; endAt: string },
  now: DateTime,
  dateYmd: string
): boolean {
  const start = DateTime.fromISO(session.startAt).setZone(TZ);
  if (!start.isValid || start.toISODate() !== dateYmd) return false;
  const today = now.setZone(TZ).toISODate();
  if (!today || dateYmd > today) return false;
  if (dateYmd < today) return true;
  const end = DateTime.fromISO(session.endAt).setZone(TZ);
  const nowJst = now.setZone(TZ);
  if (!end.isValid) return start <= nowJst;
  return end <= nowJst;
}

function formatRate(sent: number, total: number): string {
  const pct = Math.round((sent / total) * 100);
  return `${pct}%（${sent}/${total}）`;
}

function formatTime(iso: string): string {
  const dt = DateTime.fromISO(iso).setZone(TZ);
  return dt.isValid ? dt.toFormat("HH:mm") : "--:--";
}

function memberLabel(session: DailyKarteSession): string {
  const name = session.memberName.trim() || "名前なし";
  const code = session.memberCode.trim();
  return code ? `${name}（${code}）` : name;
}

function sortStores(stores: DailyKarteStore[]): DailyKarteStore[] {
  return stores.slice().sort((a, b) => {
    const rank = storeRank(a.name) - storeRank(b.name);
    if (rank !== 0) return rank;
    return a.name.localeCompare(b.name, "ja");
  });
}

function formatStoreFacts(facts: StoreDayFacts): string[] {
  const lines: string[] = [];
  if (facts.shifts.length === 0) lines.push("シフトなし");
  else {
    lines.push("シフト");
    for (const shift of facts.shifts) lines.push(`${shift.trainerName} ${shift.ranges.join("・")}`);
  }
  lines.push(`予約 ${facts.reservations}　空き ${facts.openSlots}　当日キャンセル ${facts.sameDayCancels}`);
  return lines;
}

export function formatDailyKarteReport(input: {
  dateYmd: string;
  stores: DailyKarteStore[];
  sessions: DailyKarteSession[];
  factsByStoreId?: Record<string, StoreDayFacts>;
}): string {
  const dateLabel = DateTime.fromISO(input.dateYmd, { zone: TZ }).setLocale("ja").toFormat("yyyy年M月d日（ccc）");
  const lines: string[] = [`【日報】${dateLabel}`, ""];
  let total = 0;
  let sent = 0;
  let reservations = 0;
  let openSlots = 0;
  let sameDayCancels = 0;
  let sawFacts = false;

  for (const store of sortStores(input.stores)) {
    lines.push(`━━ ${store.name} ━━`);
    const facts = input.factsByStoreId?.[store.id];
    if (facts) {
      sawFacts = true;
      reservations += facts.reservations;
      openSlots += facts.openSlots;
      sameDayCancels += facts.sameDayCancels;
      lines.push(...formatStoreFacts(facts));
    }
    const sessions = input.sessions.filter((s) => s.storeId === store.id);
    if (sessions.length === 0) {
      lines.push("セッションなし", "");
      continue;
    }
    const byTrainer = new Map<string, DailyKarteSession[]>();
    for (const session of sessions) {
      const key = session.trainerId ?? "";
      const list = byTrainer.get(key) ?? [];
      list.push(session);
      byTrainer.set(key, list);
    }
    const groups = Array.from(byTrainer.values()).sort((a, b) => {
      const an = a[0]?.trainerName?.trim() || "担当未設定";
      const bn = b[0]?.trainerName?.trim() || "担当未設定";
      if (an === "担当未設定") return 1;
      if (bn === "担当未設定") return -1;
      return an.localeCompare(bn, "ja");
    });
    for (const group of groups) {
      const name = group[0]?.trainerName?.trim() || "担当未設定";
      const sentN = group.filter((s) => s.sent).length;
      total += group.length;
      sent += sentN;
      lines.push(`${name}　${group.length}件　送信${formatRate(sentN, group.length)}`);
      const missing = group.filter((s) => !s.sent).sort((a, b) => a.startAt.localeCompare(b.startAt));
      if (missing.length > 0) {
        lines.push(`未送信 ${missing.length}件`);
        for (const session of missing) {
          lines.push(`・${formatTime(session.startAt)} ${memberLabel(session)}`);
        }
      }
      lines.push("");
    }
  }

  if (total === 0) {
    lines.push("合計　0件");
  } else {
    lines.push(`合計　${total}件　送信${formatRate(sent, total)}`);
    const unsent = total - sent;
    if (unsent > 0) lines.push(`未送信 ${unsent}件`);
  }
  if (sawFacts) lines.push(`予約 ${reservations}　空き ${openSlots}　当日キャンセル ${sameDayCancels}`);
  return lines.join("\n").trimEnd();
}

async function fetchPages(
  run: (from: number, to: number) => PromiseLike<{ data: any[] | null; error: { message: string } | null }>
): Promise<any[]> {
  const pageSize = 1000;
  const rows: any[] = [];
  for (let from = 0; from < 10000; from += pageSize) {
    const { data, error } = await run(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    const page = data ?? [];
    rows.push(...page);
    if (page.length < pageSize) break;
  }
  return rows;
}

async function selectInChunks(ids: string[], run: (chunk: string[]) => Promise<any[]>): Promise<any[]> {
  const out: any[] = [];
  for (let i = 0; i < ids.length; i += 100) {
    out.push(...(await run(ids.slice(i, i + 100))));
  }
  return out;
}

async function loadReservationRows(supabase: Db, dayStartIso: string, dayEndIso: string): Promise<any[]> {
  const run = (columns: string) =>
    fetchPages((from, to) =>
      supabase
        .from("reservations")
        .select(columns)
        .gte("start_at", dayStartIso)
        .lt("start_at", dayEndIso)
        .order("start_at", { ascending: true })
        .order("id", { ascending: true })
        .range(from, to)
    );
  try {
    return await run("id, store_id, trainer_id, member_id, start_at, end_at, status, notes, updated_at, blocks_capacity");
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (!/column|does not exist|schema cache/i.test(message)) throw e;
    return await run("id, store_id, trainer_id, member_id, start_at, end_at, status");
  }
}

async function loadShiftRows(supabase: Db, dateYmd: string): Promise<any[]> {
  const run = (columns: string) =>
    fetchPages((from, to) =>
      supabase
        .from("trainer_shifts")
        .select(columns)
        .eq("shift_date", dateYmd)
        .neq("status", "draft")
        .order("id", { ascending: true })
        .range(from, to)
    );
  try {
    return await run("id, store_id, trainer_id, start_local, end_local, is_break, status, booking_visibility");
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (!/booking_visibility/i.test(message)) throw e;
    return await run("id, store_id, trainer_id, start_local, end_local, is_break, status");
  }
}

async function loadOptionalRows(run: () => Promise<any[]>, tableHint: RegExp): Promise<any[]> {
  try {
    return await run();
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (tableHint.test(message)) return [];
    throw e;
  }
}

export async function findYutoLineRecipient(supabase: Db): Promise<YutoLineRecipient | null> {
  const { data, error } = await supabase
    .from("trainers")
    .select("id, display_name, line_user_id, is_active")
    .eq("is_active", true);
  if (error) throw new Error(`trainers_lookup_failed:${error.message}`);
  const linked = (data ?? []).find((row: any) => {
    return String(row.display_name ?? "").trim() === YUTO_NAME && String(row.line_user_id ?? "").trim();
  });
  if (!linked) return null;
  return {
    trainerId: String(linked.id),
    lineUserId: String(linked.line_user_id).trim(),
    displayName: YUTO_NAME,
  };
}

export async function loadDailyKarteReport(
  supabase: Db,
  opts: { dateYmd: string; now: DateTime }
): Promise<DailyKarteReportData> {
  const { dateYmd, now } = opts;
  const dayStart = DateTime.fromISO(dateYmd, { zone: TZ }).startOf("day").toUTC();
  const dayEnd = dayStart.plus({ days: 1 });

  const [storeRows, reservationRows, noteRows, shiftRows, recipient] = await Promise.all([
    supabase.from("stores").select("id,name,is_active").order("name", { ascending: true }),
    loadReservationRows(supabase, dayStart.toISO()!, dayEnd.toISO()!),
    fetchPages((from, to) =>
      supabase
        .from("client_notes")
        .select("id, member_id, trainer_id, date")
        .eq("date", dateYmd)
        .order("id", { ascending: true })
        .range(from, to)
    ),
    loadShiftRows(supabase, dateYmd),
    findYutoLineRecipient(supabase),
  ]);

  if (storeRows.error) throw new Error(`stores_fetch_failed:${storeRows.error.message}`);

  const allStores = (storeRows.data ?? []) as Array<{ id: string; name: string; is_active: boolean }>;
  const storeNameById = new Map(allStores.map((store) => [String(store.id), String(store.name ?? "")]));
  const stores: DailyKarteStore[] = allStores
    .filter((store) => store.is_active)
    .map((store) => ({ id: String(store.id), name: String(store.name ?? "") }));

  const reservations = (reservationRows as any[]).filter((row) => {
    if (isCancelledStatus(row.status)) return false;
    if (!row.member_id) return false;
    return sessionIsReportable(
      { startAt: String(row.start_at), endAt: String(row.end_at ?? "") },
      now,
      dateYmd
    );
  });

  for (const row of reservations) {
    const storeId = String(row.store_id);
    if (!stores.some((store) => store.id === storeId)) {
      stores.push({ id: storeId, name: storeNameById.get(storeId) || "店舗" });
    }
  }

  const notes: KarteNote[] = (noteRows as any[])
    .filter((row) => String(row.date ?? "") === dateYmd)
    .map((row) => ({
      memberId: String(row.member_id ?? ""),
      trainerId: row.trainer_id ? String(row.trainer_id) : null,
    }));
  const noteTrainersByMember = new Map<string, string[]>();
  for (const note of notes) {
    if (!note.trainerId) continue;
    const list = noteTrainersByMember.get(note.memberId) ?? [];
    list.push(note.trainerId);
    noteTrainersByMember.set(note.memberId, list);
  }

  const shifts: ShiftCover[] = (shiftRows as any[])
    .filter((row) => !row.is_break)
    .map((row) => ({
      storeId: String(row.store_id ?? ""),
      trainerId: String(row.trainer_id ?? ""),
      startMin: localTimeToMinutes(String(row.start_local ?? "")),
      endMin: localTimeToMinutes(String(row.end_local ?? "")),
    }))
    .filter((shift) => shift.storeId && shift.trainerId);

  const memberIds = Array.from(new Set(reservations.map((row) => String(row.member_id))));
  const trainerIds = Array.from(
    new Set(
      [
        ...reservations.map((row) => String(row.trainer_id ?? "")),
        ...notes.map((note) => note.trainerId ?? ""),
        ...shifts.map((shift) => shift.trainerId),
      ].filter(Boolean)
    )
  );

  const shiftIds = (shiftRows as any[]).map((row) => String(row.id ?? "")).filter(Boolean);
  const [memberRows, trainerRows, breakRows, eventRows, cancelLogs] = await Promise.all([
    memberIds.length
      ? selectInChunks(memberIds, async (chunk) => {
          const { data, error } = await supabase
            .from("members")
            .select("id, member_code, name, display_name")
            .in("id", chunk);
          if (error) throw new Error(`members_fetch_failed:${error.message}`);
          return data ?? [];
        })
      : Promise.resolve([]),
    trainerIds.length
      ? selectInChunks(trainerIds, async (chunk) => {
          const { data, error } = await supabase.from("trainers").select("id, display_name").in("id", chunk);
          if (error) throw new Error(`trainers_fetch_failed:${error.message}`);
          return data ?? [];
        })
      : Promise.resolve([]),
    shiftIds.length
      ? loadOptionalRows(
          () =>
            selectInChunks(shiftIds, async (chunk) => {
              const { data, error } = await supabase
                .from("trainer_shift_breaks")
                .select("shift_id, start_time, end_time")
                .in("shift_id", chunk);
              if (error) throw new Error(error.message);
              return data ?? [];
            }),
          /trainer_shift_breaks|does not exist|schema cache|Could not find/i
        )
      : Promise.resolve([]),
    loadOptionalRows(
      () =>
        fetchPages((from, to) =>
          supabase
            .from("trainer_events")
            .select("store_id, trainer_id, start_local, end_local")
            .eq("event_date", dateYmd)
            .eq("block_booking", true)
            .order("id", { ascending: true })
            .range(from, to)
        ),
      /trainer_events|block_booking|does not exist|schema cache|Could not find/i
    ),
    loadOptionalRows(
      () =>
        fetchPages((from, to) =>
          supabase
            .from("reservation_change_logs")
            .select("reservation_id, before_store_id, before_start_at, created_at")
            .eq("action", "cancel")
            .gte("created_at", dayStart.toISO()!)
            .lt("created_at", dayEnd.toISO()!)
            .order("created_at", { ascending: true })
            .range(from, to)
        ),
      /reservation_change_logs|does not exist|schema cache|Could not find/i
    ),
  ]);

  const memberById = new Map<string, { code: string; name: string }>();
  for (const row of memberRows) {
    memberById.set(String(row.id), {
      code: String(row.member_code ?? ""),
      name: String(row.display_name ?? row.name ?? ""),
    });
  }
  const trainerNameById = new Map<string, string>();
  for (const row of trainerRows) {
    trainerNameById.set(String(row.id), String(row.display_name ?? ""));
  }

  const sessions: DailyKarteSession[] = reservations.map((row) => {
    const memberId = String(row.member_id);
    const storeId = String(row.store_id);
    const startMin = tokyoMinutes(String(row.start_at));
    let endMin = tokyoMinutes(String(row.end_at ?? ""));
    if (!Number.isFinite(endMin) || endMin <= startMin) endMin = startMin + 60;
    const trainerIds = resolveSessionTrainer({
      reservationTrainerId: row.trainer_id ? String(row.trainer_id) : null,
      noteTrainerIds: noteTrainersByMember.get(memberId) ?? [],
      coveringTrainerIds: coveringTrainerIds(shifts, storeId, startMin, endMin),
    });
    const member = memberById.get(memberId);
    const trainerName =
      trainerIds.length === 0
        ? "担当未設定"
        : trainerIds
            .map((id) => trainerNameById.get(id)?.trim() || "担当未設定")
            .sort((a, b) => a.localeCompare(b, "ja"))
            .join("・");
    return {
      storeId,
      trainerId: trainerIds.slice().sort().join("|") || null,
      trainerName,
      memberId,
      memberCode: member?.code ?? "",
      memberName: member?.name ?? "",
      startAt: String(row.start_at),
      sent: isKarteSent({ memberId, trainerId: null }, notes),
    };
  });

  const sent = sessions.filter((session) => session.sent).length;
  const factsByStoreId = buildStoreDayFacts({
    stores,
    dateYmd,
    shiftRows: shiftRows as any[],
    trainerNameById,
    reservationRows: reservationRows as any[],
    breaks: breakRows as any[],
    events: eventRows as any[],
    cancelLogs: cancelLogs as any[],
  });
  return {
    dateYmd,
    stores,
    sessions,
    factsByStoreId,
    recipient,
    summary: { sessions: sessions.length, sent, unsent: sessions.length - sent },
  };
}

export async function claimDailyKarteReport(
  supabase: Db,
  dateYmd: string
): Promise<"claimed" | "already" | "unavailable"> {
  const { error } = await supabase.from(DISPATCH_TABLE).insert({ report_date: dateYmd });
  if (!error) return "claimed";
  if (error.code === "23505" || /duplicate|unique/i.test(String(error.message ?? ""))) return "already";
  if (isMissingTable(error)) return "unavailable";
  throw new Error(`dispatch_claim_failed:${error.message}`);
}

export async function releaseDailyKarteReport(supabase: Db, dateYmd: string): Promise<void> {
  const { error } = await supabase.from(DISPATCH_TABLE).delete().eq("report_date", dateYmd);
  if (error && !isMissingTable(error)) throw new Error(`dispatch_release_failed:${error.message}`);
}
