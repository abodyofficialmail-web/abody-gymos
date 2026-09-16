import type { WeightProgressRow } from "@/lib/monthlyProgressReport/types";
import type { WeightProgressProfile } from "./buildWeightProgress";
import { commentSourceHash } from "./buildWeightProgress";

export type WeightAiCommentItem = {
  exercise: string;
  nextTarget: number;
  ruleReason: string;
  sourceHash: string;
  aiRationale: string;
  trainerTip: string;
  model: string;
};

function fallbackComments(
  rows: WeightProgressRow[],
  profile: WeightProgressProfile,
  nextMonthLabel: string
): WeightAiCommentItem[] {
  return rows.map((r) => {
    const nextTarget = r.nextTarget ?? r.monthMax;
    const ruleReason = r.nextReason || "標準的な漸進負荷";
    const sourceHash = commentSourceHash({
      exercise: r.exercise,
      nextTarget,
      monthMax: r.monthMax,
      prevMonthMax: r.prevMonthMax,
      nextReason: ruleReason,
      sex: profile.sex,
      bodyWeightKg: profile.bodyWeightKg,
      heightCm: profile.heightCm,
      ageYears: profile.ageYears,
    });
    const delta = r.nextDelta != null ? `${r.nextDelta > 0 ? "+" : ""}${r.nextDelta}kg` : "";
    const profileBits = [
      profile.sex === "female" ? "女性" : profile.sex === "male" ? "男性" : null,
      profile.ageYears != null ? `${profile.ageYears}歳` : null,
      profile.heightCm != null ? `身長${Math.round(profile.heightCm)}cm` : null,
      profile.bodyWeightKg != null ? `体重${profile.bodyWeightKg}kg` : null,
    ]
      .filter(Boolean)
      .join("・");

    return {
      exercise: r.exercise,
      nextTarget,
      ruleReason,
      sourceHash,
      aiRationale: `${r.exercise}は基準${r.monthMax}kg。${ruleReason}を踏まえ、${nextMonthLabel}の目標は${nextTarget}kg（${delta}）が現実的です。${
        profileBits ? `（${profileBits}）` : ""
      }`,
      trainerTip:
        r.vsPrev != null && r.vsPrev <= 0
          ? "重量更新よりフォーム・可動域・テンポを優先し、質が安定してから微増してください。"
          : `フォームを崩さない範囲で${delta || "微増"}を狙い、最後の1〜2レップで余裕があるか確認してください。`,
      model: "rule-fallback",
    };
  });
}

async function callOpenAiJson(prompt: string): Promise<{
  items: { exercise: string; ai_rationale: string; trainer_tip: string }[];
} | null> {
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
        temperature: 0.35,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "あなたはパーソナルジムのアシスタントです。重量目標の数字は既に決まっているので変更せず、根拠とトレーナー向け一言だけを日本語で書いてください。JSONのみ返してください。",
          },
          { role: "user", content: prompt },
        ],
      }),
    });
    if (!res.ok) {
      console.warn("OpenAI weight comment failed", res.status, await res.text().catch(() => ""));
      return null;
    }
    const json = (await res.json()) as any;
    const text = String(json?.choices?.[0]?.message?.content ?? "");
    const parsed = JSON.parse(text);
    if (!parsed || !Array.isArray(parsed.items)) return null;
    return parsed;
  } catch (e) {
    console.warn("OpenAI weight comment error", e);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * ルール数字は固定し、根拠文・トレーナー一言だけ生成する。
 * OPENAI_API_KEY が無い / 失敗時はテンプレートにフォールバック（表示は止まらない）。
 */
export async function generateWeightAiComments(params: {
  rows: WeightProgressRow[];
  profile: WeightProgressProfile;
  nextMonthLabel: string;
  recentFeedbacks?: string[];
  limit?: number;
}): Promise<WeightAiCommentItem[]> {
  const limit = params.limit ?? 8;
  const targetRows = params.rows.filter((r) => r.nextTarget != null).slice(0, limit);
  if (!targetRows.length) return [];

  const fallback = fallbackComments(targetRows, params.profile, params.nextMonthLabel);
  const prompt = `
次の会員プロフィールと種目データを使い、各種目について JSON を返してください。
数字(next_target等)は変更禁止です。

プロフィール:
- 性別: ${params.profile.sex ?? "不明"}
- 年齢: ${params.profile.ageYears ?? "不明"}
- 身長cm: ${params.profile.heightCm ?? "不明"}
- 体重kg: ${params.profile.bodyWeightKg ?? "不明"}
- 目標月ラベル: ${params.nextMonthLabel}
- 直近FB抜粋: ${(params.recentFeedbacks ?? []).slice(0, 3).join(" / ") || "なし"}

種目データ:
${JSON.stringify(
  targetRows.map((r) => ({
    exercise: r.exercise,
    first_max: r.firstMax,
    prev_month_max: r.prevMonthMax,
    month_max: r.monthMax,
    vs_prev: r.vsPrev,
    vs_first: r.vsFirst,
    growth_pct: r.growthPct,
    next_target: r.nextTarget,
    next_delta: r.nextDelta,
    rule_reason: r.nextReason,
  })),
  null,
  2
)}

出力JSON形式:
{
  "items": [
    {
      "exercise": "種目名（入力と同じ）",
      "ai_rationale": "会員にも分かる根拠を1〜2文",
      "trainer_tip": "トレーナー向けのセッション指示を1文"
    }
  ]
}
`.trim();

  const llm = await callOpenAiJson(prompt);
  if (!llm) return fallback;

  const model = process.env.OPENAI_MODEL?.trim() || "gpt-4o-mini";
  const byEx = new Map(llm.items.map((i) => [i.exercise, i]));

  return fallback.map((base) => {
    const hit = byEx.get(base.exercise);
    if (!hit?.ai_rationale || !hit?.trainer_tip) return base;
    return {
      ...base,
      aiRationale: String(hit.ai_rationale).slice(0, 280),
      trainerTip: String(hit.trainer_tip).slice(0, 180),
      model,
    };
  });
}
