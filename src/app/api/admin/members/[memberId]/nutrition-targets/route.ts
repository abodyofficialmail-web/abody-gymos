import { z } from "zod";
import { jsonResponse } from "@/app/api/booking-v2/_cors";
import {
  fetchOrBackfillNutritionTarget,
  toNutritionTargetView,
  type MemberNutritionTargetRow,
} from "@/lib/memberNutritionTargets";
import { createSupabaseServiceClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function OPTIONS() {
  return jsonResponse({}, 200);
}

function isMissingTable(err: { code?: string; message?: string } | null | undefined): boolean {
  const m = String(err?.message ?? "");
  return (
    String(err?.code ?? "") === "PGRST205" ||
    m.includes("member_nutrition_targets") ||
    m.includes("Could not find the table")
  );
}

export async function GET(_request: Request, ctx: { params: { memberId: string } | Promise<{ memberId: string }> }) {
  try {
    const params = await ctx.params;
    const memberId = params.memberId?.trim();
    if (!memberId) return jsonResponse({ error: "memberId が不正です" }, 400);

    const supabase = createSupabaseServiceClient();
    const { data: member, error: memberErr } = await supabase
      .from("members")
      .select("id")
      .eq("id", memberId)
      .maybeSingle();
    if (memberErr) return jsonResponse({ error: "会員の取得に失敗しました", detail: memberErr.message }, 500);
    if (!member) return jsonResponse({ error: "会員が見つかりません" }, 404);

    const result = await fetchOrBackfillNutritionTarget(supabase, memberId);
    if (!result.ok) {
      if (result.missingTable) {
        return jsonResponse({ target: null, hearing: { has_response: false, weight_missing: false }, error: "nutrition_table_missing" }, 200);
      }
      return jsonResponse({ error: "栄養目標の取得に失敗しました", detail: result.error }, 500);
    }

    return jsonResponse({ target: result.target, hearing: result.hearing }, 200);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return jsonResponse({ error: "取得中にエラーが発生しました", detail: message }, 500);
  }
}

const patchSchema = z.object({
  daily_expenditure_kcal: z.number().int().min(0).max(20000),
  intake_kcal: z.number().int().min(0).max(20000),
  protein_g: z.number().int().min(0).max(1000),
  fat_g: z.number().int().min(0).max(1000),
  carb_g: z.number().int().min(0).max(2000),
  note: z.string().max(500).nullable().optional(),
  updated_by_trainer_id: z.string().uuid().nullable().optional(),
});

export async function PATCH(request: Request, ctx: { params: { memberId: string } | Promise<{ memberId: string }> }) {
  try {
    const params = await ctx.params;
    const memberId = params.memberId?.trim();
    if (!memberId) return jsonResponse({ error: "memberId が不正です" }, 400);

    const raw = await request.json().catch(() => ({}));
    const parsed = patchSchema.safeParse(raw);
    if (!parsed.success) {
      return jsonResponse({ error: "入力内容を確認してください", detail: parsed.error.flatten() }, 400);
    }

    const supabase = createSupabaseServiceClient();
    const { data: member, error: memberErr } = await supabase
      .from("members")
      .select("id")
      .eq("id", memberId)
      .maybeSingle();
    if (memberErr) return jsonResponse({ error: "会員の取得に失敗しました", detail: memberErr.message }, 500);
    if (!member) return jsonResponse({ error: "会員が見つかりません" }, 404);

    const body = parsed.data;
    const now = new Date().toISOString();
    const row = {
      member_id: memberId,
      daily_expenditure_kcal: body.daily_expenditure_kcal,
      intake_kcal: body.intake_kcal,
      intake_kcal_min: body.intake_kcal,
      intake_kcal_max: body.intake_kcal,
      protein_g: body.protein_g,
      fat_g: body.fat_g,
      carb_g: body.carb_g,
      note: body.note?.trim() || null,
      source: "manual" as const,
      updated_by_trainer_id: body.updated_by_trainer_id ?? null,
      updated_at: now,
    };

    const { data, error } = await (supabase as any)
      .from("member_nutrition_targets")
      .upsert(row, { onConflict: "member_id" })
      .select("*")
      .maybeSingle();

    if (error) {
      if (isMissingTable(error)) {
        return jsonResponse(
          { error: "栄養目標テーブルが未作成です。マイグレーションを適用してください。", detail: error.message },
          503
        );
      }
      return jsonResponse({ error: "栄養目標の保存に失敗しました", detail: error.message }, 500);
    }
    if (!data) return jsonResponse({ error: "栄養目標の保存に失敗しました" }, 500);

    return jsonResponse({ ok: true, target: toNutritionTargetView(data as MemberNutritionTargetRow) }, 200);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return jsonResponse({ error: "保存中にエラーが発生しました", detail: message }, 500);
  }
}
