export type MenuSet = { reps: string; weight: string };
export type MenuItem = { id: string; exercise: string; sets: MenuSet[]; isCustom?: boolean };

export type KarteSessionState = {
  bodyWeightKg: string;
  bodyFatPct: string;
  condition: string;
  trainingParts: string[];
  menuItems: MenuItem[];
  stretch: string;
  stretchDetail: string;
  trainingConcept: string;
  goodPoint: string;
  improvePoint: string;
  painLevel: string;
  communication: string;
};

export const KARTE_TRAINING_PARTS = [
  { id: "脚", label: "脚" },
  { id: "背中", label: "背中" },
  { id: "胸", label: "胸" },
  { id: "肩", label: "肩" },
  { id: "腕", label: "腕" },
  { id: "腹筋", label: "腹筋" },
  { id: "ピラティス", label: "ピラティス" },
  { id: "有酸素", label: "有酸素" },
] as const;

export const KARTE_EXERCISE_CATALOG: Record<string, string[]> = {
  胸: [
    "ベンチプレス",
    "インクラインベンチプレス",
    "インクラインダンベルプレス",
    "ダンベルベンチプレス",
    "ダンベルフライ",
    "インクラインダンベルフライ",
    "ケーブルフライ",
    "チェストプレス",
    "プッシュアップ",
    "その他",
  ],
  肩: [
    "ショルダープレス",
    "ダンベルショルダープレス",
    "アーノルドプレス",
    "サイドレイズ",
    "フロントレイズ",
    "リアレイズ",
    "ケーブルサイドレイズ",
    "アップライトロウ",
    "シュラッグ",
    "フェイスプル",
    "その他",
  ],
  背中: [
    "ラットプルダウン",
    "ラットプルダウン（ナローグリップ）",
    "シーテッドロー",
    "ワンハンドロー",
    "ベントオーバーロウ",
    "プルオーバー",
    "懸垂",
    "デッドリフト",
    "その他",
  ],
  腕: [
    "アームカール",
    "インクラインアームカール",
    "ハンマーカール",
    "ケーブルカール",
    "トライセプスプレスダウン",
    "フレンチプレス",
    "キックバック",
    "その他",
  ],
  脚: [
    "スクワット",
    "フロントスクワット",
    "ブルガリアンスクワット",
    "ワイドスクワット",
    "ゴブレットスクワット",
    "ランジ",
    "レッグプレス",
    "レッグエクステンション",
    "レッグカール",
    "ルーマニアンデッドリフト",
    "ヒップスラスト",
    "ヒップリフト",
    "ドンキーキック",
    "クラムシェル",
    "レッグアダクション",
    "レッグアブダクション",
    "カーフレイズ",
    "その他",
  ],
  腹筋: ["クランチ", "レッグレイズ", "プランク", "サイドプランク", "デッドバグ", "ドローイン", "ケーブルクランチ", "その他"],
  ピラティス: ["デッドバグ", "ドローイン", "サイドプランク", "ヒップリフト", "ドンキーキック", "クラムシェル", "その他"],
  有酸素: ["バイク", "ラン", "ウォーク", "ローイング", "その他"],
};

export function createEmptyKarteSessionState(): KarteSessionState {
  return {
    bodyWeightKg: "",
    bodyFatPct: "",
    condition: "",
    trainingParts: [],
    menuItems: [],
    stretch: "あり",
    stretchDetail: "",
    trainingConcept: "",
    goodPoint: "",
    improvePoint: "",
    painLevel: "なし",
    communication: "",
  };
}

export function createKarteRepOptions(): string[] {
  return Array.from({ length: 30 }, (_, i) => String(i + 1));
}

/** プランク系の秒数選択肢（1〜180秒） */
export function createKarteSecondOptions(): string[] {
  return Array.from({ length: 180 }, (_, i) => String(i + 1));
}

export function createKarteWeightOptions(): string[] {
  const out: string[] = [];
  for (let w = 0; w <= 200; w += 0.5) out.push(w % 1 === 0 ? String(w) : w.toFixed(1));
  return out;
}

/** プランク／サイドプランクは秒数で記録する */
export function isKarteDurationExercise(exercise: string): boolean {
  return exercise.includes("プランク");
}

export function formatKarteExerciseName(item: Pick<MenuItem, "exercise" | "isCustom">): string {
  const name = item.exercise.trim();
  if (item.isCustom) return name || "その他";
  return name || "-";
}

export function formatKarteSetLine(exercise: string, s: MenuSet): string {
  const unit = isKarteDurationExercise(exercise) ? "秒" : "回";
  const reps = s.reps.trim() ? `${s.reps.trim()}${unit}` : "";
  const w = s.weight.trim() ? `${s.weight.trim()}kg` : "";
  return [w, reps].filter(Boolean).join("×") || "-";
}

export function buildKarteSessionContent(
  state: KarteSessionState,
  member: { member_code?: string | null; name?: string | null; id?: string | null },
  options?: { sectionTitle?: string; includeBasicInfo?: boolean }
): string {
  const sectionTitle = options?.sectionTitle ?? "【体験時のセッション内容】";
  const includeBasicInfo = options?.includeBasicInfo ?? true;
  const lines: string[] = [sectionTitle];

  if (includeBasicInfo) {
    lines.push("");
    lines.push("【基本情報】");
    lines.push(`会員ID: ${member.member_code || member.id || "-"}`);
    if (member.name) lines.push(`会員名: ${member.name}`);
  }

  if (state.bodyWeightKg.trim() || state.bodyFatPct.trim()) {
    lines.push("");
    lines.push("【体組成】");
    if (state.bodyWeightKg.trim()) lines.push(`体重(kg): ${state.bodyWeightKg.trim()}`);
    if (state.bodyFatPct.trim()) lines.push(`体脂肪率(%): ${state.bodyFatPct.trim()}`);
  }
  if (state.condition.trim()) {
    lines.push("");
    lines.push("【今日の体調】");
    lines.push(state.condition.trim());
  }
  lines.push("");
  lines.push("【本日のトレーニング内容】");
  lines.push(`部位: ${state.trainingParts.length ? state.trainingParts.join(" / ") : "-"}`);
  lines.push("");
  lines.push("【本日のメニュー】");
  if (state.menuItems.length === 0) {
    lines.push("-");
  } else {
    for (const item of state.menuItems) {
      const exerciseName = formatKarteExerciseName(item);
      lines.push(`■ ${exerciseName}`);
      const sets = item.sets.filter((s) => s.reps.trim() || s.weight.trim());
      if (sets.length === 0) {
        lines.push("  -");
      } else {
        for (const s of sets) {
          lines.push(`  ${formatKarteSetLine(exerciseName, s)}`);
        }
      }
    }
  }
  lines.push("");
  lines.push("【ストレッチ】");
  lines.push(state.stretch);
  if (state.stretchDetail.trim()) lines.push(`ストレッチ内容: ${state.stretchDetail.trim()}`);
  if (state.trainingConcept.trim()) {
    lines.push("");
    lines.push("【トレーニングコンセプト】");
    lines.push(state.trainingConcept.trim());
  }
  lines.push("");
  lines.push("【トレーナーからのフィードバック】");
  if (state.goodPoint.trim()) lines.push(state.goodPoint.trim());
  if (state.improvePoint.trim()) lines.push(state.improvePoint.trim());
  lines.push("");
  lines.push("【痛みや違和感】");
  lines.push(state.painLevel);
  if (state.communication.trim()) {
    lines.push("");
    lines.push("【会員とのコミュニケーション内容】");
    lines.push(state.communication.trim());
  }
  return lines.join("\n");
}
