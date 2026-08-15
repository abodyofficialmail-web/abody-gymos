import { DateTime } from "luxon";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { MidMonthLowBookingMember } from "@/lib/midMonthLowBooking";
import { MID_MONTH_LOW_BOOKING_MAX, MONTHLY_SESSION_TARGET } from "@/lib/lowBookingMotivation";
import { opsKindLabel, type TrainerOpsKind } from "@/lib/trainerOpsMessages";
import type { OpsRecipient } from "@/lib/trainerOpsScope";

const TZ = "Asia/Tokyo";
const GAP_MIN = 30;
const MAX_SUGGESTIONS = 3;
const MAX_LOW_BOOKING_LINES = 20;
const MAX_VOICE_LINES = 8;
const MAX_OPS_LINES = 8;

export type DailyStore = { id: string; name: string };

export type DailyShift = {
  store_id: string;
  trainer_id: string;
  start_local: string;
  end_local: string;
  is_break?: boolean | null;
};

export type DailyEvent = {
  store_id: string;
  trainer_id: string;
  start_local: string;
  end_local: string;
  title: string;
  notes: string | null;
  block_booking: boolean;
};

export type DailyReservation = {
  store_id: string;
  trainer_id: string | null;
  member_id: string | null;
  start_at: string;
  end_at: string;
};

export type DailySurveyVoice = {
  store_id: string;
  member_code: string;
  member_name: string;
  trainer_name: string;
  text: string;
};

export type DailyOpsMessage = {
  store_id: string | null;
  trainer_name: string;
  kind: TrainerOpsKind;
  body: string;
  created_at: string;
};

export type DailyOpsBundle = {
  dateYmd: string;
  target: "today" | "tomorrow";
  stores: DailyStore[];
  shifts: DailyShift[];
  events: DailyEvent[];
  reservations: DailyReservation[];
  memberById: Map<string, { member_code: string; name: string }>;
  trainerNameById: Map<string, string>;
  storeNameById: Map<string, string>;
  lowBooking: MidMonthLowBookingMember[];
  voices: DailySurveyVoice[];
  opsMessages: DailyOpsMessage[];
  karteDone: Set<string>;
};

function sliceHhmm(t: string) {
  const s = String(t ?? "");
  return s.length >= 5 ? s.slice(0, 5) : s;
}

function toMinutes(hhmm: string): number {
  const s = sliceHhmm(hhmm);
  const [h, m] = s.split(":").map((x) => Number(x));
  if (!Number.isFinite(h) || !Number.isFinite(m)) return NaN;
  return h * 60 + m;
}

function minutesToHhmm(n: number): string {
  const h = Math.floor(n / 60);
  const m = n % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function formatDateJa(ymd: string) {
  const dt = DateTime.fromISO(ymd, { zone: TZ });
  return dt.isValid ? dt.setLocale("ja").toFormat("yyyy年M月d日（ccc）") : ymd;
}

function formatTimeJa(utcIso: string) {
  return DateTime.fromISO(utcIso).setZone(TZ).toFormat("HH:mm");
}

function utcIsoToMinutes(utcIso: string): number {
  const dt = DateTime.fromISO(utcIso).setZone(TZ);
  if (!dt.isValid) return NaN;
  return dt.hour * 60 + dt.minute;
}

type Gap = { start: number; end: number };

function subtractBusy(start: number, end: number, busy: Gap[]): Gap[] {
  let parts: Gap[] = [{ start, end }];
  const sorted = busy.slice().sort((a, b) => a.start - b.start);
  for (const b of sorted) {
    const next: Gap[] = [];
    for (const p of parts) {
      if (b.end <= p.start || b.start >= p.end) {
        next.push(p);
        continue;
      }
      if (b.start > p.start) next.push({ start: p.start, end: Math.min(b.start, p.end) });
      if (b.end < p.end) next.push({ start: Math.max(b.end, p.start), end: p.end });
    }
    parts = next;
  }
  return parts.filter((p) => p.end - p.start >= GAP_MIN);
}

export function trainerFreeGaps(bundle: DailyOpsBundle, trainerId: string, storeId?: string): Gap[] {
  const shifts = bundle.shifts.filter(
    (s) =>
      s.trainer_id === trainerId &&
      s.is_break !== true &&
      (!storeId || s.store_id === storeId)
  );
  const busy: Gap[] = [];
  for (const r of bundle.reservations) {
    if (r.trainer_id !== trainerId) continue;
    if (storeId && r.store_id !== storeId) continue;
    const a = utcIsoToMinutes(r.start_at);
    const b = utcIsoToMinutes(r.end_at);
    if (Number.isFinite(a) && Number.isFinite(b) && b > a) busy.push({ start: a, end: b });
  }
  for (const e of bundle.events) {
    if (e.trainer_id !== trainerId) continue;
    if (storeId && e.store_id !== storeId) continue;
    const a = toMinutes(e.start_local);
    const b = toMinutes(e.end_local);
    if (Number.isFinite(a) && Number.isFinite(b) && b > a) busy.push({ start: a, end: b });
  }
  const gaps: Gap[] = [];
  for (const s of shifts) {
    const a = toMinutes(s.start_local);
    const b = toMinutes(s.end_local);
    if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) continue;
    gaps.push(...subtractBusy(a, b, busy));
  }
  return gaps.sort((x, y) => x.start - y.start);
}

function storeSection(bundle: DailyOpsBundle, store: DailyStore): string[] {
  const sid = store.id;
  const shiftList = bundle.shifts
    .filter((s) => s.store_id === sid && s.is_break !== true)
    .slice()
    .sort((a, b) => String(a.start_local).localeCompare(String(b.start_local)));
  const shiftLines =
    shiftList.length === 0
      ? ["（勤務予定なし）"]
      : shiftList.map((s) => {
          const trainerName = bundle.trainerNameById.get(s.trainer_id) ?? s.trainer_id;
          return `・${trainerName} ${sliceHhmm(s.start_local)}〜${sliceHhmm(s.end_local)}`;
        });

  const storeEvents = bundle.events.filter((e) => e.store_id === sid);
  const eventLines =
    storeEvents.length === 0
      ? ["（予定なし）"]
      : storeEvents
          .slice()
          .sort((a, b) => sliceHhmm(a.start_local).localeCompare(sliceHhmm(b.start_local)))
          .map((e) => {
            const trainerName = bundle.trainerNameById.get(e.trainer_id) ?? e.trainer_id;
            const title = String(e.title ?? "").trim() || "（無題）";
            const blockLabel = e.block_booking ? "抑える" : "抑えない";
            const note = e.notes?.trim() ? `｜${e.notes.trim()}` : "";
            return `・${sliceHhmm(e.start_local)}〜${sliceHhmm(e.end_local)} ${trainerName}｜${title}（予約枠: ${blockLabel}）${note}`;
          });

  const resList = bundle.reservations
    .filter((r) => r.store_id === sid)
    .slice()
    .sort((a, b) => String(a.start_at).localeCompare(String(b.start_at)));
  const resLines =
    resList.length === 0
      ? ["（予約なし）"]
      : resList.map((r) => {
          const member = r.member_id ? bundle.memberById.get(r.member_id) : undefined;
          const memberCode = member?.member_code || "";
          const memberName = member?.name || "";
          const tName = r.trainer_id ? bundle.trainerNameById.get(r.trainer_id) ?? "" : "—";
          const time = `${formatTimeJa(r.start_at)}〜${formatTimeJa(r.end_at)}`;
          const who = `${memberCode} ${memberName}`.trim() || "（会員）";
          return `・${time}  ${who}（${tName}）`;
        });

  return [
    `━━ ${store.name} ━━`,
    `■ 勤務予定`,
    ...shiftLines,
    ``,
    `■ 予定（MTG/撮影/作業など）`,
    ...eventLines,
    ``,
    `■ 予約一覧（${resList.length}件）`,
    ...resLines,
    ``,
  ];
}

function lowBookingSection(members: MidMonthLowBookingMember[], storeName?: string): string[] {
  const list = storeName ? members.filter((m) => m.store === storeName) : members;
  if (list.length === 0) {
    return storeName
      ? [`■ 予約が少ない会員（${storeName}・今月${MID_MONTH_LOW_BOOKING_MAX}回以下）`, "（該当なし）", ""]
      : [];
  }
  const dist = new Map<number, number>();
  for (const m of list) dist.set(m.count, (dist.get(m.count) ?? 0) + 1);
  const distLine = [0, 1, 2, 3, 4].filter((n) => dist.has(n)).map((n) => `${n}回 ${dist.get(n)}人`).join(" / ");
  const shown = list.slice(0, MAX_LOW_BOOKING_LINES);
  const more = list.length > shown.length ? `…他 ${list.length - shown.length}人` : null;
  const title = storeName
    ? `■ 予約が少ない会員（${storeName}・今月${MID_MONTH_LOW_BOOKING_MAX}回以下）${list.length}人`
    : `■ 予約が少ない会員（今月${MID_MONTH_LOW_BOOKING_MAX}回以下）${list.length}人　目標${MONTHLY_SESSION_TARGET}コマ`;
  return [
    title,
    distLine,
    ...shown.map((m) => `${m.member_code} ${m.name}（${m.store}） ${m.count}回${m.line_user_id ? "" : " LINEなし"}`),
    ...(more ? [more] : []),
    "",
  ];
}

function voiceSection(voices: DailySurveyVoice[], storeIds: Set<string> | null, heading: string): string[] {
  const list = storeIds ? voices.filter((v) => storeIds.has(v.store_id)) : voices;
  if (list.length === 0) return [`■ ${heading}`, "（なし）", ""];
  const shown = list.slice(0, MAX_VOICE_LINES);
  const more = list.length > shown.length ? `…他 ${list.length - shown.length}件` : null;
  return [
    `■ ${heading}`,
    ...shown.map((v) => `・${v.member_code} ${v.member_name}（${v.trainer_name}）${v.text}`),
    ...(more ? [more] : []),
    "",
  ];
}

function opsSection(msgs: DailyOpsMessage[], storeIds: Set<string> | null): string[] {
  const list = storeIds
    ? msgs.filter((m) => !m.store_id || storeIds.has(m.store_id))
    : msgs;
  if (list.length === 0) return [`■ 未対応の発注・報告`, "（なし）", ""];
  const shown = list.slice(0, MAX_OPS_LINES);
  const more = list.length > shown.length ? `…他 ${list.length - shown.length}件` : null;
  return [
    `■ 未対応の発注・報告`,
    ...shown.map((m) => {
      const day = DateTime.fromISO(m.created_at).setZone(TZ).toFormat("M/d");
      return `・${m.trainer_name} ${opsKindLabel(m.kind)} ${m.body}（${day}）`;
    }),
    ...(more ? [more] : []),
    "",
  ];
}

function suggestionForGap(
  bundle: DailyOpsBundle,
  trainerId: string,
  storeIds: string[],
  usedMemberIds: Set<string>
): string {
  const dateYmd = bundle.dateYmd;
  const missingKarte = bundle.reservations.filter((r) => {
    if (r.trainer_id !== trainerId || !r.member_id) return false;
    if (storeIds.length && !storeIds.includes(r.store_id)) return false;
    return !bundle.karteDone.has(`${r.member_id}:${dateYmd}`);
  });
  if (missingKarte[0]?.member_id) {
    const m = bundle.memberById.get(missingKarte[0].member_id);
    const who = m ? `${m.member_code} ${m.name}`.trim() : "本日の会員";
    return `${who}のカルテ記入`;
  }
  const storeNames = new Set(storeIds.map((id) => bundle.storeNameById.get(id)).filter(Boolean) as string[]);
  const follow = bundle.lowBooking.find((m) => {
    if (usedMemberIds.has(m.id)) return false;
    if (storeNames.size === 0) return true;
    return storeNames.has(m.store);
  });
  if (follow) {
    usedMemberIds.add(follow.id);
    const how = follow.line_user_id ? "予約の声かけ" : "電話フォロー（LINEなし）";
    return `${follow.member_code} ${follow.name}（今月${follow.count}回）${how}`;
  }
  const order = bundle.opsMessages.find((m) => m.kind === "order" && (!m.store_id || storeIds.includes(m.store_id)));
  if (order) return `${opsKindLabel(order.kind)}の対応: ${order.body}`;
  return "店舗点検・在庫確認・カルテ見直し";
}

function instructionSection(bundle: DailyOpsBundle, trainerIds: string[], storeId?: string): string[] {
  const lines: string[] = ["■ 空き時間の指示"];
  let any = false;
  for (const trainerId of trainerIds) {
    const gaps = trainerFreeGaps(bundle, trainerId, storeId);
    if (gaps.length === 0) continue;
    any = true;
    const name = bundle.trainerNameById.get(trainerId) ?? trainerId;
    lines.push(`${name}`);
    const used = new Set<string>();
    const storeIds = storeId
      ? [storeId]
      : Array.from(new Set(bundle.shifts.filter((s) => s.trainer_id === trainerId).map((s) => s.store_id)));
    for (const g of gaps.slice(0, MAX_SUGGESTIONS)) {
      const task = suggestionForGap(bundle, trainerId, storeIds, used);
      lines.push(`・${minutesToHhmm(g.start)}〜${minutesToHhmm(g.end)} ${task}`);
    }
  }
  if (!any) lines.push("（大きめの空きなし）");
  lines.push("");
  return lines;
}

function timingLabel(target: "today" | "tomorrow") {
  return target === "tomorrow"
    ? "明日の業務サマリ（前日22時）"
    : "本日の業務サマリ（当日7時）";
}

function storesForRecipient(bundle: DailyOpsBundle, recipient: OpsRecipient): DailyStore[] {
  if (recipient.all_stores) return bundle.stores;
  if (recipient.store_names.length > 0) {
    return bundle.stores.filter((s) => recipient.store_names.includes(s.name));
  }
  if (recipient.trainer_id) {
    const ids = new Set(
      [
        ...bundle.shifts.filter((s) => s.trainer_id === recipient.trainer_id).map((s) => s.store_id),
        ...bundle.reservations.filter((r) => r.trainer_id === recipient.trainer_id).map((r) => r.store_id),
      ]
    );
    const fromShift = bundle.stores.filter((s) => ids.has(s.id));
    if (fromShift.length > 0) return fromShift;
  }
  return [];
}

export function buildDailyOpsText(bundle: DailyOpsBundle, recipient: OpsRecipient): string | null {
  const dateLabel = formatDateJa(bundle.dateYmd);
  const stores = storesForRecipient(bundle, recipient);
  const storeIds = new Set(stores.map((s) => s.id));
  const voiceHeading = bundle.target === "tomorrow" ? "本日の会員の声" : "会員の声";

  if (recipient.kind === "trainer" && stores.length === 0) return null;

  if (recipient.kind === "owner" || recipient.all_stores) {
    const lines = [`【全店舗】${dateLabel}｜${timingLabel(bundle.target)}`, ``];
    for (const st of bundle.stores) lines.push(...storeSection(bundle, st));
    lines.push(...lowBookingSection(bundle.lowBooking));
    lines.push(...voiceSection(bundle.voices, null, voiceHeading));
    lines.push(...opsSection(bundle.opsMessages, null));
    const trainerIds = Array.from(new Set(bundle.shifts.map((s) => s.trainer_id)));
    lines.push(...instructionSection(bundle, trainerIds));
    return lines.join("\n").trimEnd();
  }

  if (recipient.kind === "store_manager") {
    const names = stores.map((s) => s.name).join("・") || recipient.store_names.join("・") || "担当店舗";
    const lines = [`【${names}】${dateLabel}｜${timingLabel(bundle.target)}`, ``];
    if (stores.length === 0) {
      lines.push("担当店舗の勤務・予約はありません。");
      return lines.join("\n");
    }
    for (const st of stores) {
      lines.push(...storeSection(bundle, st));
      const trainerIds = Array.from(
        new Set(bundle.shifts.filter((s) => s.store_id === st.id).map((s) => s.trainer_id))
      );
      lines.push(...instructionSection(bundle, trainerIds, st.id));
      lines.push(...lowBookingSection(bundle.lowBooking, st.name));
    }
    lines.push(...voiceSection(bundle.voices, storeIds, voiceHeading));
    lines.push(...opsSection(bundle.opsMessages, storeIds));
    lines.push("数字を見て、フォローと空き時間の使い方を決めてください。");
    return lines.join("\n").trimEnd();
  }

  const name = recipient.display_name || "トレーナー";
  const lines = [`【${name}】${dateLabel}｜${timingLabel(bundle.target)}`, ``];
  if (!recipient.trainer_id) return null;
  for (const st of stores) lines.push(...storeSection(bundle, st));
  lines.push(...instructionSection(bundle, [recipient.trainer_id]));
  const myStores = new Set(stores.map((s) => s.name));
  const myLow = bundle.lowBooking.filter((m) => myStores.has(m.store)).slice(0, 8);
  if (myLow.length > 0) {
    lines.push(`■ 担当店舗で予約が少ない会員`);
    lines.push(
      ...myLow.map(
        (m) => `${m.member_code} ${m.name} ${m.count}回${m.line_user_id ? "" : " LINEなし"}`
      )
    );
    lines.push("");
  }
  return lines.join("\n").trimEnd();
}

export async function loadDailySurveyVoices(
  supabase: SupabaseClient,
  ymd: string
): Promise<DailySurveyVoice[]> {
  const { data, error } = await supabase
    .from("session_survey_responses")
    .select("store_id, member_id, trainer_id, comment_general, comment_improve, comment_questions, needs_followup")
    .eq("session_date", ymd);
  if (error) {
    console.warn("[dailyBriefing] surveys skipped", error.message);
    return [];
  }
  const rows = data ?? [];
  const memberIds = Array.from(new Set(rows.map((r: any) => String(r.member_id)).filter(Boolean)));
  const trainerIds = Array.from(new Set(rows.map((r: any) => String(r.trainer_id)).filter(Boolean)));
  const [membersQ, trainersQ] = await Promise.all([
    memberIds.length
      ? supabase.from("members").select("id,member_code,name,display_name").in("id", memberIds)
      : Promise.resolve({ data: [] as any[] }),
    trainerIds.length
      ? supabase.from("trainers").select("id,display_name").in("id", trainerIds)
      : Promise.resolve({ data: [] as any[] }),
  ]);
  const memberById = new Map(
    (membersQ.data ?? []).map((m: any) => [
      String(m.id),
      { code: String(m.member_code ?? ""), name: String(m.display_name ?? m.name ?? "") },
    ])
  );
  const trainerById = new Map((trainersQ.data ?? []).map((t: any) => [String(t.id), String(t.display_name ?? "")]));
  const out: DailySurveyVoice[] = [];
  for (const r of rows as any[]) {
    const parts = [r.comment_general, r.comment_improve, r.comment_questions]
      .map((x: unknown) => String(x ?? "").trim())
      .filter(Boolean);
    if (r.needs_followup) parts.unshift("要フォロー");
    if (parts.length === 0) continue;
    const mem = memberById.get(String(r.member_id));
    out.push({
      store_id: String(r.store_id ?? ""),
      member_code: mem?.code ?? "",
      member_name: mem?.name ?? "",
      trainer_name: trainerById.get(String(r.trainer_id)) ?? "",
      text: parts.join(" / "),
    });
  }
  return out;
}

export async function loadOpenOpsMessages(supabase: SupabaseClient): Promise<DailyOpsMessage[]> {
  try {
    const { data, error } = await supabase
      .from("trainer_ops_messages" as any)
      .select("store_id, trainer_id, kind, body, created_at, trainers ( display_name )")
      .eq("status", "open")
      .order("created_at", { ascending: false })
      .limit(30);
    if (error) {
      console.warn("[dailyBriefing] ops messages skipped", error.message);
      return [];
    }
    return (data ?? []).map((row: any) => ({
      store_id: row.store_id ? String(row.store_id) : null,
      trainer_name:
        row.trainers && typeof row.trainers === "object"
          ? String(row.trainers.display_name ?? "")
          : "",
      kind: row.kind as TrainerOpsKind,
      body: String(row.body ?? ""),
      created_at: String(row.created_at ?? ""),
    }));
  } catch (e) {
    console.warn("[dailyBriefing] ops messages failed", e);
    return [];
  }
}

export async function loadKarteDoneKeys(
  supabase: SupabaseClient,
  dateYmd: string,
  memberIds: string[]
): Promise<Set<string>> {
  const out = new Set<string>();
  if (memberIds.length === 0) return out;
  const { data, error } = await supabase
    .from("client_notes")
    .select("member_id,date")
    .eq("date", dateYmd)
    .in("member_id", memberIds);
  if (error) {
    console.warn("[dailyBriefing] karte lookup skipped", error.message);
    return out;
  }
  for (const row of data ?? []) {
    out.add(`${row.member_id}:${row.date}`);
  }
  return out;
}
