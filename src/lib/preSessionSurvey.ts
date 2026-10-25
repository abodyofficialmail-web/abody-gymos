export const PRE_SESSION_MEAL_OPTIONS = [
  { id: "eaten" as const, label: "食べた" },
  { id: "not_eaten" as const, label: "食べていない" },
  { id: "light_only" as const, label: "軽くだけ" },
];

export const PRE_SESSION_INTENSITY_OPTIONS = [
  { id: "light" as const, label: "軽め" },
  { id: "moderate" as const, label: "ちょうどいい" },
  { id: "hard" as const, label: "しっかり追い込みたい" },
];

/** セッション内容の希望。未選択（null）を許す */
export const PRE_SESSION_FORMAT_OPTIONS = [
  { id: "training" as const, label: "トレーニング", badge: "トレーニング" },
  { id: "stretch" as const, label: "ストレッチ", badge: "ストレッチ" },
  { id: "both" as const, label: "どっちも", badge: "トレーニング・ストレッチ" },
];

/** 今日の希望部位。カルテのトレーニング部位に、ストレッチで多い腰を足す */
export const PRE_SESSION_FOCUS_OPTIONS = [
  { id: "脚", label: "脚" },
  { id: "背中", label: "背中" },
  { id: "胸", label: "胸" },
  { id: "肩", label: "肩" },
  { id: "腕", label: "腕" },
  { id: "腹筋", label: "腹筋" },
  { id: "腰", label: "腰" },
] as const;

export type PreSessionMealId = (typeof PRE_SESSION_MEAL_OPTIONS)[number]["id"];
export type PreSessionIntensityId = (typeof PRE_SESSION_INTENSITY_OPTIONS)[number]["id"];
export type PreSessionFormatId = (typeof PRE_SESSION_FORMAT_OPTIONS)[number]["id"];
export type PreSessionFocusId = (typeof PRE_SESSION_FOCUS_OPTIONS)[number]["id"];

export function formatPreSessionFocusParts(ids: readonly string[]): string | null {
  const selected = new Set(ids);
  const ordered = PRE_SESSION_FOCUS_OPTIONS.filter((option) => selected.has(option.id)).map((option) => option.label);
  return ordered.length ? ordered.join(" / ") : null;
}

/** LINE Flex ボタン・送信ボタン共通 */
export const PRE_SESSION_ACCENT_COLOR = "#2563eb";
