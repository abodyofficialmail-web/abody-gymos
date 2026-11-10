import { DateTime } from "luxon";

const TZ = "Asia/Tokyo";

export const OPEN_SLOT_TASKS = [
  { key: "cleaning", label: "掃除", hint: "店内を掃除して報告します" },
  { key: "sns", label: "SNS撮影", hint: "投稿用の写真や動画を撮って報告します" },
  { key: "machine", label: "マシンメンテナンス", hint: "マシンの点検や調整をして報告します" },
  { key: "invite", label: "会員に予約案内", hint: "会員を選んで、この枠の案内をLINEで送ります" },
  { key: "extend", label: "会員のセッション延長", hint: "前後の会員予約を、この枠の分だけ延ばします" },
  { key: "supplies", label: "備品購入・ストック整理", hint: "備品の購入やストック整理をして報告します" },
  { key: "other", label: "その他", hint: "内容を書いて報告します" },
] as const;

export type OpenSlotTaskKey = (typeof OPEN_SLOT_TASKS)[number]["key"];

export function openSlotTaskByKey(key: string) {
  return OPEN_SLOT_TASKS.find((task) => task.key === key) ?? null;
}

const ADJACENT_TOLERANCE_MS = 60_000;

export function extendedReservationRange(
  reservation: { startMs: number; endMs: number },
  slot: { startMs: number; endMs: number }
): { startMs: number; endMs: number; direction: "after" | "before" } | null {
  if (Math.abs(reservation.endMs - slot.startMs) <= ADJACENT_TOLERANCE_MS) {
    return { startMs: reservation.startMs, endMs: slot.endMs, direction: "after" };
  }
  if (Math.abs(reservation.startMs - slot.endMs) <= ADJACENT_TOLERANCE_MS) {
    return { startMs: slot.startMs, endMs: reservation.endMs, direction: "before" };
  }
  return null;
}

export function buildOpenSlotTaskReportText(input: {
  storeName: string;
  startAt: string;
  endAt: string;
  taskLabel: string;
  operatorName: string;
  detail?: string | null;
  memberLabel?: string | null;
}): string {
  const start = DateTime.fromISO(input.startAt).setZone(TZ);
  const end = DateTime.fromISO(input.endAt).setZone(TZ);
  const when = start.isValid
    ? `${start.setLocale("ja").toFormat("M/d（ccc）")} ${start.toFormat("HH:mm")}〜${end.isValid ? end.toFormat("HH:mm") : ""}`
    : "";
  const lines = [
    "【空き枠タスク報告】",
    `店舗: ${input.storeName || "店舗"}`,
    `日時: ${when}`,
    `タスク: ${input.taskLabel}`,
    `担当: ${input.operatorName || "トレーナー"}`,
  ];
  const member = String(input.memberLabel ?? "").trim();
  if (member) lines.push(`会員: ${member}`);
  const detail = String(input.detail ?? "").trim();
  if (detail) lines.push("", detail);
  return lines.join("\n");
}

export function buildMemberInviteText(input: {
  storeName: string;
  startAt: string;
  endAt: string;
  bookingUrl: string;
}): string {
  const start = DateTime.fromISO(input.startAt).setZone(TZ);
  const end = DateTime.fromISO(input.endAt).setZone(TZ);
  const dateLabel = start.isValid ? start.setLocale("ja").toFormat("M月d日（ccc）") : "";
  const timeLabel =
    start.isValid && end.isValid ? `${start.toFormat("HH:mm")}〜${end.toFormat("HH:mm")}` : "";
  return `お世話になっております。
Abodyです。

本日${dateLabel}、${input.storeName}店に空きがあります。
${timeLabel}

予約サイトからお取りください。
${input.bookingUrl}

先着順です。`.trim();
}

export function buildSessionExtendText(input: {
  storeName: string;
  startAt: string;
  endAt: string;
  operatorName: string;
}): string {
  const start = DateTime.fromISO(input.startAt).setZone(TZ);
  const end = DateTime.fromISO(input.endAt).setZone(TZ);
  const formattedDate = start.isValid ? start.setLocale("ja").toFormat("M月d日（ccc）") : "";
  const formattedTime =
    start.isValid && end.isValid ? `${start.toFormat("HH:mm")}〜${end.toFormat("HH:mm")}` : "";
  const operator = input.operatorName ? `\n操作：担当トレーナー（${input.operatorName}）` : "";
  return `【セッション延長】
店舗：${input.storeName}
日時：${formattedDate} ${formattedTime}
ご予約を空き枠の分だけ延長しました。${operator}

よろしくお願いいたします。`.trim();
}
