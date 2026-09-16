"use client";

import { useMemo } from "react";
import { DateTime } from "luxon";
import { buildMealDayPlan } from "@/lib/diet/suggestPlan";
import {
  MEAL_LOG_TZ,
  MEAL_SLOT_LABELS,
  type MealAnalysisHint,
  type MealDayTotals,
  type MealRemaining,
  type MemberMealLogView,
} from "@/lib/memberMealLogs";
import type { MemberNutritionTargetView } from "@/lib/memberNutritionTargets";

export function MealPlanSuggest({
  remaining,
  totals,
  nutrition,
  todayMeals,
  analysis,
}: {
  remaining: MealRemaining | null;
  totals: MealDayTotals;
  nutrition: MemberNutritionTargetView | null;
  todayMeals: MemberMealLogView[];
  analysis?: MealAnalysisHint | null;
}) {
  const plan = useMemo(() => {
    const hour = DateTime.now().setZone(MEAL_LOG_TZ).hour;
    return buildMealDayPlan({
      hour,
      todayMeals,
      totals,
      remaining,
      nutrition,
      analysis,
    });
  }, [analysis, nutrition, remaining, todayMeals, totals]);

  const targetKcal = nutrition?.intake_kcal ?? null;

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <div className="text-sm font-bold text-slate-900">提案</div>
        <p className="text-xs leading-relaxed text-slate-600">{plan.headline}</p>
        {targetKcal != null ? (
          <p className="text-[11px] text-slate-500">
            今日 {Math.round(totals.kcal)} / 目標 {targetKcal}kcal
            {nutrition ? `　P ${Math.round(totals.protein_g)} / ${nutrition.protein_g}g` : ""}
          </p>
        ) : null}
      </div>

      {plan.steps.length ? (
        <div className="space-y-2">
          <div className="text-xs font-bold text-slate-800">進め方</div>
          <ol className="space-y-1.5">
            {plan.steps.map((step, i) => (
              <li key={step} className="flex gap-2 text-xs leading-relaxed text-slate-700">
                <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-slate-900 text-[10px] font-bold text-white">
                  {i + 1}
                </span>
                <span>{step}</span>
              </li>
            ))}
          </ol>
        </div>
      ) : null}

      {plan.meals.length ? (
        <div className="space-y-2">
          <div className="text-xs font-bold text-slate-800">おすすめの食事</div>
          <div className="grid gap-2">
            {plan.meals.map((meal) => (
              <div key={`${meal.for_slot ?? "x"}-${meal.name}`} className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    {meal.for_slot ? (
                      <div className="text-[11px] font-semibold text-teal-800">{MEAL_SLOT_LABELS[meal.for_slot]}</div>
                    ) : null}
                    <div className="text-sm font-bold text-slate-900">{meal.name}</div>
                  </div>
                  <div className="shrink-0 text-[11px] font-semibold text-slate-500">{meal.kind}</div>
                </div>
                <div className="mt-1 text-xs font-semibold text-slate-700">
                  {meal.kcal}kcal　P {meal.protein_g} / F {meal.fat_g} / C {meal.carb_g}
                </div>
                <p className="mt-1 text-xs leading-relaxed text-slate-500">{meal.why}</p>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
