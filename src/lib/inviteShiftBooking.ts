import { DateTime } from "luxon";
import type { SupabaseClient } from "@supabase/supabase-js";
import { effectiveBookingCapacity } from "@/lib/bookingStoreCapacity";
import { getAppUrl } from "@/lib/constants";
import { lineMessageWithReservationDetails } from "@/lib/lineReservationMessage";
import {
  lineAccessTokenForChannelKey,
  lineChannelKeyForStoreName,
  lineMemberProfileReachable,
  linePushTokenForMember,
  normalizeLineChannelKey,
  type LineChannelKey,
} from "@/lib/lineChannel";
import { createHmac, timingSafeEqual } from "crypto";
import { canBookOrLogin } from "@/lib/memberMembershipStatus";

const TZ = "Asia/Tokyo";
const STEP_MIN = 30;
export const INVITE_VISIBILITY = "invite";

export const SAK_SEP11_INVITE = {
  date: "2026-09-11",
  start: "16:00",
  end: "21:30",
  storeName: "桜木町",
  trainerName: "りょう",
  slotMinutesByCode: {
    SAK009: 60,
    SAK044: 60,
    SAK036: 30,
    SAK029: 30,
    SAK017: 30,
    SAK049: 30,
    SAK002: 30,
    SAK051: 30,
  } as Record<string, 30 | 60>,
};

export const SHINJUKU_SEP16_LEFTOVER = {
  date: "2026-09-16",
  start: "18:00",
  end: "22:00",
  storeName: "新宿",
  trainerName: "だいき",
  slotMinutesByCode: {} as Record<string, 30 | 60>,
};

export const UENO_SEP17_LEFTOVER = {
  date: "2026-09-17",
  start: "16:00",
  end: "22:00",
  storeName: "上野",
  trainerName: "ひろむ",
  slotMinutesByCode: {} as Record<string, 30 | 60>,
  allowedStarts: ["16:00", "16:30", "17:00", "17:30", "18:30", "19:30", "20:30", "21:00"],
};

export type InviteSlot = {
  start_at: string;
  end_at: string;
  date_label: string;
  time_label: string;
};

export type InviteQuery = { s: string; sig: string };

export type InviteContext = {
  query: InviteQuery;
  member_id: string;
  member_code: string;
  member_name: string;
  line_user_id: string | null;
  line_channel_key: string | null;
  shift_id: string;
  store_id: string;
  store_name: string;
  trainer_id: string | null;
  trainer_name: string | null;
  shift_date: string;
  start_local: string;
  end_local: string;
  slot_minutes: number;
  expires_at: string;
};

type InviteSignedPayload = {
  kind: "invite_shift";
  member_id: string;
  shift_id: string;
  slot_minutes: number;
  exp: number;
};

function signingSecret(): string | null {
  const s =
    process.env.TRAINER_GATE_SECRET?.trim() ||
    process.env.GOAL_HEARING_SIGN_SECRET?.trim() ||
    process.env.CRON_SECRET?.trim() ||
    "";
  return s || null;
}

function canonicalInvite(p: InviteSignedPayload): string {
  return [p.kind, p.member_id, p.shift_id, String(p.slot_minutes), String(p.exp)].join("|");
}

export function signInviteShiftQuery(params: {
  memberId: string;
  shiftId: string;
  slotMinutes: number;
  expiresAtMs: number;
}): InviteQuery | null {
  const secret = signingSecret();
  if (!secret) return null;
  const full: InviteSignedPayload = {
    kind: "invite_shift",
    member_id: params.memberId,
    shift_id: params.shiftId,
    slot_minutes: params.slotMinutes === 60 ? 60 : 30,
    exp: params.expiresAtMs,
  };
  const s = Buffer.from(JSON.stringify(full), "utf8").toString("base64url");
  const sig = createHmac("sha256", secret).update(canonicalInvite(full)).digest("base64url");
  return { s, sig };
}

export function verifyInviteShiftQuery(s: string, sig: string): InviteSignedPayload | null {
  const secret = signingSecret();
  if (!secret || !s || !sig) return null;
  try {
    const payload = JSON.parse(Buffer.from(s, "base64url").toString("utf8")) as InviteSignedPayload;
    if (payload?.kind !== "invite_shift" || !payload.member_id || !payload.shift_id) return null;
    if (typeof payload.exp !== "number" || payload.exp < Date.now()) return null;
    const expected = createHmac("sha256", secret).update(canonicalInvite(payload)).digest("base64url");
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    return payload;
  } catch {
    return null;
  }
}

function toHHMMSS(t: string): string {
  const s = String(t ?? "").trim();
  if (/^\d{2}:\d{2}:\d{2}$/.test(s)) return s;
  if (/^\d{2}:\d{2}$/.test(s)) return `${s}:00`;
  return s;
}

function toMinutes(t: string): number {
  const s = toHHMMSS(t);
  const h = Number(s.slice(0, 2));
  const m = Number(s.slice(3, 5));
  if (!Number.isFinite(h) || !Number.isFinite(m)) return NaN;
  return h * 60 + m;
}

function minutesToLocal(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00`;
}

export function isMissingBookingVisibilityColumn(err: unknown): boolean {
  const msg = String((err as { message?: string } | null)?.message ?? err ?? "");
  return /booking_visibility/i.test(msg) && /does not exist|schema cache|column|Could not find/i.test(msg);
}

export async function dropInviteOnlyShifts<T extends { id: string }>(
  supabase: SupabaseClient,
  shifts: T[]
): Promise<T[]> {
  if (shifts.length === 0) return shifts;
  const ids = shifts.map((s) => s.id).filter(Boolean);
  if (ids.length === 0) return shifts;
  const { data, error } = await supabase.from("trainer_shifts").select("id, booking_visibility").in("id", ids);
  if (error) {
    if (isMissingBookingVisibilityColumn(error)) return shifts;
    console.error("dropInviteOnlyShifts failed", error);
    return shifts;
  }
  const inviteIds = new Set(
    (data ?? [])
      .filter((r) => String((r as { booking_visibility?: string }).booking_visibility ?? "") === INVITE_VISIBILITY)
      .map((r) => String((r as { id: string }).id))
  );
  if (inviteIds.size === 0) return shifts;
  return shifts.filter((s) => !inviteIds.has(s.id));
}

export function generateInviteSlots(params: {
  dateYmd: string;
  startLocal: string;
  endLocal: string;
  slotMinutes: number;
  now?: DateTime;
}): InviteSlot[] {
  const zone = TZ;
  const startMin = toMinutes(params.startLocal);
  const endMin = toMinutes(params.endLocal);
  const slot = params.slotMinutes;
  if (!Number.isFinite(startMin) || !Number.isFinite(endMin) || slot <= 0 || endMin <= startMin) return [];
  const now = params.now ?? DateTime.now().setZone(zone);
  const out: InviteSlot[] = [];
  for (let m = startMin; m + slot <= endMin; m += STEP_MIN) {
    const startLocal = minutesToLocal(m);
    const endLocal = minutesToLocal(m + slot);
    const start = DateTime.fromISO(`${params.dateYmd}T${startLocal.slice(0, 5)}:00`, { zone });
    const end = DateTime.fromISO(`${params.dateYmd}T${endLocal.slice(0, 5)}:00`, { zone });
    if (!start.isValid || !end.isValid) continue;
    if (start.toMillis() <= now.toMillis()) continue;
    const startIso = start.toUTC().toISO({ suppressMilliseconds: true });
    const endIso = end.toUTC().toISO({ suppressMilliseconds: true });
    if (!startIso || !endIso) continue;
    out.push({
      start_at: startIso,
      end_at: endIso,
      date_label: start.setLocale("ja").toFormat("M月d日（ccc）"),
      time_label: `${start.toFormat("HH:mm")}〜${end.toFormat("HH:mm")}`,
    });
  }
  return out;
}

async function overlappingBookedCount(
  supabase: SupabaseClient,
  storeId: string,
  startAt: string,
  endAt: string
): Promise<number> {
  const run = async (onlyBlocking: boolean) => {
    let q = supabase
      .from("reservations")
      .select("id", { count: "exact", head: true })
      .eq("store_id", storeId)
      .lt("start_at", endAt)
      .gt("end_at", startAt)
      .neq("status", "cancelled");
    if (onlyBlocking) q = q.eq("blocks_capacity", true);
    return q;
  };
  const primary = await run(true);
  if (!primary.error) return primary.count ?? 0;
  const fallback = await run(false);
  if (fallback.error) throw fallback.error;
  return fallback.count ?? 0;
}

export async function loadInviteContext(
  supabase: SupabaseClient,
  query: { s?: string | null; sig?: string | null }
): Promise<{ ok: true; ctx: InviteContext } | { ok: false; status: number; error: string }> {
  const signed = verifyInviteShiftQuery(String(query.s ?? ""), String(query.sig ?? ""));
  if (!signed) return { ok: false, status: 404, error: "案内リンクが無効です" };

  const [{ data: member }, { data: shift }] = await Promise.all([
    supabase
      .from("members")
      .select("id, member_code, name, display_name, is_active, membership_status, line_user_id, line_channel_key")
      .eq("id", signed.member_id)
      .maybeSingle(),
    supabase
      .from("trainer_shifts")
      .select("id, trainer_id, store_id, shift_date, start_local, end_local, status")
      .eq("id", signed.shift_id)
      .maybeSingle(),
  ]);

  if (!member || !canBookOrLogin({ membershipStatus: member.membership_status, isActive: member.is_active })) {
    return { ok: false, status: 404, error: "会員が見つかりません" };
  }
  if (!shift) return { ok: false, status: 404, error: "枠が見つかりません" };

  const { data: store } = await supabase.from("stores").select("id, name").eq("id", shift.store_id).maybeSingle();
  if (!store) return { ok: false, status: 404, error: "店舗が見つかりません" };
  const { data: trainer } = shift.trainer_id
    ? await supabase.from("trainers").select("id, display_name").eq("id", shift.trainer_id).maybeSingle()
    : { data: null };

  return {
    ok: true,
    ctx: {
      query: { s: String(query.s), sig: String(query.sig) },
      member_id: member.id,
      member_code: String(member.member_code ?? ""),
      member_name: String(member.display_name ?? member.name ?? ""),
      line_user_id: member.line_user_id ?? null,
      line_channel_key: member.line_channel_key ?? null,
      shift_id: shift.id,
      store_id: store.id,
      store_name: store.name,
      trainer_id: shift.trainer_id ?? null,
      trainer_name: trainer?.display_name ?? null,
      shift_date: String(shift.shift_date).slice(0, 10),
      start_local: toHHMMSS(String(shift.start_local)),
      end_local: toHHMMSS(String(shift.end_local)),
      slot_minutes: Number(signed.slot_minutes) === 60 ? 60 : 30,
      expires_at: new Date(signed.exp).toISOString(),
    },
  };
}

function slotStartHhmm(iso: string): string {
  return DateTime.fromISO(iso).setZone(TZ).toFormat("HH:mm");
}

export function filterInviteSlotsByStarts(slots: InviteSlot[], allowedStarts?: string[] | null): InviteSlot[] {
  if (!allowedStarts || allowedStarts.length === 0) return slots;
  const allow = new Set(allowedStarts);
  return slots.filter((s) => allow.has(slotStartHhmm(s.start_at)));
}

async function fetchShiftBreaks(
  supabase: SupabaseClient,
  shiftId: string
): Promise<Array<{ start_min: number; end_min: number }>> {
  const { data, error } = await supabase
    .from("trainer_shift_breaks")
    .select("start_time, end_time")
    .eq("shift_id", shiftId);
  if (error) return [];
  const out: Array<{ start_min: number; end_min: number }> = [];
  for (const b of data ?? []) {
    const a = toMinutes(String((b as { start_time?: string }).start_time));
    const e = toMinutes(String((b as { end_time?: string }).end_time));
    if (Number.isFinite(a) && Number.isFinite(e) && e > a) out.push({ start_min: a, end_min: e });
  }
  return out;
}

function overlapsBreak(startAt: string, endAt: string, breaks: Array<{ start_min: number; end_min: number }>): boolean {
  const start = DateTime.fromISO(startAt).setZone(TZ);
  const end = DateTime.fromISO(endAt).setZone(TZ);
  const a = start.hour * 60 + start.minute;
  const e = end.hour * 60 + end.minute;
  return breaks.some((b) => a < b.end_min && e > b.start_min);
}

export async function listOpenInviteSlots(
  supabase: SupabaseClient,
  ctx: InviteContext
): Promise<InviteSlot[]> {
  const candidates = generateInviteSlots({
    dateYmd: ctx.shift_date,
    startLocal: ctx.start_local,
    endLocal: ctx.end_local,
    slotMinutes: ctx.slot_minutes,
  });
  const breaks = await fetchShiftBreaks(supabase, ctx.shift_id);
  const open: InviteSlot[] = [];
  for (const slot of candidates) {
    if (overlapsBreak(slot.start_at, slot.end_at, breaks)) continue;
    const booked = await overlappingBookedCount(supabase, ctx.store_id, slot.start_at, slot.end_at);
    const capacity = effectiveBookingCapacity({ storeName: ctx.store_name, trainerCount: 1 });
    if (booked >= capacity) continue;
    const { count, error } = await supabase
      .from("reservations")
      .select("id", { count: "exact", head: true })
      .eq("member_id", ctx.member_id)
      .lt("start_at", slot.end_at)
      .gt("end_at", slot.start_at)
      .neq("status", "cancelled");
    if (error) throw error;
    if ((count ?? 0) > 0) continue;
    open.push(slot);
  }
  return open;
}

export function inviteBookPageUrl(query: InviteQuery, slot?: Pick<InviteSlot, "start_at" | "end_at">): string {
  const q = new URLSearchParams({ s: query.s, sig: query.sig });
  if (slot) {
    q.set("start_at", slot.start_at);
    q.set("end_at", slot.end_at);
  }
  return `${getAppUrl()}/invite-book?${q.toString()}`;
}

export async function bookInviteSlot(
  supabase: SupabaseClient,
  ctx: InviteContext,
  startAt: string,
  endAt: string
): Promise<{ ok: true; reservation: Record<string, unknown> } | { ok: false; status: number; error: string }> {
  const start = DateTime.fromISO(startAt);
  const end = DateTime.fromISO(endAt);
  if (!start.isValid || !end.isValid || end <= start) {
    return { ok: false, status: 400, error: "日時が不正です" };
  }
  const minutes = Math.round(end.diff(start, "minutes").minutes);
  if (minutes !== ctx.slot_minutes) {
    return { ok: false, status: 400, error: `${ctx.slot_minutes}分の枠を選んでください` };
  }
  const startMs = start.toMillis();
  const endMs = end.toMillis();
  const allowed = generateInviteSlots({
    dateYmd: ctx.shift_date,
    startLocal: ctx.start_local,
    endLocal: ctx.end_local,
    slotMinutes: ctx.slot_minutes,
  });
  const hit = allowed.some(
    (s) => DateTime.fromISO(s.start_at).toMillis() === startMs && DateTime.fromISO(s.end_at).toMillis() === endMs
  );
  if (!hit) {
    return { ok: false, status: 409, error: "この時間は案内対象外です" };
  }
  const breaks = await fetchShiftBreaks(supabase, ctx.shift_id);
  if (overlapsBreak(startAt, endAt, breaks)) {
    return { ok: false, status: 409, error: "この時間は案内対象外です" };
  }

  const booked = await overlappingBookedCount(supabase, ctx.store_id, startAt, endAt);
  const capacity = effectiveBookingCapacity({ storeName: ctx.store_name, trainerCount: 1 });
  if (booked >= capacity) {
    return { ok: false, status: 409, error: "この時間は埋まりました。別の枠を選んでください" };
  }

  const { count: dup, error: dupErr } = await supabase
    .from("reservations")
    .select("id", { count: "exact", head: true })
    .eq("member_id", ctx.member_id)
    .lt("start_at", endAt)
    .gt("end_at", startAt)
    .neq("status", "cancelled");
  if (dupErr) return { ok: false, status: 500, error: "予約の重複確認に失敗しました" };
  if ((dup ?? 0) > 0) return { ok: false, status: 409, error: "この時間は既に予約されています" };

  const insertRow = {
    store_id: ctx.store_id,
    member_id: ctx.member_id,
    trainer_id: ctx.trainer_id,
    start_at: startAt,
    end_at: endAt,
    session_type: "store" as const,
    status: "confirmed",
    notes: "created_from=invite_shift_booking",
    blocks_capacity: true,
  };
  const selectCols = "id, store_id, member_id, trainer_id, start_at, end_at, session_type, status";
  const first = await supabase.from("reservations").insert(insertRow).select(selectCols).single();
  let reservation = first.data as Record<string, unknown> | null;
  let insErr = first.error;
  if (insErr) {
    const msg = String(insErr.message ?? "");
    if (insErr.code === "23505") return { ok: false, status: 409, error: "既に予約されています" };
    if (/blocks_capacity|guest_name|does not exist|column/i.test(msg)) {
      const row2 = { ...insertRow } as Record<string, unknown>;
      delete row2.blocks_capacity;
      const second = await supabase.from("reservations").insert(row2 as typeof insertRow).select(selectCols).single();
      reservation = second.data as Record<string, unknown> | null;
      insErr = second.error;
    }
  }
  if (insErr || !reservation) {
    return { ok: false, status: 500, error: "予約の保存に失敗しました" };
  }

  if (ctx.line_user_id) {
    const text = lineMessageWithReservationDetails({
      storeName: ctx.store_name,
      startAtUtcIso: String(reservation.start_at),
      endAtUtcIso: String(reservation.end_at),
      sessionType: "store",
    });
    const line = linePushTokenForMember({
      lineChannelKey: normalizeLineChannelKey(ctx.line_channel_key),
      memberCode: ctx.member_code,
      fallbackStoreName: ctx.store_name,
    });
    if (line.token) {
      await fetch("https://api.line.me/v2/bot/message/push", {
        method: "POST",
        headers: { Authorization: `Bearer ${line.token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ to: ctx.line_user_id, messages: [{ type: "text", text }] }),
      }).catch((e) => console.error("invite booking LINE confirm failed", e));
    }
  }

  return { ok: true, reservation };
}

function slotBubble(params: { storeName: string; slot: InviteSlot; bookingUrl: string; minutes: number }) {
  return {
    type: "bubble",
    size: "kilo",
    header: {
      type: "box",
      layout: "vertical",
      backgroundColor: "#059669",
      paddingAll: "16px",
      contents: [
        { type: "text", text: params.storeName, size: "xs", color: "#d1fae5" },
        {
          type: "text",
          text: params.slot.date_label,
          weight: "bold",
          size: "lg",
          color: "#ffffff",
          wrap: true,
        },
      ],
    },
    body: {
      type: "box",
      layout: "vertical",
      spacing: "sm",
      paddingAll: "16px",
      contents: [
        {
          type: "text",
          text: params.slot.time_label,
          weight: "bold",
          size: "xl",
          color: "#065f46",
        },
        {
          type: "text",
          text: `${params.minutes}分枠 · ご案内した方のみ`,
          size: "xs",
          color: "#64748b",
          wrap: true,
        },
      ],
    },
    footer: {
      type: "box",
      layout: "vertical",
      paddingAll: "12px",
      contents: [
        {
          type: "button",
          style: "primary",
          color: "#059669",
          height: "sm",
          action: { type: "uri", label: "この枠で予約する", uri: params.bookingUrl },
        },
      ],
    },
  };
}

function listBubble(url: string) {
  return {
    type: "bubble",
    size: "kilo",
    body: {
      type: "box",
      layout: "vertical",
      spacing: "sm",
      paddingAll: "16px",
      contents: [
        { type: "text", text: "時間の一覧を見る", weight: "bold", size: "md", color: "#0f172a", wrap: true },
        { type: "text", text: "埋まっていない枠だけ表示します。", size: "sm", color: "#64748b", wrap: true },
      ],
    },
    footer: {
      type: "box",
      layout: "vertical",
      paddingAll: "12px",
      contents: [
        {
          type: "button",
          style: "secondary",
          height: "sm",
          action: { type: "uri", label: "空き一覧を開く", uri: url },
        },
      ],
    },
  };
}

export function buildInviteShiftLineMessages(params: {
  storeName: string;
  query: InviteQuery;
  slotMinutes: number;
  slots: InviteSlot[];
  dateLabel: string;
  timeRangeLabel: string;
  intro?: string;
  altText?: string;
}): object[] {
  const minutes = params.slotMinutes;
  const intro =
    params.intro ??
    `お世話になっております！
Abodyです😊

${params.dateLabel} ${params.timeRangeLabel}に、追加の枠をご用意しました。

今回はご案内した方だけが予約できる枠です（予約サイトには出ていません）。
何コマとってもOKです。通える分だけお取りください。
${minutes === 60 ? "今回は60分枠でのご案内です。\n" : ""}
下のカードを横にスライドして、希望の時間の「この枠で予約する」からお取りください。

先着順です。埋まっている時間は選べません。
ご不明点はお気軽にご連絡ください！`;

  const listUrl = inviteBookPageUrl(params.query);
  const cardSlots = params.slots.slice(0, 11);
  const bubbles: object[] = cardSlots.map((slot) =>
    slotBubble({
      storeName: params.storeName,
      slot,
      minutes,
      bookingUrl: inviteBookPageUrl(params.query, slot),
    })
  );
  bubbles.push(listBubble(listUrl));

  return [
    { type: "text", text: intro },
    {
      type: "flex",
      altText: params.altText ?? `${params.dateLabel} ${params.storeName}の追加枠（ご案内した方のみ）`,
      contents: { type: "carousel", contents: bubbles },
    },
  ];
}

async function linePushMessages(token: string, to: string, messages: object[]): Promise<{ ok: boolean; status: number; body: string }> {
  const res = await fetch("https://api.line.me/v2/bot/message/push", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ to, messages }),
  });
  const body = await res.text().catch(() => "");
  return { ok: res.ok, status: res.status, body };
}

export async function pushInviteShiftLine(params: {
  lineUserId: string;
  memberCode?: string | null;
  lineChannelKey?: string | null;
  storeName: string;
  messages: object[];
}): Promise<{ ok: boolean; status?: number; body?: string; error?: string }> {
  const line = linePushTokenForMember({
    lineChannelKey: normalizeLineChannelKey(params.lineChannelKey),
    memberCode: params.memberCode,
    fallbackStoreName: params.storeName,
  });
  const tried = new Set<string>();
  const tokens: Array<{ token: string; channelKey: LineChannelKey | null }> = [];
  if (line.token) tokens.push({ token: line.token, channelKey: line.channelKey });
  const storeKey = lineChannelKeyForStoreName(params.storeName);
  const storeToken = storeKey ? lineAccessTokenForChannelKey(storeKey) : null;
  if (storeToken) tokens.push({ token: storeToken, channelKey: storeKey });

  for (const { token } of tokens) {
    if (tried.has(token)) continue;
    tried.add(token);
    const reachable = await lineMemberProfileReachable(token, params.lineUserId);
    if (!reachable) continue;
    const sent = await linePushMessages(token, params.lineUserId, params.messages);
    if (sent.ok) return sent;
  }
  return { ok: false, error: "token_missing_or_unreachable" };
}

export async function findConfirmedShift(params: {
  supabase: SupabaseClient;
  storeName: string;
  trainerName: string;
  dateYmd: string;
  startLocal: string;
  endLocal: string;
}): Promise<{ shiftId: string; storeId: string; trainerId: string }> {
  const { supabase } = params;
  const [{ data: store, error: storeErr }, { data: trainer, error: trainerErr }] = await Promise.all([
    supabase.from("stores").select("id, name").eq("name", params.storeName).maybeSingle(),
    supabase.from("trainers").select("id, display_name").eq("display_name", params.trainerName).maybeSingle(),
  ]);
  if (storeErr || !store) throw new Error(storeErr?.message ?? "店舗が見つかりません");
  if (trainerErr || !trainer) throw new Error(trainerErr?.message ?? "トレーナーが見つかりません");

  const start = toHHMMSS(params.startLocal);
  const end = toHHMMSS(params.endLocal);
  const { data: existing, error: existErr } = await supabase
    .from("trainer_shifts")
    .select("id, status")
    .eq("trainer_id", trainer.id)
    .eq("store_id", store.id)
    .eq("shift_date", params.dateYmd)
    .eq("start_local", start)
    .eq("end_local", end)
    .maybeSingle();
  if (existErr) throw existErr;
  if (!existing?.id) throw new Error("対象シフトが見つかりません");
  return { shiftId: existing.id, storeId: store.id, trainerId: trainer.id };
}

export async function ensureInviteShift(params: {
  supabase: SupabaseClient;
  storeName: string;
  trainerName: string;
  dateYmd: string;
  startLocal: string;
  endLocal: string;
}): Promise<{ shiftId: string; storeId: string; trainerId: string; visibility: "invite" | "draft" }> {
  const { supabase } = params;
  const [{ data: store, error: storeErr }, { data: trainer, error: trainerErr }] = await Promise.all([
    supabase.from("stores").select("id, name").eq("name", params.storeName).maybeSingle(),
    supabase.from("trainers").select("id, display_name").eq("display_name", params.trainerName).maybeSingle(),
  ]);
  if (storeErr || !store) throw new Error(storeErr?.message ?? "店舗が見つかりません");
  if (trainerErr || !trainer) throw new Error(trainerErr?.message ?? "トレーナーが見つかりません");

  const start = toHHMMSS(params.startLocal);
  const end = toHHMMSS(params.endLocal);
  const { data: existing, error: existErr } = await supabase
    .from("trainer_shifts")
    .select("id, status")
    .eq("trainer_id", trainer.id)
    .eq("store_id", store.id)
    .eq("shift_date", params.dateYmd)
    .eq("start_local", start)
    .eq("end_local", end)
    .maybeSingle();
  if (existErr) throw existErr;

  const inviteUpdate = { status: "confirmed", booking_visibility: INVITE_VISIBILITY, is_break: false };
  const draftUpdate = { status: "draft", is_break: false };

  if (existing?.id) {
    const up = await supabase.from("trainer_shifts").update(inviteUpdate).eq("id", existing.id);
    if (up.error && isMissingBookingVisibilityColumn(up.error)) {
      const up2 = await supabase.from("trainer_shifts").update(draftUpdate).eq("id", existing.id);
      if (up2.error) throw up2.error;
      return { shiftId: existing.id, storeId: store.id, trainerId: trainer.id, visibility: "draft" };
    }
    if (up.error) throw up.error;
    return { shiftId: existing.id, storeId: store.id, trainerId: trainer.id, visibility: "invite" };
  }

  const inviteInsert = {
    trainer_id: trainer.id,
    store_id: store.id,
    shift_date: params.dateYmd,
    start_local: start,
    end_local: end,
    status: "confirmed",
    is_break: false,
    break_minutes: 0,
    booking_visibility: INVITE_VISIBILITY,
  };
  const first = await supabase.from("trainer_shifts").insert(inviteInsert).select("id").single();
  if (first.error && isMissingBookingVisibilityColumn(first.error)) {
    const { booking_visibility: _ignored, ...draftInsert } = inviteInsert;
    const second = await supabase
      .from("trainer_shifts")
      .insert({ ...draftInsert, status: "draft" })
      .select("id")
      .single();
    if (second.error || !second.data) throw new Error(second.error?.message ?? "シフトの作成に失敗しました");
    return { shiftId: second.data.id, storeId: store.id, trainerId: trainer.id, visibility: "draft" };
  }
  if (first.error || !first.data) throw new Error(first.error?.message ?? "シフトの作成に失敗しました");
  return { shiftId: first.data.id, storeId: store.id, trainerId: trainer.id, visibility: "invite" };
}
