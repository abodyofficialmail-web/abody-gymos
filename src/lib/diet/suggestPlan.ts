import type {
  MealAnalysisHint,
  MealDayTotals,
  MealRemaining,
  MealSlot,
  MemberMealLogView,
} from "../memberMealLogs";
import type { MemberNutritionTargetView } from "../memberNutritionTargets";

export type PlanMeal = {
  name: string;
  kind: string;
  kcal: number;
  protein_g: number;
  fat_g: number;
  carb_g: number;
  why: string;
  for_slot: MealSlot | null;
};

export type MealDayPlan = {
  headline: string;
  leftover_slots: MealSlot[];
  steps: string[];
  meals: PlanMeal[];
};

type CatalogMeal = {
  name: string;
  kind: string;
  kcal: number;
  protein_g: number;
  fat_g: number;
  carb_g: number;
  tags: Array<"light" | "protein" | "set" | "snack">;
};

const SLOT_LABELS: Record<MealSlot, string> = {
  breakfast: "朝",
  lunch: "昼",
  dinner: "夜",
  snack: "間食",
};

const CATALOG: CatalogMeal[] = [
  { name: "サラダチキン（プレーン）", kind: "コンビニ", kcal: 113, protein_g: 23, fat_g: 1.2, carb_g: 1.4, tags: ["light", "protein", "snack"] },
  { name: "グリルチキン", kind: "コンビニ", kcal: 160, protein_g: 22, fat_g: 6, carb_g: 4, tags: ["light", "protein", "snack"] },
  { name: "プロテイン1杯", kind: "自炊", kcal: 90, protein_g: 20, fat_g: 1, carb_g: 3, tags: ["light", "protein", "snack"] },
  { name: "プロテインヨーグルト", kind: "コンビニ", kcal: 90, protein_g: 12, fat_g: 0.5, carb_g: 9, tags: ["light", "snack"] },
  { name: "卵2個＋納豆ごはん", kind: "自炊", kcal: 420, protein_g: 24, fat_g: 14, carb_g: 48, tags: ["protein", "set"] },
  { name: "鶏むね150g＋ご飯150g＋野菜", kind: "自炊", kcal: 480, protein_g: 42, fat_g: 8, carb_g: 52, tags: ["protein", "set"] },
  { name: "おにぎり＋サラダチキン", kind: "コンビニ", kcal: 300, protein_g: 27, fat_g: 3, carb_g: 38, tags: ["protein"] },
  { name: "さばの塩焼定食（ごはん少なめ）", kind: "定食", kcal: 520, protein_g: 32, fat_g: 16, carb_g: 55, tags: ["protein", "set"] },
  { name: "チキンかあさん煮定食", kind: "定食", kcal: 620, protein_g: 38, fat_g: 16, carb_g: 72, tags: ["set"] },
  { name: "チキンのグリル", kind: "外食単品", kcal: 300, protein_g: 28, fat_g: 12, carb_g: 8, tags: ["protein", "light"] },
  { name: "サラダ＋ゆで卵2個", kind: "自炊", kcal: 220, protein_g: 14, fat_g: 12, carb_g: 8, tags: ["light", "snack"] },
];

function round1(n: number) {
  return Math.round(n * 10) / 10;
}

export function leftoverSlots(hour: number, logged: MealSlot[]): MealSlot[] {
  const has = new Set(logged);
  const out: MealSlot[] = [];
  if (hour < 11 && !has.has("breakfast")) out.push("breakfast");
  if (hour < 16 && !has.has("lunch")) out.push("lunch");
  if (!has.has("dinner")) out.push("dinner");
  if (!has.has("snack")) out.push("snack");
  return out;
}

function scoreMeal(meal: CatalogMeal, budgetKcal: number, budgetProtein: number, wantSnack: boolean) {
  const over = Math.max(0, meal.kcal - Math.max(80, budgetKcal));
  const under = Math.max(0, budgetKcal - meal.kcal);
  const proteinHit = budgetProtein > 10 ? Math.min(meal.protein_g, budgetProtein) : meal.protein_g * 0.4;
  const snackFit = wantSnack ? (meal.tags.includes("snack") ? 12 : -20) : meal.tags.includes("set") ? 8 : 0;
  return proteinHit * 4 - over * 0.12 - under * 0.02 + snackFit - meal.fat_g * 0.4;
}

function pickMeal(budgetKcal: number, budgetProtein: number, wantSnack: boolean, used: Set<string>): CatalogMeal {
  const ranked = CATALOG.filter((m) => !used.has(m.name))
    .map((m) => ({ m, score: scoreMeal(m, budgetKcal, budgetProtein, wantSnack) }))
    .sort((a, b) => b.score - a.score);
  return ranked[0]?.m ?? CATALOG[0]!;
}

function whyOf(meal: CatalogMeal, remaining: MealRemaining | null, slot: MealSlot | null) {
  if (!remaining) return meal.kind;
  if (remaining.kcal < 250 && meal.kcal <= remaining.kcal + 40) {
    return `残り約${Math.round(remaining.kcal)}kcalに収まる`;
  }
  if (remaining.protein_g > 20 && meal.protein_g >= 20) {
    return `たんぱく質を約${meal.protein_g}g足せる`;
  }
  if (slot) return `${SLOT_LABELS[slot]}の目安 ${meal.kcal}kcal`;
  return meal.kind;
}

export function buildMealDayPlan(params: {
  hour: number;
  todayMeals: Array<Pick<MemberMealLogView, "meal_slot">>;
  totals: MealDayTotals;
  remaining: MealRemaining | null;
  nutrition: MemberNutritionTargetView | null;
  analysis?: MealAnalysisHint | null;
}): MealDayPlan {
  const logged = params.todayMeals.map((m) => m.meal_slot);
  const leftover = leftoverSlots(params.hour, logged);
  const remaining = params.remaining;
  const mains = leftover.filter((s) => s !== "snack");
  const includeSnack = leftover.includes("snack");
  const steps: string[] = [];
  const meals: PlanMeal[] = [];
  const used = new Set<string>();

  if (!params.nutrition || remaining == null) {
    return {
      headline: "目標カロリーが未設定です。記録を続けつつ、たんぱく多めを優先してください。",
      leftover_slots: leftover,
      steps: ["まずは3食を記録する", "肉・魚・卵・プロテインを1食に1つ入れる"],
      meals: [
        {
          name: "鶏むね150g＋ご飯150g＋野菜",
          kind: "自炊",
          kcal: 480,
          protein_g: 42,
          fat_g: 8,
          carb_g: 52,
          why: "目標未設定でもたんぱくを確保しやすい",
          for_slot: mains[0] ?? "dinner",
        },
      ],
    };
  }

  if (remaining.kcal < -150) {
    steps.push("今日はこれ以上の食事を足さない。水分とお茶中心にする");
    steps.push("どうしても食べるならサラダチキンかプロテインだけ");
    const light = pickMeal(120, Math.max(15, remaining.protein_g), true, used);
    meals.push({
      name: light.name,
      kind: light.kind,
      kcal: light.kcal,
      protein_g: light.protein_g,
      fat_g: light.fat_g,
      carb_g: light.carb_g,
      why: `目標を約${Math.abs(Math.round(remaining.kcal))}kcal超えているので最小限`,
      for_slot: includeSnack ? "snack" : null,
    });
    return {
      headline: `目標を約${Math.abs(Math.round(remaining.kcal))}kcal超えています。残りは軽めに。`,
      leftover_slots: leftover,
      steps,
      meals,
    };
  }

  const snackBudget =
    includeSnack && remaining.kcal >= 280 && remaining.protein_g > 12 ? Math.min(150, Math.round(remaining.kcal * 0.2)) : 0;
  const mainBudgetKcal = mains.length ? Math.max(120, Math.round((remaining.kcal - snackBudget) / mains.length)) : remaining.kcal;
  const mainBudgetP = mains.length
    ? round1(Math.max(12, (remaining.protein_g - (snackBudget > 0 ? 12 : 0)) / mains.length))
    : remaining.protein_g;

  if (mains.length === 0 && remaining.kcal <= 180) {
    steps.push("残りの食事はほぼ終わっています。間食するならたんぱくだけの補食にする");
  } else if (mains.length === 1) {
    steps.push(
      `${SLOT_LABELS[mains[0]!]}は約${mainBudgetKcal}kcal・たんぱく${Math.round(mainBudgetP)}gを1皿で取る`
    );
  } else if (mains.length > 1) {
    steps.push(
      `これから${mains.map((s) => SLOT_LABELS[s]).join("・")}を、1食あたり約${mainBudgetKcal}kcalで割る`
    );
  }
  if (remaining.protein_g > 20) {
    steps.push(`たんぱく質があと${Math.round(remaining.protein_g)}g。肉・魚・卵・プロテインを優先`);
  }
  if (remaining.fat_g < 12) {
    steps.push("今日は脂質の残りが少ないので、揚げ物とマヨは避ける");
  }
  if (snackBudget > 0) {
    steps.push(`間食するなら${snackBudget}kcal以内のたんぱく補食`);
  } else if (includeSnack && remaining.kcal < 280) {
    steps.push("間食は基本なし。お腹が空いたら水かお茶");
  }
  if (params.analysis?.hints[0]) steps.push(params.analysis.hints[0]);

  for (const slot of mains) {
    const picked = pickMeal(mainBudgetKcal, mainBudgetP, false, used);
    used.add(picked.name);
    meals.push({
      name: picked.name,
      kind: picked.kind,
      kcal: picked.kcal,
      protein_g: picked.protein_g,
      fat_g: picked.fat_g,
      carb_g: picked.carb_g,
      why: whyOf(picked, remaining, slot),
      for_slot: slot,
    });
  }
  if (snackBudget > 0) {
    const snack = pickMeal(snackBudget, 18, true, used);
    meals.push({
      name: snack.name,
      kind: snack.kind,
      kcal: snack.kcal,
      protein_g: snack.protein_g,
      fat_g: snack.fat_g,
      carb_g: snack.carb_g,
      why: whyOf(snack, remaining, "snack"),
      for_slot: "snack",
    });
  } else if (mains.length === 0 && remaining.kcal > 80) {
    const snack = pickMeal(Math.min(remaining.kcal, 180), remaining.protein_g, true, used);
    meals.push({
      name: snack.name,
      kind: snack.kind,
      kcal: snack.kcal,
      protein_g: snack.protein_g,
      fat_g: snack.fat_g,
      carb_g: snack.carb_g,
      why: whyOf(snack, remaining, "snack"),
      for_slot: "snack",
    });
  }

  const leftoverLabel = leftover.length
    ? leftover.map((s) => SLOT_LABELS[s]).join("・")
    : "残りの食事はほぼなし";
  const headline = `残り ${Math.round(remaining.kcal)}kcal / P ${round1(remaining.protein_g)}g。これから ${leftoverLabel}`;

  return {
    headline,
    leftover_slots: leftover,
    steps: steps.slice(0, 4),
    meals: meals.slice(0, 3),
  };
}
