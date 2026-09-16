import { z } from "zod";
import { jsonResponse } from "@/app/api/booking-v2/_cors";
import { getMemberIdFromCookie } from "@/app/api/member/_cookies";
import {
  fetchOrBackfillNutritionTarget,
  formPayloadFromGoalHearingResponse,
  loadNutritionProfile,
  nutritionProfileFromForm,
  upsertNutritionFromGoalHearing,
} from "@/lib/memberNutritionTargets";
import { createSupabaseServiceClient } from "@/lib/supabase/admin";

export async function OPTIONS() {
  return jsonResponse({}, 200);
}

async function requireActiveMember() {
  const memberId = getMemberIdFromCookie();
  if (!memberId) return { ok: false as const, status: 401, error: "未ログイン" };

  const supabase = createSupabaseServiceClient();
  const { data: member, error: mErr } = await supabase
    .from("members")
    .select("id, is_active")
    .eq("id", memberId)
    .maybeSingle();
  if (mErr) return { ok: false as const, status: 500, error: "会員の取得に失敗しました", detail: mErr.message };
  if (!member || !member.is_active) return { ok: false as const, status: 401, error: "未ログイン" };
  return { ok: true as const, supabase, memberId };
}

export async function GET() {
  try {
    const auth = await requireActiveMember();
    if (!auth.ok) return jsonResponse({ error: auth.error, detail: auth.detail }, auth.status);

    const result = await fetchOrBackfillNutritionTarget(auth.supabase, auth.memberId);
    const profile = await loadNutritionProfile(auth.supabase, auth.memberId);
    if (!result.ok) {
      if (result.missingTable) {
        return jsonResponse(
          { target: null, hearing: { has_response: false, weight_missing: false }, profile },
          200
        );
      }
      return jsonResponse({ error: "栄養目標の取得に失敗しました", detail: result.error }, 500);
    }

    return jsonResponse({ target: result.target, hearing: result.hearing, profile }, 200);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return jsonResponse({ error: "取得中にエラーが発生しました", detail: message }, 500);
  }
}

const postSchema = z.object({
  sex: z.enum(["female", "male"]),
  age_years: z.coerce.number().int().min(10).max(100),
  height_cm: z.coerce.number().min(100).max(250),
  current_weight_kg: z.coerce.number().min(20).max(300),
  target_weight_kg: z.union([z.number().min(20).max(300), z.null()]).optional(),
  activity_level: z.string().min(1).max(40),
  weight_direction: z.string().min(1).max(40),
  primary_goal: z.string().min(1).max(40),
  weight_pace: z.enum(["slow", "normal", "fast"]).nullable().optional(),
});

export async function POST(request: Request) {
  try {
    const auth = await requireActiveMember();
    if (!auth.ok) return jsonResponse({ error: auth.error, detail: auth.detail }, auth.status);

    const raw = await request.json().catch(() => ({}));
    const parsed = postSchema.safeParse(raw);
    if (!parsed.success) {
      return jsonResponse({ error: "性別・年齢・身長・いまの体重を確認してください", detail: parsed.error.flatten() }, 400);
    }

    const body = parsed.data;
    const form = formPayloadFromGoalHearingResponse({
      primary_goal: body.primary_goal,
      weight_direction: body.weight_direction,
      current_weight_kg: body.current_weight_kg,
      target_weight_kg: body.target_weight_kg ?? null,
      sex: body.sex,
      age_years: body.age_years,
      height_cm: body.height_cm,
      activity_level: body.activity_level,
    });
    if (!form) {
      return jsonResponse({ error: "入力内容を確認してください" }, 400);
    }

    const upserted = await upsertNutritionFromGoalHearing(auth.supabase, {
      memberId: auth.memberId,
      form,
      source: "manual",
      profile: {
        ...nutritionProfileFromForm(form),
        weight_pace: body.weight_pace ?? null,
      },
    });
    if (!upserted.ok) {
      if (upserted.skipped) {
        return jsonResponse({ error: "カロリーとPFCを出せませんでした。体重・身長・年齢を確認してください" }, 400);
      }
      return jsonResponse({ error: "保存に失敗しました", detail: upserted.error }, 500);
    }

    return jsonResponse({ ok: true, target: upserted.row }, 200);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return jsonResponse({ error: "保存中にエラーが発生しました", detail: message }, 500);
  }
}
