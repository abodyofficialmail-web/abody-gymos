import { DateTime } from "luxon";
import type { SupabaseClient } from "@supabase/supabase-js";

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

export function formatDailyKarteReport(input: {
  dateYmd: string;
  stores: DailyKarteStore[];
  sessions: DailyKarteSession[];
}): string {
  const dateLabel = DateTime.fromISO(input.dateYmd, { zone: TZ }).setLocale("ja").toFormat("yyyy年M月d日（ccc）");
  const lines: string[] = [`【日報】${dateLabel}`, ""];
  let total = 0;
  let sent = 0;

  for (const store of sortStores(input.stores)) {
    lines.push(`━━ ${store.name} ━━`);
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
      lines.push(`${name}　${group.length}セッション　カルテ送信 ${formatRate(sentN, group.length)}`);
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
    lines.push("合計　0セッション");
  } else {
    lines.push(`合計　${total}セッション　カルテ送信 ${formatRate(sent, total)}`);
    const unsent = total - sent;
    if (unsent > 0) lines.push(`未送信 ${unsent}件`);
  }
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

  const [storeRows, reservationRows, noteRows, recipient] = await Promise.all([
    supabase.from("stores").select("id,name,is_active").order("name", { ascending: true }),
    fetchPages((from, to) =>
      supabase
        .from("reservations")
        .select("id, store_id, trainer_id, member_id, start_at, end_at, status")
        .gte("start_at", dayStart.toISO()!)
        .lt("start_at", dayEnd.toISO()!)
        .order("start_at", { ascending: true })
        .order("id", { ascending: true })
        .range(from, to)
    ),
    fetchPages((from, to) =>
      supabase
        .from("client_notes")
        .select("id, member_id, trainer_id, date")
        .eq("date", dateYmd)
        .order("id", { ascending: true })
        .range(from, to)
    ),
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

  const memberIds = Array.from(new Set(reservations.map((row) => String(row.member_id))));
  const trainerIds = Array.from(
    new Set(reservations.map((row) => String(row.trainer_id ?? "")).filter(Boolean))
  );

  const [memberRows, trainerRows] = await Promise.all([
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

  const notes: KarteNote[] = (noteRows as any[])
    .filter((row) => String(row.date ?? "") === dateYmd)
    .map((row) => ({
      memberId: String(row.member_id ?? ""),
      trainerId: row.trainer_id ? String(row.trainer_id) : null,
    }));

  const sessions: DailyKarteSession[] = reservations.map((row) => {
    const memberId = String(row.member_id);
    const trainerId = row.trainer_id ? String(row.trainer_id) : null;
    const member = memberById.get(memberId);
    return {
      storeId: String(row.store_id),
      trainerId,
      trainerName: trainerId ? trainerNameById.get(trainerId) || "担当未設定" : "担当未設定",
      memberId,
      memberCode: member?.code ?? "",
      memberName: member?.name ?? "",
      startAt: String(row.start_at),
      sent: isKarteSent({ memberId, trainerId }, notes),
    };
  });

  const sent = sessions.filter((session) => session.sent).length;
  return {
    dateYmd,
    stores,
    sessions,
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
