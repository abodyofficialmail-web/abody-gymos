import { estimateGoalHearingNutrition, formatNutritionLines } from "@/lib/goalHearingNutrition";

export const GOAL_HEARING_ACCENT = "#0f766e";

export const PRIMARY_GOAL_OPTIONS = [
  { id: "diet", label: "ダイエット・引き締め" },
  { id: "muscle", label: "筋肉をつけたい" },
  { id: "posture", label: "姿勢・機能改善" },
  { id: "stamina", label: "体力アップ" },
  { id: "habit", label: "運動習慣をつけたい" },
  { id: "other", label: "その他" },
] as const;

export const FOCUS_AREA_OPTIONS = [
  "お腹まわり",
  "二の腕",
  "背中",
  "肩・胸",
  "お尻",
  "脚",
  "姿勢",
  "全体的に引き締め",
  "全体的に筋量アップ",
] as const;

export const DEADLINE_OPTIONS = [
  { id: "3m", label: "3ヶ月以内" },
  { id: "6m", label: "6ヶ月以内" },
  { id: "1y", label: "1年以内" },
  { id: "date", label: "日付指定" },
  { id: "ongoing", label: "期限は決めず継続したい" },
] as const;

export const GOAL_REASON_OPTIONS = [
  { id: "looks", label: "見た目を変えたい" },
  { id: "event", label: "結婚式・旅行・イベントがある" },
  { id: "health", label: "健康のため" },
  { id: "confidence", label: "自信をつけたい" },
  { id: "clothes", label: "服をきれいに着たい" },
  { id: "other", label: "その他" },
] as const;

export const SEX_OPTIONS = [
  { id: "female", label: "女性" },
  { id: "male", label: "男性" },
] as const;

export const ACTIVITY_OPTIONS = [
  { id: "sedentary", label: "ほとんど座りがち" },
  { id: "light", label: "通勤・家事で少し動く" },
  { id: "standing", label: "仕事でよく歩く / 立つ" },
  { id: "physical", label: "体を使う仕事が多い" },
  { id: "active", label: "トレーニング以外でも運動している" },
] as const;

export const FREQUENCY_OPTIONS = [
  { id: "1", label: "週1回" },
  { id: "2", label: "週2回" },
  { id: "3", label: "週3回" },
  { id: "4plus", label: "週4回以上" },
  { id: "irregular", label: "まずは不定期でも続けたい" },
] as const;

/** 通いやすい時間（ボタン選択） */
export const PREFERRED_TIME_OPTIONS = [
  "平日の6時〜9時",
  "平日の9時〜12時",
  "平日の12時〜15時",
  "平日の15時〜18時",
  "平日の18時〜21時",
  "平日の19時〜22時",
  "土日の9時〜12時",
  "土日の12時〜15時",
  "土日の15時〜18時",
  "土日の18時〜21時",
  "不定",
] as const;

/** @deprecated 旧UI用。新規は PREFERRED_TIME_OPTIONS を使う */
export const HOUR_OPTIONS = [6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23] as const;

export function formatPreferredTimeRange(dayLabel: "平日" | "土日", fromHour: number, toHour: number): string {
  return `${dayLabel}の${fromHour}時〜${toHour}時`;
}

export const SLEEP_OPTIONS = [
  { id: "lt5", label: "5時間未満" },
  { id: "5to6", label: "5〜6時間" },
  { id: "6to7", label: "6〜7時間" },
  { id: "7plus", label: "7時間以上" },
  { id: "irregular", label: "不規則" },
] as const;

export const CHALLENGE_OPTIONS = [
  "間食・甘いものが多い",
  "お酒が多い",
  "外食が多い",
  "夜遅い食事",
  "睡眠不足",
  "運動を習慣にできない",
  "ストレスで食べてしまう",
  "何を食べていいかわからない",
  "仕事が忙しくて通えない",
  "特にない",
] as const;

export const MEAL_CHANGE_OPTIONS = [
  { id: "snack", label: "間食を減らす" },
  { id: "alcohol", label: "お酒を減らす" },
  { id: "protein", label: "たんぱく質を増やす" },
  { id: "late_night", label: "夜食をやめる" },
  { id: "unknown", label: "まだわからない" },
] as const;

export const PAIN_OPTIONS = [
  "ない",
  "腰",
  "膝",
  "肩",
  "首",
  "肘・手首",
  "股関節",
  "その他",
] as const;

export const TRAINING_STYLE_OPTIONS = [
  "トレーニングだけで進めたい",
  "筋膜リリースも取り入れたい",
  "ストレッチも取り入れたい",
  "ピラティスもいれたい",
  "その時のトレーナーに任せるでOK",
] as const;

export const WEIGHT_DIRECTION_OPTIONS = [
  { id: "lose", label: "減らしたい（ダイエット）" },
  { id: "gain", label: "増やしたい（増量）" },
  { id: "maintain", label: "維持したい" },
  { id: "looks", label: "見た目重視で体重はこだわらない" },
] as const;

export type GoalHearingFormPayload = {
  primary_goal: string;
  primary_goal_other?: string;
  secondary_goal?: string | null;
  tertiary_goal?: string | null;
  focus_areas: string[];
  weight_direction: string;
  current_weight_kg?: number | null;
  target_weight_kg?: number | null;
  current_body_fat_pct?: number | null;
  target_body_fat_pct?: number | null;
  current_waist_cm?: number | null;
  target_waist_cm?: number | null;
  numeric_goals_undecided?: boolean;
  deadline_type: string;
  deadline_date?: string | null;
  goal_reason?: string | null;
  goal_reason_other?: string | null;
  sex: "female" | "male";
  birth_date?: string | null;
  age_years?: number | null;
  height_cm: number;
  weight_unknown?: boolean;
  activity_level: string;
  ideal_frequency: string;
  /** 例: ["平日の10時〜14時", "土日の11時〜15時"] */
  preferred_slots?: string[];
  sleep_hours: string;
  challenges: string[];
  meal_change?: string | null;
  pain_areas: string[];
  training_styles?: string[];
  medical_restrictions?: string | null;
  free_comment?: string | null;
  goal_photo_paths: string[];
};

function labelOf<T extends { id: string; label: string }>(options: readonly T[], id: string | null | undefined): string {
  if (!id) return "-";
  return options.find((o) => o.id === id)?.label ?? id;
}

function list(title: string, items: string[]): string[] {
  if (!items.length) return [];
  return ["", title, ...items.map((x) => `・${x}`)];
}

export function buildGoalHearingKarteContent(params: {
  memberCode?: string | null;
  memberName?: string | null;
  answeredAtYmd: string;
  form: GoalHearingFormPayload;
  photoCount: number;
}): string {
  const f = params.form;
  const lines: string[] = [
    `【目標ヒアリング ${params.answeredAtYmd}】`,
    "",
    "【会員】",
    `会員番号: ${params.memberCode ?? "-"}`,
    `氏名: ${params.memberName ?? "-"}`,
    "",
    "【目標】",
    `1番目: ${labelOf(PRIMARY_GOAL_OPTIONS, f.primary_goal)}${f.primary_goal_other ? `（${f.primary_goal_other}）` : ""}`,
    `2番目: ${labelOf(PRIMARY_GOAL_OPTIONS, f.secondary_goal ?? "")}`,
    `3番目: ${labelOf(PRIMARY_GOAL_OPTIONS, f.tertiary_goal ?? "")}`,
    `変えたい部位: ${f.focus_areas.length ? f.focus_areas.join("、") : "-"}`,
    `体重の方向性: ${labelOf(WEIGHT_DIRECTION_OPTIONS, f.weight_direction)}`,
    `期限: ${labelOf(DEADLINE_OPTIONS, f.deadline_type)}${f.deadline_date ? `（${f.deadline_date}）` : ""}`,
    `理由: ${labelOf(GOAL_REASON_OPTIONS, f.goal_reason ?? "")}${f.goal_reason_other ? `（${f.goal_reason_other}）` : ""}`,
    "",
    "【数値】",
  ];

  lines.push(
    `体重: 今 ${f.weight_unknown ? "不明" : f.current_weight_kg ?? "-"} kg → 目標 ${f.target_weight_kg ?? "-"} kg`
  );
  lines.push(`体脂肪: 今 ${f.current_body_fat_pct ?? "-"} % → 目標 ${f.target_body_fat_pct ?? "-"} %`);
  lines.push(`ウエスト: 今 ${f.current_waist_cm ?? "-"} cm → 目標 ${f.target_waist_cm ?? "-"} cm`);

  const nutrition = estimateGoalHearingNutrition(f);
  if (nutrition) {
    lines.push("", "【栄養・カロリー目安】", ...formatNutritionLines(nutrition).slice(1));
  } else {
    lines.push("", "【栄養・カロリー目安】", "体重未入力のため省略");
  }

  lines.push(
    "",
    "【身体データ】",
    `性別: ${labelOf(SEX_OPTIONS, f.sex)}`,
    `年齢情報: ${f.birth_date ? `生年月日 ${f.birth_date}` : f.age_years != null ? `${f.age_years}歳` : "-"}`,
    `身長: ${f.height_cm} cm`,
    "",
    "【生活】",
    `活動量: ${labelOf(ACTIVITY_OPTIONS, f.activity_level)}`,
    `理想の頻度: ${labelOf(FREQUENCY_OPTIONS, f.ideal_frequency)}`,
    `通いやすい時間: ${(f.preferred_slots ?? []).length ? (f.preferred_slots ?? []).join("、") : "-"}`,
    `睡眠: ${labelOf(SLEEP_OPTIONS, f.sleep_hours)}`
  );

  lines.push(...list("【課題】", f.challenges));
  lines.push("", `食事で変えられそうなこと: ${labelOf(MEAL_CHANGE_OPTIONS, f.meal_change ?? "")}`);
  lines.push(...list("【痛み・不安】", f.pain_areas));
  lines.push(...list("【トレーニングの進め方希望】", f.training_styles ?? []));
  lines.push("", `持病・禁止事項: ${f.medical_restrictions?.trim() || "ない"}`);
  lines.push("", `【目標写真】${params.photoCount}枚提出済み`);
  lines.push("", "【ひとこと】", f.free_comment?.trim() || "-");

  return lines.join("\n");
}

/** 会員向け：回答内容の確認用LINE文面 */
export function buildGoalHearingLineSummary(params: {
  answeredAtYmd: string;
  form: GoalHearingFormPayload;
  photoCount: number;
}): string {
  const f = params.form;
  const lines: string[] = [
    `【目標ヒアリング 回答内容】`,
    `${params.answeredAtYmd} に受け付けました。内容のご確認です。`,
    "",
    "■ 目標",
    `1番目: ${labelOf(PRIMARY_GOAL_OPTIONS, f.primary_goal)}${f.primary_goal_other ? `（${f.primary_goal_other}）` : ""}`,
    `2番目: ${labelOf(PRIMARY_GOAL_OPTIONS, f.secondary_goal ?? "")}`,
    `3番目: ${labelOf(PRIMARY_GOAL_OPTIONS, f.tertiary_goal ?? "")}`,
    `変えたい部位: ${f.focus_areas.length ? f.focus_areas.join("、") : "-"}`,
    `体重の方向性: ${labelOf(WEIGHT_DIRECTION_OPTIONS, f.weight_direction)}`,
    `期限: ${labelOf(DEADLINE_OPTIONS, f.deadline_type)}${f.deadline_date ? `（${f.deadline_date}）` : ""}`,
    `理由: ${labelOf(GOAL_REASON_OPTIONS, f.goal_reason ?? "")}${f.goal_reason_other ? `（${f.goal_reason_other}）` : ""}`,
    "",
    "■ 数値",
    `体重: 今 ${f.weight_unknown ? "不明" : f.current_weight_kg ?? "-"} kg → 目標 ${f.target_weight_kg ?? "-"} kg`,
    `体脂肪: 今 ${f.current_body_fat_pct ?? "-"} % → 目標 ${f.target_body_fat_pct ?? "-"} %`,
    `ウエスト: 今 ${f.current_waist_cm ?? "-"} cm → 目標 ${f.target_waist_cm ?? "-"} cm`,
    "",
    "■ 身体・生活",
    `性別: ${labelOf(SEX_OPTIONS, f.sex)}`,
    `身長: ${f.height_cm} cm`,
    `活動量: ${labelOf(ACTIVITY_OPTIONS, f.activity_level)}`,
    `理想の頻度: ${labelOf(FREQUENCY_OPTIONS, f.ideal_frequency)}`,
    `通いやすい時間: ${(f.preferred_slots ?? []).length ? (f.preferred_slots ?? []).join("、") : "-"}`,
    `睡眠: ${labelOf(SLEEP_OPTIONS, f.sleep_hours)}`,
    "",
    "■ 課題・進め方",
    `大変なこと: ${f.challenges.length ? f.challenges.join("、") : "-"}`,
    `食事で変えられそうなこと: ${labelOf(MEAL_CHANGE_OPTIONS, f.meal_change ?? "")}`,
    `痛み・不安: ${f.pain_areas.length ? f.pain_areas.join("、") : "-"}`,
    `進め方希望: ${(f.training_styles ?? []).length ? (f.training_styles ?? []).join("、") : "-"}`,
    `持病・禁止事項: ${f.medical_restrictions?.trim() || "ない"}`,
    `目標写真: ${params.photoCount}枚`,
  ];

  const nutrition = estimateGoalHearingNutrition(f);
  if (nutrition) {
    lines.push("", ...formatNutritionLines(nutrition));
  } else {
    lines.push("", "■ 栄養・カロリー目安", "体重が未入力のため、計算を省略しています。");
  }

  if (f.free_comment?.trim()) {
    lines.push("", `ひとこと: ${f.free_comment.trim()}`);
  }

  lines.push("", "内容の修正がある場合は、店舗までご連絡ください。", "これから一緒に進めていきましょう！");
  return lines.join("\n");
}

export function goalHearingPhotoStoragePath(memberId: string, inviteOrTokenKey: string, index: number): string {
  return `${memberId}/goal-hearing/${inviteOrTokenKey}/${index}.jpg`;
}
