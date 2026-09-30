import { DateTime } from "luxon";
import type { MealDayTotals, MemberMealLogView } from "./memberMealLogs";
import type { MemberNutritionTargetView } from "./memberNutritionTargets";

const MEAL_LOG_TZ = "Asia/Tokyo";
const MEAL_SLOT_LABELS: Record<string, string> = {
  breakfast: "朝",
  lunch: "昼",
  dinner: "夜",
  snack: "間食",
};

export type MealFeedbackDraft = {
  summary: string;
  feedback: string;
};

function formatYmd(ymd: string): string {
  const dt = DateTime.fromISO(ymd, { zone: MEAL_LOG_TZ });
  if (!dt.isValid) return ymd;
  const dow = ["日", "月", "火", "水", "木", "金", "土"][dt.weekday % 7];
  return `${dt.toFormat("M/d")}（${dow}）`;
}

function mealLine(meal: MemberMealLogView): string {
  const slot = MEAL_SLOT_LABELS[meal.meal_slot] ?? "食事";
  const name = meal.items.filter(Boolean).join("、") || meal.note?.trim() || "（内容未記入）";
  return `${slot}: ${name}（${meal.kcal}kcal / P${meal.protein_g}g F${meal.fat_g}g C${meal.carb_g}g）`;
}

export function buildMealDaySummary(params: {
  date: string;
  meals: MemberMealLogView[];
  totals: MealDayTotals;
  target: MemberNutritionTargetView | null;
}): string {
  const lines = [`${formatYmd(params.date)}の食事`];
  if (params.target) {
    lines.push(
      `摂取 ${params.totals.kcal}kcal / 目標 ${params.target.intake_kcal}kcal`,
      `たんぱく質 ${Math.round(params.totals.protein_g)}/${params.target.protein_g}g`,
      `脂質 ${Math.round(params.totals.fat_g)}/${params.target.fat_g}g`,
      `炭水化物 ${Math.round(params.totals.carb_g)}/${params.target.carb_g}g`
    );
  } else {
    lines.push(`摂取 ${params.totals.kcal}kcal`);
  }
  if (params.meals.length === 0) {
    lines.push("記録はありません。");
  } else {
    lines.push(...params.meals.map(mealLine));
  }
  return lines.join("\n");
}

export function buildMealFeedbackLineMessage(summary: string, feedback: string): string {
  return `【今日の食事まとめ】\n${summary.trim()}\n\n【フィードバック】\n${feedback.trim()}`;
}

function fallbackFeedback(params: {
  totals: MealDayTotals;
  target: MemberNutritionTargetView | null;
}): string {
  if (params.totals.meal_count === 0) {
    return "今日の食事記録がまだありません。撮れた食事からでいいので、残しておいてください。";
  }
  if (!params.target) {
    return "記録は残っています。目標が未設定なので、まず目標カロリーを決めてから中身を見ていきましょう。";
  }
  const over = params.totals.kcal - params.target.intake_kcal;
  const proteinGap = Math.round(params.target.protein_g - params.totals.protein_g);
  if (over > 200) {
    return `今日は目標より約${over}kcal多いです。夜はここまでにすると、明日の体重が読みやすくなります。`;
  }
  if (proteinGap > 20) {
    return `カロリーの位置は見えています。たんぱく質があと約${proteinGap}gなので、肉・魚・卵・プロテインのどれか1つ足せると整います。`;
  }
  return "今日の記録は目標の近くです。この内容を続けて、同じ時間帯で測ると変化が見えます。";
}

async function callOpenAi(system: string, user: string): Promise<string | null> {
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key) return null;
  const model = process.env.OPENAI_MODEL?.trim() || "gpt-4o-mini";
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25_000);
  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        temperature: 0.4,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const text = String(json.choices?.[0]?.message?.content ?? "");
    const parsed = JSON.parse(text) as { feedback?: unknown };
    const feedback = String(parsed.feedback ?? "").trim();
    return feedback || null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

const SYSTEM = `あなたはパーソナルジムのトレーナーです。会員に送る食事フィードバックを日本語で書いてください。
数字は渡された記録から変えないでください。医療判断や断定的な病気の話はしないでください。
200〜320文字、です・ます調。JSONだけを {"feedback":"..."} で返してください。`;

export async function generateMealTrainerFeedback(params: {
  summary: string;
  totals: MealDayTotals;
  target: MemberNutritionTargetView | null;
  current?: string;
  instruction?: string;
}): Promise<{ feedback: string; ai: boolean }> {
  const instruction = params.instruction?.trim();
  const user = instruction
    ? `食事記録:\n${params.summary}\n\nいまの文:\n${params.current ?? ""}\n\nトレーナーの指示:\n${instruction}\n\n指示を反映した完成文だけをfeedbackに入れてください。`
    : `食事記録:\n${params.summary}\n\nこの内容へのフィードバック文をfeedbackに入れてください。`;
  const ai = await callOpenAi(SYSTEM, user);
  if (ai) return { feedback: ai, ai: true };
  return { feedback: fallbackFeedback({ totals: params.totals, target: params.target }), ai: false };
}
