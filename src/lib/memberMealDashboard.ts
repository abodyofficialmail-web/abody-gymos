import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchOrBackfillNutritionTarget } from "@/lib/memberNutritionTargets";
import {
  buildMealAnalysis,
  buildMealFeedback,
  listMemberLifestyleLogs,
  listMemberMealLogs,
  remainingFromTarget,
  sumMeals,
  tokyoTodayYmd,
  type MemberLifestyleLogView,
  type MemberMealLogView,
} from "@/lib/memberMealLogs";
import { fetchMealReminderSettings } from "@/lib/memberMealReminderSettings";

export async function loadMealPersonalDashboard(supabase: SupabaseClient, memberId: string, today = tokyoTodayYmd()) {
  const [mealsRes, lifeRes, nutritionRes, reminderRes, memberRes] = await Promise.all([
    listMemberMealLogs(supabase, memberId, today),
    listMemberLifestyleLogs(supabase, memberId, today),
    fetchOrBackfillNutritionTarget(supabase, memberId),
    fetchMealReminderSettings(supabase, memberId),
    supabase.from("members").select("store_id").eq("id", memberId).maybeSingle(),
  ]);
  const storeId = (memberRes.data as { store_id?: string | null } | null)?.store_id ?? null;
  let store_name: string | null = null;
  if (storeId) {
    const { data: store } = await supabase.from("stores").select("name").eq("id", storeId).maybeSingle();
    store_name = (store as { name?: string | null } | null)?.name ?? null;
  }
  const meals = mealsRes.ok ? mealsRes.meals : [];
  const lifestyles = lifeRes.ok ? lifeRes.logs : [];
  const nutrition = nutritionRes.ok ? nutritionRes.target : null;
  const todayMeals = meals.filter((m) => m.log_date === today);
  const todayLifestyle = lifestyles.find((l) => l.log_date === today) ?? null;
  const totals = sumMeals(todayMeals);
  const remaining = remainingFromTarget(nutrition, totals);
  const feedback = buildMealFeedback({
    target: nutrition,
    totals,
    remaining,
    lifestyle: todayLifestyle,
  });
  const analysis = buildMealAnalysis({ meals, lifestyles, target: nutrition, today });
  return {
    today,
    meals,
    today_meals: todayMeals as MemberMealLogView[],
    lifestyles,
    today_lifestyle: todayLifestyle as MemberLifestyleLogView | null,
    nutrition,
    totals,
    remaining,
    feedback,
    analysis,
    reminder_settings: reminderRes.ok ? reminderRes.settings : null,
    store_name,
    missingTable: Boolean(mealsRes.ok === false && mealsRes.missingTable) || Boolean(lifeRes.ok === false && lifeRes.missingTable),
    error: mealsRes.ok ? (lifeRes.ok ? (reminderRes.ok ? null : reminderRes.error) : lifeRes.error) : mealsRes.error,
  };
}
