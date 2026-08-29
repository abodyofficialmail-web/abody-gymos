export type WeightPredictSex = "female" | "male" | null;

export type WeightPredictInput = {
  exercise: string;
  firstMax: number;
  monthMax: number;
  prevMonthMax: number | null;
  /** 古い順の月次マックス（最大6ヶ月分など） */
  monthlyMaxes: number[];
  setsThisMonth: number;
  sex: WeightPredictSex;
  bodyWeightKg: number | null;
  heightCm?: number | null;
  ageYears?: number | null;
};

export type WeightPredictResult = {
  nextTarget: number;
  nextDelta: number;
  nextGrowthPct: number;
  reason: string;
};

type LiftClass = "compound_lower" | "compound_upper" | "isolation" | "bodyweight_ish" | "other";

function classifyLift(exercise: string): LiftClass {
  const n = exercise;
  if (/懸垂|チンニング|ディップス|プッシュアップ|プランク|腹筋|クランチ/.test(n)) return "bodyweight_ish";
  if (/スクワット|デッドリフト|レッグプレス|ブルガリア|ランジ|ヒップスラスト|ルーマニアン|グッドモーニング/.test(n)) {
    return "compound_lower";
  }
  if (
    /ベンチ|プレス|ロウ|ローイング|ラット|プルダウン|ショルダー|デッド|ベントオーバー|チェストプレス|スミスマシン/.test(n)
  ) {
    return "compound_upper";
  }
  if (/レイズ|カール|エクステンション|フライ|プッシュダウン|キックバック|アブダクション|アダクション/.test(n)) {
    return "isolation";
  }
  return "other";
}

/** プレート刻みに丸める（0.5 / 1.25 を優先） */
export function roundLoadKg(kg: number, exerciseOrClass: string = "other"): number {
  if (!Number.isFinite(kg) || kg <= 0) return 0;
  const liftClass = classifyLift(exerciseOrClass);
  const step =
    liftClass === "isolation" || liftClass === "bodyweight_ish" || /ダンベル|ケーブル/.test(exerciseOrClass)
      ? 0.5
      : 1.25;
  return Math.round(kg / step) * step;
}

function roundHalf(kg: number): number {
  return Math.round(kg * 2) / 2;
}

function baseMonthlyGainKg(sex: WeightPredictSex, liftClass: LiftClass): number {
  const s = sex === "female" ? "female" : sex === "male" ? "male" : "unknown";
  const table: Record<string, Record<LiftClass, number>> = {
    male: {
      compound_lower: 5,
      compound_upper: 2.5,
      isolation: 1.25,
      bodyweight_ish: 1.25,
      other: 2.5,
    },
    female: {
      compound_lower: 2.5,
      compound_upper: 1.25,
      isolation: 1,
      bodyweight_ish: 1,
      other: 1.25,
    },
    unknown: {
      compound_lower: 2.5,
      compound_upper: 1.25,
      isolation: 1,
      bodyweight_ish: 1,
      other: 1.25,
    },
  };
  return table[s][liftClass];
}

/**
 * 性別・体重・身長・年齢・過去推移から「来月目指せそうな重量」を推定する。
 * 数字はルールエンジン。LLMはコメント生成側で使う。
 */
export function predictNextMax(input: WeightPredictInput): WeightPredictResult {
  const liftClass = classifyLift(input.exercise);
  const baseline = input.monthMax;
  let gain = baseMonthlyGainKg(input.sex, liftClass);
  const reasons: string[] = [];

  // 履歴の月次伸び（直近の差分平均）
  const deltas: number[] = [];
  for (let i = 1; i < input.monthlyMaxes.length; i++) {
    deltas.push(input.monthlyMaxes[i]! - input.monthlyMaxes[i - 1]!);
  }
  if (deltas.length >= 1) {
    const recent = deltas.slice(-3);
    const avg = recent.reduce((a, b) => a + b, 0) / recent.length;
    if (avg > 0) {
      gain = avg * 0.55 + gain * 0.45;
      reasons.push(`直近平均+${roundHalf(avg)}kg/月`);
    } else if (avg <= 0) {
      gain = Math.min(gain, liftClass === "compound_lower" ? 1.25 : 0.5);
      reasons.push("伸び悩みのため微増");
    }
  }

  if (input.prevMonthMax != null) {
    const vsPrev = baseline - input.prevMonthMax;
    if (vsPrev <= 0) {
      gain = Math.min(gain, liftClass === "isolation" ? 0.5 : 1.25);
      if (!reasons.some((r) => r.includes("伸び悩み"))) reasons.push("先月比停滞のため慎重設定");
    } else if (vsPrev >= gain * 1.5) {
      gain = Math.min(gain, vsPrev * 0.7);
      reasons.push("急伸後の調整");
    }
  }

  if (input.bodyWeightKg && input.bodyWeightKg > 0) {
    const relative = baseline / input.bodyWeightKg;
    const thresholds =
      liftClass === "compound_lower"
        ? { mid: 1.2, high: 1.6 }
        : liftClass === "compound_upper"
          ? { mid: 0.7, high: 1.0 }
          : { mid: 0.35, high: 0.55 };
    if (relative >= thresholds.high) {
      gain *= 0.55;
      reasons.push(`体重比${roundHalf(relative)}倍で上級域`);
    } else if (relative >= thresholds.mid) {
      gain *= 0.75;
      reasons.push(`体重比${roundHalf(relative)}倍で中〜上級`);
    } else {
      reasons.push(`体重${roundHalf(input.bodyWeightKg)}kg基準`);
    }
  }

  // 身長・BMI（回復・相対負荷の目安）
  if (input.heightCm && input.heightCm > 0 && input.bodyWeightKg && input.bodyWeightKg > 0) {
    const heightM = input.heightCm / 100;
    const bmi = input.bodyWeightKg / (heightM * heightM);
    if (bmi >= 28) {
      gain *= 0.85;
      reasons.push(`BMI${roundHalf(bmi)}で回復ペース考慮`);
    } else if (bmi < 18.5) {
      gain *= 0.9;
      reasons.push(`BMI${roundHalf(bmi)}で無理のない漸進`);
    } else {
      reasons.push(`身長${Math.round(input.heightCm)}cm`);
    }
    // 高身長×下半身複合は可動域が大きく、絶対kgの伸びは抑えめ
    if (liftClass === "compound_lower" && input.heightCm >= 175) {
      gain *= 0.9;
    }
  }

  // 年齢
  if (input.ageYears != null && input.ageYears > 0) {
    if (input.ageYears >= 60) {
      gain *= 0.65;
      reasons.push(`${input.ageYears}歳のため回復優先`);
    } else if (input.ageYears >= 50) {
      gain *= 0.75;
      reasons.push(`${input.ageYears}歳のため慎重ペース`);
    } else if (input.ageYears >= 40) {
      gain *= 0.88;
      reasons.push(`${input.ageYears}歳を考慮`);
    } else if (input.ageYears <= 25) {
      gain *= 1.05;
      reasons.push(`${input.ageYears}歳の適応力を加味`);
    }
  }

  if (input.sex === "female") reasons.push("女性向け標準ペース");
  else if (input.sex === "male") reasons.push("男性向け標準ペース");

  if (input.setsThisMonth >= 12) {
    gain *= 1.1;
    reasons.push("今月のセット数が十分");
  } else if (input.setsThisMonth > 0 && input.setsThisMonth <= 3) {
    gain *= 0.75;
    reasons.push("実施回数が少なめ");
  }

  if (input.firstMax > 0) {
    const totalGrowth = (baseline - input.firstMax) / input.firstMax;
    if (totalGrowth >= 0.4) {
      gain *= 0.7;
      reasons.push("累計+40%超で伸び鈍化想定");
    } else if (totalGrowth >= 0.25) {
      gain *= 0.85;
    }
  }

  gain = Math.max(liftClass === "isolation" ? 0.5 : 1.0, Math.min(gain, liftClass === "compound_lower" ? 7.5 : 5));
  const step = liftClass === "isolation" || liftClass === "bodyweight_ish" ? 0.5 : 1.25;
  const rawTarget = baseline + gain;
  let nextTarget = Math.round(rawTarget / step) * step;
  if (nextTarget <= baseline) nextTarget = roundHalf(baseline + step);

  const nextDelta = roundHalf(nextTarget - baseline);
  const nextGrowthPct = baseline > 0 ? Math.round((nextDelta / baseline) * 1000) / 10 : 0;
  const reason = reasons.slice(0, 3).join(" / ") || "標準的な漸進負荷";

  return { nextTarget, nextDelta, nextGrowthPct, reason };
}
