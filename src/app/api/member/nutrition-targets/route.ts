import { jsonResponse } from "@/app/api/booking-v2/_cors";
import { getMemberIdFromCookie } from "@/app/api/member/_cookies";
import { fetchOrBackfillNutritionTarget } from "@/lib/memberNutritionTargets";
import { createSupabaseServiceClient } from "@/lib/supabase/admin";

export async function OPTIONS() {
  return jsonResponse({}, 200);
}

export async function GET() {
  try {
    const memberId = getMemberIdFromCookie();
    if (!memberId) return jsonResponse({ error: "未ログイン" }, 401);

    const supabase = createSupabaseServiceClient();
    const { data: member, error: mErr } = await supabase
      .from("members")
      .select("id, is_active")
      .eq("id", memberId)
      .maybeSingle();
    if (mErr) return jsonResponse({ error: "会員の取得に失敗しました", detail: mErr.message }, 500);
    if (!member || !member.is_active) return jsonResponse({ error: "未ログイン" }, 401);

    const result = await fetchOrBackfillNutritionTarget(supabase, memberId);
    if (!result.ok) {
      if (result.missingTable) return jsonResponse({ target: null, hearing: { has_response: false, weight_missing: false } }, 200);
      return jsonResponse({ error: "栄養目標の取得に失敗しました", detail: result.error }, 500);
    }

    return jsonResponse({ target: result.target, hearing: result.hearing }, 200);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return jsonResponse({ error: "取得中にエラーが発生しました", detail: message }, 500);
  }
}
