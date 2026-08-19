import { ACTIVITY_OPTIONS, type GoalHearingFormPayload } from "@/lib/goalHearing";
import { estimateGoalHearingNutrition, type NutritionEstimate } from "@/lib/goalHearingNutrition";
import type { createSupabaseServiceClient } from "@/lib/supabase/admin";

export type MemberNutritionTargetRow = {
  member_id: string;
  daily_expenditure_kcal: number;
  intake_kcal: number;
  intake_kcal_min: number | null;
  intake_kcal_max: number | null;
  protein_g: number;
  fat_g: number;
  carb_g: number;
  bmr_kcal: number | null;
  note: string | null;
  source: "goal_hearing" | "manual";
  goal_hearing_response_id: string | null;
  updated_by_trainer_id: string | null;
  updated_at: string;
  created_at: string;
};

export type MemberNutritionTargetView = {
  daily_expenditure_kcal: number;
  intake_kcal: number;
  intake_kcal_min: number | null;
  intake_kcal_max: number | null;
  protein_g: number;
  fat_g: number;
  carb_g: number;
  bmr_kcal: number | null;
  note: string | null;
  source: "goal_hearing" | "manual";
  updated_at: string;
};

type Supabase = ReturnType<typeof createSupabaseServiceClient>;

function isMissingTable(err: { code?: string; message?: string } | null | undefined): boolean {
  const c = String(err?.code ?? "");
  const m = String(err?.message ?? "");
  return (
    c === "PGRST205" ||
    m.includes("member_nutrition_targets") ||
    m.includes("Could not find the table") ||
    (m.includes("does not exist") && m.includes("nutrition"))
  );
}

export function toNutritionTargetView(row: MemberNutritionTargetRow): MemberNutritionTargetView {
  return {
    daily_expenditure_kcal: row.daily_expenditure_kcal,
    intake_kcal: row.intake_kcal,
    intake_kcal_min: row.intake_kcal_min,
    intake_kcal_max: row.intake_kcal_max,
    protein_g: row.protein_g,
    fat_g: row.fat_g,
    carb_g: row.carb_g,
    bmr_kcal: row.bmr_kcal,
    note: row.note,
    source: row.source,
    updated_at: row.updated_at,
  };
}

export function nutritionRowFromEstimate(params: {
  memberId: string;
  estimate: NutritionEstimate;
  source: "goal_hearing" | "manual";
  goalHearingResponseId?: string | null;
  updatedByTrainerId?: string | null;
}): Omit<MemberNutritionTargetRow, "updated_at" | "created_at"> & {
  updated_at?: string;
} {
  const { memberId, estimate: est, source } = params;
  return {
    member_id: memberId,
    daily_expenditure_kcal: est.tdee,
    intake_kcal: est.intake_mid,
    intake_kcal_min: est.intake_min,
    intake_kcal_max: est.intake_max,
    protein_g: est.protein_g,
    fat_g: est.fat_g,
    carb_g: est.carb_g,
    bmr_kcal: est.bmr,
    note: est.note,
    source,
    goal_hearing_response_id: params.goalHearingResponseId ?? null,
    updated_by_trainer_id: params.updatedByTrainerId ?? null,
  };
}

/** 活動量: id または日本語ラベル → id */
export function normalizeActivityLevel(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const t = String(raw).trim();
  if (ACTIVITY_OPTIONS.some((o) => o.id === t)) return t;
  const byLabel = ACTIVITY_OPTIONS.find((o) => o.label === t);
  return byLabel?.id ?? null;
}

/** カルテ本文から年齢・生年月日・体重を補完（古い回答のカラム欠落対策） */
export function enrichNutritionFieldsFromKarteContent(
  content: string | null | undefined,
  fields: {
    birth_date?: string | null;
    age_years?: number | null;
    current_weight_kg?: number | null;
    weight_unknown?: boolean | null;
    height_cm?: number | null;
  }
) {
  const text = String(content ?? "");
  let birth_date = fields.birth_date ?? null;
  let age_years = fields.age_years ?? null;
  let current_weight_kg = fields.current_weight_kg ?? null;
  let weight_unknown = Boolean(fields.weight_unknown);
  let height_cm = fields.height_cm ?? null;

  if (!birth_date) {
    const m = text.match(/生年月日\s*(\d{4}-\d{2}-\d{2})/);
    if (m) birth_date = m[1];
  }
  if (age_years == null) {
    const m = text.match(/年齢情報:\s*(\d+)\s*歳/) || text.match(/年齢[：:]\s*(\d+)/);
    if (m) age_years = Number(m[1]);
  }
  if (current_weight_kg == null && !weight_unknown) {
    const unknown = /体重:\s*今\s*不明/.test(text);
    if (unknown) {
      weight_unknown = true;
    } else {
      const m = text.match(/体重:\s*今\s*([\d.]+)\s*kg/);
      if (m) current_weight_kg = Number(m[1]);
    }
  }
  if (height_cm == null) {
    const m = text.match(/身長:\s*([\d.]+)\s*cm/);
    if (m) height_cm = Number(m[1]);
  }

  return { birth_date, age_years, current_weight_kg, weight_unknown, height_cm };
}

/** goal_hearing_responses の行から計算用フォームへ（最低限の必須項目） */
export function formPayloadFromGoalHearingResponse(row: {
  primary_goal: string;
  weight_direction?: string | null;
  current_weight_kg?: number | null;
  target_weight_kg?: number | null;
  sex: string;
  birth_date?: string | null;
  age_years?: number | null;
  height_cm: number;
  weight_unknown?: boolean | null;
  activity_level: string;
}): GoalHearingFormPayload | null {
  if (row.sex !== "female" && row.sex !== "male") return null;
  const activity = normalizeActivityLevel(row.activity_level) ?? "light";
  if (!row.height_cm || !row.primary_goal) return null;
  return {
    primary_goal: row.primary_goal,
    focus_areas: [],
    weight_direction: row.weight_direction || "maintain",
    current_weight_kg: row.current_weight_kg ?? null,
    target_weight_kg: row.target_weight_kg ?? null,
    deadline_type: "none",
    sex: row.sex,
    birth_date: row.birth_date ?? null,
    age_years: row.age_years ?? null,
    height_cm: Number(row.height_cm),
    weight_unknown: Boolean(row.weight_unknown),
    activity_level: activity,
    ideal_frequency: "week_2",
    sleep_hours: "7_8",
    challenges: [],
    pain_areas: [],
    goal_photo_paths: ["placeholder"],
  };
}

export async function upsertNutritionFromGoalHearing(
  supabase: Supabase,
  params: {
    memberId: string;
    form: GoalHearingFormPayload;
    goalHearingResponseId?: string | null;
  }
): Promise<{ ok: true; row: MemberNutritionTargetView } | { ok: false; skipped?: boolean; error?: string }> {
  const estimate = estimateGoalHearingNutrition(params.form);
  if (!estimate) return { ok: false, skipped: true };

  const row = nutritionRowFromEstimate({
    memberId: params.memberId,
    estimate,
    source: "goal_hearing",
    goalHearingResponseId: params.goalHearingResponseId ?? null,
  });

  const { data, error } = await (supabase as any)
    .from("member_nutrition_targets")
    .upsert(
      {
        ...row,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "member_id" }
    )
    .select("*")
    .maybeSingle();

  if (error) {
    if (isMissingTable(error)) return { ok: false, skipped: true, error: error.message };
    return { ok: false, error: error.message };
  }
  if (!data) return { ok: false, error: "upsert returned no row" };
  return { ok: true, row: toNutritionTargetView(data as MemberNutritionTargetRow) };
}

export async function fetchNutritionTarget(
  supabase: Supabase,
  memberId: string
): Promise<{ ok: true; target: MemberNutritionTargetView | null } | { ok: false; error: string; missingTable?: boolean }> {
  const { data, error } = await (supabase as any)
    .from("member_nutrition_targets")
    .select("*")
    .eq("member_id", memberId)
    .maybeSingle();

  if (error) {
    if (isMissingTable(error)) return { ok: false, error: error.message, missingTable: true };
    return { ok: false, error: error.message };
  }
  if (!data) return { ok: true, target: null };
  return { ok: true, target: toNutritionTargetView(data as MemberNutritionTargetRow) };
}

export type NutritionHearingMeta = {
  has_response: boolean;
  weight_missing: boolean;
};

/** 未保存なら最新の目標ヒアリングから算出して保存（既存回答のバックフィル） */
export async function fetchOrBackfillNutritionTarget(
  supabase: Supabase,
  memberId: string
): Promise<
  | { ok: true; target: MemberNutritionTargetView | null; hearing: NutritionHearingMeta }
  | { ok: false; error: string; missingTable?: boolean }
> {
  const existing = await fetchNutritionTarget(supabase, memberId);
  if (!existing.ok) return existing;
  if (existing.target) {
    return { ok: true, target: existing.target, hearing: { has_response: true, weight_missing: false } };
  }

  const { data: response, error: respErr } = await (supabase as any)
    .from("goal_hearing_responses")
    .select(
      "id, client_note_id, primary_goal, weight_direction, current_weight_kg, target_weight_kg, sex, birth_date, age_years, height_cm, weight_unknown, activity_level"
    )
    .eq("member_id", memberId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (respErr) {
    const missing =
      String(respErr.message ?? "").includes("goal_hearing") ||
      String(respErr.message ?? "").includes("Could not find the table");
    if (missing) return { ok: true, target: null, hearing: { has_response: false, weight_missing: false } };
    return { ok: false, error: respErr.message };
  }
  if (!response) {
    return { ok: true, target: null, hearing: { has_response: false, weight_missing: false } };
  }

  let birth_date = response.birth_date ?? null;
  let age_years = response.age_years ?? null;
  let current_weight_kg = response.current_weight_kg ?? null;
  let weight_unknown = Boolean(response.weight_unknown);
  let height_cm = response.height_cm ?? null;

  const needsEnrich =
    (age_years == null && !birth_date) ||
    ((current_weight_kg == null || !Number.isFinite(Number(current_weight_kg))) && !weight_unknown) ||
    height_cm == null;

  if (needsEnrich && response.client_note_id) {
    const { data: note } = await (supabase as any)
      .from("client_notes")
      .select("content")
      .eq("id", response.client_note_id)
      .maybeSingle();
    const enriched = enrichNutritionFieldsFromKarteContent(note?.content, {
      birth_date,
      age_years,
      current_weight_kg,
      weight_unknown,
      height_cm,
    });
    birth_date = enriched.birth_date;
    age_years = enriched.age_years;
    current_weight_kg = enriched.current_weight_kg;
    weight_unknown = enriched.weight_unknown;
    height_cm = enriched.height_cm ?? height_cm;
  }

  const weightMissing =
    weight_unknown || current_weight_kg == null || !Number.isFinite(Number(current_weight_kg));

  const form = formPayloadFromGoalHearingResponse({
    ...response,
    birth_date,
    age_years,
    current_weight_kg,
    weight_unknown,
    height_cm: Number(height_cm ?? response.height_cm),
  });
  if (!form) {
    return { ok: true, target: null, hearing: { has_response: true, weight_missing: weightMissing } };
  }

  const upserted = await upsertNutritionFromGoalHearing(supabase, {
    memberId,
    form,
    goalHearingResponseId: response.id,
  });
  if (upserted.ok) {
    return { ok: true, target: upserted.row, hearing: { has_response: true, weight_missing: false } };
  }
  if (upserted.skipped) {
    return { ok: true, target: null, hearing: { has_response: true, weight_missing: weightMissing } };
  }
  return { ok: false, error: upserted.error ?? "backfill failed" };
}

export function formatIntakeLabel(target: Pick<MemberNutritionTargetView, "intake_kcal" | "intake_kcal_min" | "intake_kcal_max">): string {
  const min = target.intake_kcal_min;
  const max = target.intake_kcal_max;
  if (min != null && max != null && min !== max) {
    return `${min}〜${max}`;
  }
  return String(target.intake_kcal);
}
