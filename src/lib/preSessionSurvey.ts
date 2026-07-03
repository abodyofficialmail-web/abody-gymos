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

export type PreSessionMealId = (typeof PRE_SESSION_MEAL_OPTIONS)[number]["id"];
export type PreSessionIntensityId = (typeof PRE_SESSION_INTENSITY_OPTIONS)[number]["id"];

/** LINE Flex ボタン・送信ボタン共通 */
export const PRE_SESSION_ACCENT_COLOR = "#2563eb";
