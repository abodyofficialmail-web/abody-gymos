import { DateTime } from "luxon";

const TZ = "Asia/Tokyo";

function sessionHasStarted(nowIso: string, startAtIso: string): boolean {
  const now = DateTime.fromISO(nowIso).setZone(TZ);
  const start = DateTime.fromISO(startAtIso).setZone(TZ);
  if (!now.isValid || !start.isValid) return false;
  return now.toMillis() >= start.toMillis();
}

function appendReservationNote(notes: string | null | undefined, token: string): string {
  const base = String(notes ?? "").trim();
  if (base.includes(token)) return base;
  return base ? `${base} ${token}` : token;
}

/** 有料の当日枠と振替は、月の回数を消費しない。 */
function skipsQuota(notes: string | null | undefined): boolean {
  const text = String(notes ?? "");
  const fee = text.match(/same_day_fee_yen=(\d+)/);
  const swap = text.match(/same_day_swap_of=([0-9a-f-]{36})/i);
  return (fee ? Number(fee[1]) : 0) > 0 || Boolean(swap?.[1]);
}

/** client_notes.note_kind。通常のカルテ送信とは別。 */
export const CONSUMED_CANCEL_KIND = "consumed_cancel";

export type ConsumedCancelReason = "no_show" | "same_day";

export function isSessionOnLocalDate(startAtIso: string, nowIso: string, zone = TZ): boolean {
  const start = DateTime.fromISO(startAtIso).setZone(zone);
  const now = DateTime.fromISO(nowIso).setZone(zone);
  if (!start.isValid || !now.isValid) return false;
  return start.toISODate() === now.toISODate();
}

/** 未来の予約はキャンセルできる。当日は開始後（未来店）もキャンセルできる。昨日以前の開始済みはできない。 */
export function staffCanCancelReservation(startAtIso: string, nowIso: string, zone = TZ): boolean {
  const start = DateTime.fromISO(startAtIso).setZone(zone);
  const now = DateTime.fromISO(nowIso).setZone(zone);
  if (!start.isValid || !now.isValid) return false;
  if (start.toMillis() > now.toMillis()) return true;
  return start.toISODate() === now.toISODate();
}

export function consumedCancelContent(params: {
  startAtIso: string;
  endAtIso: string;
  reason: ConsumedCancelReason;
}): string {
  const start = DateTime.fromISO(params.startAtIso).setZone(TZ);
  const end = DateTime.fromISO(params.endAtIso).setZone(TZ);
  const time = start.isValid && end.isValid ? `${start.toFormat("HH:mm")}〜${end.toFormat("HH:mm")}` : "";
  const why = params.reason === "no_show" ? "未来店" : "当日キャンセル";
  return [
    "【予約消化】",
    `${why}のため、この予約は消化として記録しました。`,
    time ? `時間：${time}` : "",
    "カルテ送信カウントには含めていません。",
  ]
    .filter(Boolean)
    .join("\n");
}

export function isConsumedCancelNote(note: { note_kind?: string | null; content?: string | null }): boolean {
  if (String(note.note_kind ?? "") === CONSUMED_CANCEL_KIND) return true;
  return String(note.content ?? "").includes("【予約消化】");
}

/** 予約メモの印。送信率の対象外として日報に出す。 */
export function consumedCancelLabelFromNotes(notes: string | null | undefined): string | null {
  const text = String(notes ?? "");
  if (/karte_consumed_cancel=no_show/.test(text)) return "未来店";
  if (/karte_consumed_cancel=same_day/.test(text)) return "当日キャンセル";
  return null;
}

export type StaffCancelPlan = {
  sameDay: boolean;
  reason: ConsumedCancelReason | null;
  consumeQuota: boolean;
  notes: string | null;
  karte: { date: string; content: string } | null;
};

export function consumedCancelReasonFromNotes(notes: string | null | undefined): ConsumedCancelReason | null {
  const text = String(notes ?? "");
  if (/karte_consumed_cancel=no_show/.test(text) || /same_day_cancel=no_show/.test(text)) return "no_show";
  if (/karte_consumed_cancel=same_day/.test(text)) return "same_day";
  return null;
}

/** スタッフが当日予約をキャンセルしたときの消化記録。会員の予約だけカルテに残す。 */
export function buildStaffSameDayCancel(params: {
  nowIso: string;
  startAt: string;
  endAt: string;
  memberId: string | null;
  notes: string | null;
  /** スタッフが選んだ区分。未指定なら開始前は当日キャンセル、開始後は未来店。 */
  reason?: ConsumedCancelReason | null;
}): StaffCancelPlan {
  const sameDay = isSessionOnLocalDate(params.startAt, params.nowIso);
  if (!sameDay || !params.memberId) {
    return { sameDay, reason: null, consumeQuota: false, notes: null, karte: null };
  }
  const reason: ConsumedCancelReason =
    params.reason ?? (sessionHasStarted(params.nowIso, params.startAt) ? "no_show" : "same_day");
  const consumeQuota = !skipsQuota(params.notes);
  let notes = appendReservationNote(params.notes, `karte_consumed_cancel=${reason}`);
  if (reason === "no_show") notes = appendReservationNote(notes, "same_day_cancel=no_show");
  const start = DateTime.fromISO(params.startAt).setZone(TZ);
  return {
    sameDay: true,
    reason,
    consumeQuota,
    notes,
    karte: {
      date: start.toISODate() ?? "",
      content: consumedCancelContent({ startAtIso: params.startAt, endAtIso: params.endAt, reason }),
    },
  };
}
