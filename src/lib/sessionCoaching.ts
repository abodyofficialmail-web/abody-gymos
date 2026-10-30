import { isLowBookingMotivationNeed, MONTHLY_SESSION_TARGET } from "./lowBookingMotivation";

export type CoachingNote = {
  id: string;
  date: string;
  trainerName: string;
  storeName: string;
  content: string;
  createdAt?: string;
};

export type CoachingCaution = {
  source: string;
  body: string;
};

export type CoachingSession = {
  noteId: string;
  date: string;
  trainerName: string;
  storeName: string;
  cautions: CoachingCaution[];
};

export type CoachingActionKey = "ticket" | "next_booking" | "proposal" | "motivation";

export type CoachingAction = {
  key: CoachingActionKey;
  label: string;
  detail: string;
};

const CAUTION_PATTERN =
  /注意|気をつけ|痛|違和感|膝|腰|避け|禁止|内旋|反り|丸ま|崩れ|不調|既往|持病|無理|中止/;

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

function looksLikeCaution(text: string): boolean {
  return CAUTION_PATTERN.test(text);
}

function isMeaningfulPain(text: string): boolean {
  const value = text.trim();
  if (!value || value === "-" || value === "なし" || value === "無し") return false;
  return true;
}

export function collectCoachingSessions(notes: CoachingNote[]): CoachingSession[] {
  const sessions: CoachingSession[] = [];
  for (const note of notes) {
    const content = String(note.content ?? "");
    const pain = sectionBody(content, "痛みや違和感");
    const talk = sectionBody(content, "会員とのコミュニケーション内容");
    const feedback = sectionBody(content, "トレーナーからのフィードバック");
    const handoff = sectionBody(content, "トレーナー記入欄");
    const painOn = isMeaningfulPain(pain);
    const feedbackOn = looksLikeCaution(feedback);
    const talkOn = Boolean(talk) && (painOn || feedbackOn || looksLikeCaution(talk));
    const cautions: CoachingCaution[] = [];
    if (painOn) cautions.push({ source: "痛みや違和感", body: pain });
    if (feedbackOn) cautions.push({ source: "トレーナー記録", body: feedback });
    if (talkOn) cautions.push({ source: "会員との会話", body: talk });
    if (handoff) cautions.push({ source: "入会時の引き継ぎ", body: handoff });
    if (cautions.length === 0) continue;
    sessions.push({
      noteId: note.id,
      date: note.date,
      trainerName: note.trainerName.trim() || "担当不明",
      storeName: note.storeName.trim(),
      cautions,
    });
  }
  sessions.sort((a, b) => {
    const byDate = b.date.localeCompare(a.date);
    if (byDate !== 0) return byDate;
    return b.noteId.localeCompare(a.noteId);
  });
  return sessions.slice(0, 8);
}

export function coachingActionsForCount(count: number): CoachingAction[] {
  if (!isLowBookingMotivationNeed(count)) return [];
  return COACHING_ACTIONS;
}
