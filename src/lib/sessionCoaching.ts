import { DateTime } from "luxon";
import {
  isLowBookingMotivationNeed,
  MID_MONTH_LOW_BOOKING_MAX,
  MONTHLY_SESSION_TARGET,
} from "./lowBookingMotivation";

export type CoachingNote = {
  id: string;
  date: string;
  trainerName: string;
  storeName: string;
  content: string;
  createdAt?: string;
};

export type ImprovePoint = {
  noteId: string;
  date: string;
  trainerName: string;
  storeName: string;
  body: string;
};

export type ImproveSummaryItem = ImprovePoint & { times: number };

export type ImproveSummary = {
  summary: string;
  items: ImproveSummaryItem[];
};

export type CoachingActionKey = "ticket" | "next_booking" | "proposal" | "motivation";

export type CoachingAction = {
  key: CoachingActionKey;
  label: string;
  detail: string;
};

export const COACHING_ACTIONS: CoachingAction[] = [
  {
    key: "ticket",
    label: "チケットを付与する",
    detail: "今月の来店が少ないので、次の予約や先行案内に使えるチケットを足す。",
  },
  {
    key: "next_booking",
    label: "次の予約を取る",
    detail: "このセッションのあと、次回の日時をその場で押さえる。",
  },
  {
    key: "proposal",
    label: "通い方を提案する",
    detail: `空いている曜日と、今月あと何回来ると${MONTHLY_SESSION_TARGET}回に届くかを伝える。`,
  },
  {
    key: "motivation",
    label: "モチベーションを上げる",
    detail: "今月の回数と、続けている変化を言葉にして伝える。",
  },
];

function sectionBody(content: string, heading: string): string {
  const re = new RegExp(`【${heading}】\\n([\\s\\S]*?)(?=\\n【|$)`);
  return (content.match(re)?.[1] ?? "").trim();
}

const EMPTY_IMPROVE = /^(なし|無し|特になし|特に無し|ない|-|ー|−)$/u;
const PRAISE_LINE = /良くなった|良くなって|安定してきた|安定している|上手|綺麗|きれい|成長/;
const IMPROVE_HINT = /意識|寄せ|注意|次は|次回|改善|気をつけ|避け|浅|深|効かせ|重量|回数/;

function isMeaningfulImprove(text: string): boolean {
  const value = text.trim();
  if (!value || EMPTY_IMPROVE.test(value)) return false;
  return true;
}

function isPraiseOnly(line: string): boolean {
  return PRAISE_LINE.test(line) && !IMPROVE_HINT.test(line);
}

function improveBody(content: string): string {
  const labeled = sectionBody(content, "改善点");
  if (isMeaningfulImprove(labeled)) return labeled;
  const feedback = sectionBody(content, "トレーナーからのフィードバック");
  const lines = feedback
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => isMeaningfulImprove(line) && !isPraiseOnly(line));
  return lines.join("\n").trim();
}

export function collectImprovePoints(notes: CoachingNote[]): ImprovePoint[] {
  const points: ImprovePoint[] = [];
  for (const note of notes) {
    const body = improveBody(String(note.content ?? ""));
    if (!body) continue;
    points.push({
      noteId: note.id,
      date: note.date,
      trainerName: note.trainerName.trim() || "担当不明",
      storeName: note.storeName.trim(),
      body,
    });
  }
  points.sort((a, b) => {
    const byDate = b.date.localeCompare(a.date);
    if (byDate !== 0) return byDate;
    return b.noteId.localeCompare(a.noteId);
  });
  return points;
}

function firstLine(text: string): string {
  const line = text.split("\n").map((part) => part.trim()).find(Boolean) ?? "";
  return line.length > 42 ? `${line.slice(0, 42)}…` : line;
}

function sameImprove(a: string, b: string): boolean {
  return a.replace(/\s+/g, "") === b.replace(/\s+/g, "");
}

export function summarizeImprovePoints(points: ImprovePoint[]): ImproveSummary {
  const sorted = [...points].sort((a, b) => {
    const byDate = b.date.localeCompare(a.date);
    if (byDate !== 0) return byDate;
    return b.noteId.localeCompare(a.noteId);
  });
  const items: ImproveSummaryItem[] = [];
  for (const point of sorted) {
    const existing = items.find((item) => sameImprove(item.body, point.body));
    if (existing) {
      existing.times += 1;
      continue;
    }
    items.push({ ...point, times: 1 });
  }
  const shown = items.slice(0, 6);
  if (shown.length === 0) return { summary: "", items: [] };
  return {
    summary: `これまでの改善点は、${shown.map((item) => firstLine(item.body)).join("、")}です。`,
    items: shown,
  };
}

export function coachingActionsForCount(count: number): CoachingAction[] {
  if (!isLowBookingMotivationNeed(count)) return [];
  return COACHING_ACTIONS;
}

const TZ = "Asia/Tokyo";

/** 14日までは先月の予約数で見る。15日から今月。 */
export const COACHING_EARLY_MONTH_LAST_DAY = 14;

/** 入会直後・休会明けとして、来店回数とは別に見る日数。 */
export const COACHING_SETTLING_DAYS = 30;

export type CoachingFollowupKind = "low_booking" | "new_member" | "returned" | "hiatus" | "none";

export type CoachingFollowup = {
  kind: CoachingFollowupKind;
  title: string;
  detail: string;
  actions: CoachingAction[];
};

const NEW_MEMBER_ACTIONS: CoachingAction[] = [
  {
    key: "next_booking",
    label: "次の予約を取る",
    detail: "入会直後なので、次の日時をその場で押さえる。",
  },
  {
    key: "proposal",
    label: "通い方を提案する",
    detail: "空いている曜日と、最初の1ヶ月の通い方を伝える。",
  },
];

const RETURNED_ACTIONS: CoachingAction[] = [
  {
    key: "next_booking",
    label: "次の予約を取る",
    detail: "休会明けなので、復帰後の最初の日時をその場で押さえる。",
  },
  {
    key: "proposal",
    label: "通い方を提案する",
    detail: "空いている曜日と、復帰後の通い方を伝える。",
  },
];

const HIATUS_ACTIONS: CoachingAction[] = [
  {
    key: "next_booking",
    label: "次の予約を取る",
    detail: "休会中でも予約は取れる。復帰前後の日時を押さえる。",
  },
  {
    key: "proposal",
    label: "通い方を提案する",
    detail: "復帰後に、どの曜日で通うかを伝える。",
  },
];

function tokyoYmd(value: string | null | undefined): string | null {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) return null;
  if (/^\d{4}-\d{2}-\d{2}$/u.test(trimmed)) return trimmed;
  const dt = DateTime.fromISO(trimmed, { setZone: true }).setZone(TZ);
  if (!dt.isValid) return null;
  return dt.toISODate();
}

function daysAfter(fromYmd: string, toYmd: string): number | null {
  const from = DateTime.fromISO(fromYmd, { zone: TZ }).startOf("day");
  const to = DateTime.fromISO(toYmd, { zone: TZ }).startOf("day");
  if (!from.isValid || !to.isValid) return null;
  return Math.round(to.diff(from, "days").days);
}

function withinSettlingDays(fromYmd: string | null, todayYmd: string): boolean {
  if (!fromYmd) return false;
  const days = daysAfter(fromYmd, todayYmd);
  return days != null && days >= 0 && days <= COACHING_SETTLING_DAYS;
}

export function resolveCoachingFollowup(input: {
  todayYmd: string;
  thisMonthCount: number;
  lastMonthCount: number;
  joinedAt?: string | null;
  membershipStatus?: string | null;
  hiatusEndAt?: string | null;
}): CoachingFollowup {
  const today = tokyoYmd(input.todayYmd) ?? input.todayYmd;
  const day = DateTime.fromISO(today, { zone: TZ }).day;
  const earlyMonth = Number.isFinite(day) && day <= COACHING_EARLY_MONTH_LAST_DAY;
  const status = String(input.membershipStatus ?? "active");
  const joined = tokyoYmd(input.joinedAt);
  const hiatusEnd = tokyoYmd(input.hiatusEndAt);
  const daysSinceHiatusEnd = hiatusEnd ? daysAfter(hiatusEnd, today) : null;
  const stillOnHiatus =
    status === "hiatus" && (daysSinceHiatusEnd == null || daysSinceHiatusEnd <= 0);
  const justReturned =
    hiatusEnd != null &&
    daysSinceHiatusEnd != null &&
    daysSinceHiatusEnd >= 0 &&
    daysSinceHiatusEnd <= COACHING_SETTLING_DAYS &&
    !stillOnHiatus;

  if (status === "withdrawn") {
    return {
      kind: "none",
      title: "",
      detail: "退会しているので、来店回数の実施チェックは出しません。",
      actions: [],
    };
  }

  if (stillOnHiatus) {
    return {
      kind: "hiatus",
      title: "休会中の提案",
      detail: "休会中なので、来店回数では判断しません。復帰に向けた予約と通い方を出しています。",
      actions: HIATUS_ACTIONS,
    };
  }

  if (justReturned) {
    return {
      kind: "returned",
      title: "休会明けの提案",
      detail: `休会終了から${COACHING_SETTLING_DAYS}日以内です。来店回数では判断せず、復帰後の予約と通い方を出しています。`,
      actions: RETURNED_ACTIONS,
    };
  }

  if (withinSettlingDays(joined, today)) {
    return {
      kind: "new_member",
      title: "入会直後の提案",
      detail: `入会から${COACHING_SETTLING_DAYS}日以内です。来店が少ない人向けのチケット付与やモチベーションは出さず、次の予約と通い方を出しています。`,
      actions: NEW_MEMBER_ACTIONS,
    };
  }

  const count = earlyMonth ? input.lastMonthCount : input.thisMonthCount;
  const when = earlyMonth ? "先月" : "今月";
  if (!isLowBookingMotivationNeed(count)) {
    const basis = earlyMonth
      ? `月初なので、${when}の予約${count}回で見ています。`
      : `${when}の予約は${count}回です。`;
    return {
      kind: "none",
      title: "",
      detail: `${basis}チケット付与や次の予約などの実施チェックは、${MID_MONTH_LOW_BOOKING_MAX}回以下のときに出ます。`,
      actions: [],
    };
  }

  return {
    kind: "low_booking",
    title: "来店が少ない人への提案",
    detail: earlyMonth
      ? `月初なので、${when}の予約${count}回で見ています。目標は${MONTHLY_SESSION_TARGET}回です。実施したらチェックすると、誰がいつやったかが残ります。`
      : `${when}の予約は${count}回です。目標は${MONTHLY_SESSION_TARGET}回です。実施したらチェックすると、誰がいつやったかが残ります。`,
    actions: COACHING_ACTIONS,
  };
}
