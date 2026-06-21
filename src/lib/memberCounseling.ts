import { buildKarteSessionContent, type KarteSessionState } from "@/lib/karteSession";

export const BODY_MAKE_PRIORITY_OPTIONS = [
  "ダイエット",
  "筋肉をつけたい",
  "姿勢・機能改善",
  "体力アップ",
  "習慣化",
] as const;

export const BODY_MAKE_CHALLENGE_OPTIONS = [
  "間食・甘いものが多い",
  "お酒めっちゃ飲む",
  "外食が多い",
  "夜遅い食事",
  "睡眠不足",
  "運動を習慣にできない",
  "ストレスで食べてしまう",
  "何を食べていいのかわからない",
  "痛み・不安がある（腰/膝/肩など）",
  "仕事が忙しくてトレーニングできない",
] as const;

export const MEMBER_HOBBY_OPTIONS = [
  "スポーツ",
  "ランニング",
  "ゴルフ",
  "読書",
  "旅行",
  "料理",
  "映画・ドラマ",
  "ゲーム",
  "音楽",
  "アウトドア",
  "カフェ",
  "その他",
] as const;

export const MEMBER_OCCUPATION_OPTIONS = [
  "会社員（デスクワーク）",
  "会社員（外勤・立ち仕事）",
  "自営業",
  "経営者",
  "医療・福祉",
  "学生",
  "主婦・主夫",
  "パート・アルバイト",
  "その他",
] as const;

export const MEMBER_DAY_OFF_OPTIONS = ["平日", "土日", "不定休", "シフト制"] as const;

/** 身長（cm）130.0〜210.0 / 0.5刻み */
export function createHeightCmOptions(): string[] {
  const out: string[] = [];
  for (let h = 130; h <= 210; h += 0.5) {
    out.push(h % 1 === 0 ? String(h) : h.toFixed(1));
  }
  return out;
}

/** 体重（kg）0〜200 / 0.5刻み */
export function createCounselingWeightKgOptions(): string[] {
  const out: string[] = [];
  for (let w = 0; w <= 200; w += 0.5) {
    out.push(w % 1 === 0 ? String(w) : w.toFixed(1));
  }
  return out;
}

/** 体脂肪率（%）3〜50 / 0.5刻み */
export function createBodyFatPctOptions(): string[] {
  const out: string[] = [];
  for (let p = 3; p <= 50; p += 0.5) {
    out.push(p % 1 === 0 ? String(p) : p.toFixed(1));
  }
  return out;
}

export type CounselingFormState = {
  trainingGoals2026: string;
  bodyMakePriority1: string;
  bodyMakePriority2: string;
  bodyMakePriority3: string;
  heightCm: string;
  weightKg: string;
  bodyFatPct: string;
  numericGoals: string;
  painAndRestrictions: string;
  bodyMakeChallenges: string[];
  futureEvents2026: string;
  hobbies: string[];
  occupations: string[];
  daysOff: string[];
  trainerNotes: string;
};

export function createEmptyCounselingFormState(): CounselingFormState {
  return {
    trainingGoals2026: "",
    bodyMakePriority1: "",
    bodyMakePriority2: "",
    bodyMakePriority3: "",
    heightCm: "",
    weightKg: "",
    bodyFatPct: "",
    numericGoals: "",
    painAndRestrictions: "",
    bodyMakeChallenges: [],
    futureEvents2026: "",
    hobbies: [],
    occupations: [],
    daysOff: [],
    trainerNotes: "",
  };
}

function listSection(title: string, items: string[]): string[] {
  if (!items.length) return [];
  return ["", title, ...items.map((x) => `・${x}`)];
}

export function buildCounselingContent(state: CounselingFormState): string {
  const lines: string[] = ["【カウンセリング内容】"];

  lines.push("");
  lines.push("【2026年トレーニング目標】");
  lines.push(state.trainingGoals2026.trim() || "-");

  lines.push("");
  lines.push("【ボディメイクの優先順位】");
  lines.push(`1番: ${state.bodyMakePriority1 || "-"}`);
  lines.push(`2番: ${state.bodyMakePriority2 || "-"}`);
  lines.push(`3番: ${state.bodyMakePriority3 || "-"}`);

  lines.push("");
  lines.push("【身体データ】");
  lines.push(`身長(cm): ${state.heightCm.trim() || "-"}`);
  lines.push(`体重(kg): ${state.weightKg.trim() || "-"}`);
  lines.push(`体脂肪率(%): ${state.bodyFatPct.trim() || "-"}`);

  lines.push("");
  lines.push("【数値目標】");
  lines.push(state.numericGoals.trim() || "-");

  lines.push("");
  lines.push("【痛み・不安・禁止動作】");
  lines.push(state.painAndRestrictions.trim() || "-");

  lines.push(...listSection("【ボディメイクする上で大変なこと】", state.bodyMakeChallenges));

  lines.push("");
  lines.push("【2026年のイベント・期限目標】");
  lines.push(state.futureEvents2026.trim() || "-");

  lines.push(...listSection("【趣味】", state.hobbies));
  lines.push(...listSection("【職業】", state.occupations));
  lines.push(...listSection("【休みの日】", state.daysOff));

  lines.push("");
  lines.push("【トレーナー記入欄】");
  lines.push(state.trainerNotes.trim() || "-");

  return lines.join("\n");
}

export function buildOnboardingKarteContent(params: {
  counseling: CounselingFormState;
  trialSession: KarteSessionState;
  member: { member_code?: string | null; name?: string | null; id?: string | null };
}): string {
  return [
    "【入会時カルテ】",
    buildCounselingContent(params.counseling),
    "",
    buildKarteSessionContent(params.trialSession, params.member, {
      sectionTitle: "【体験時のセッション内容】",
      includeBasicInfo: false,
    }),
  ].join("\n");
}
