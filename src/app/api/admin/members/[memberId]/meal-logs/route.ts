import { jsonResponse } from "@/app/api/booking-v2/_cors";
import { loadMemberMealPersonalGate } from "@/lib/memberMealPersonalPass";
import { loadMealPersonalDashboard } from "@/lib/memberMealDashboard";
import { deleteMemberMealLogsByIds, tokyoTodayYmd, updateMemberMealLog } from "@/lib/memberMealLogs";
import { createSupabaseServiceClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function OPTIONS() {
  return jsonResponse({}, 200);
}

export async function GET(_request: Request, ctx: { params: { memberId: string } | Promise<{ memberId: string }> }) {
  try {
    const params = await ctx.params;
    const memberId = params.memberId?.trim();
    if (!memberId) return jsonResponse({ error: "memberId が不正です" }, 400);

    const supabase = createSupabaseServiceClient();
    const { data: member, error: memberErr } = await supabase
      .from("members")
      .select("id, member_code")
      .eq("id", memberId)
      .maybeSingle();
    if (memberErr) return jsonResponse({ error: "会員の取得に失敗しました", detail: memberErr.message }, 500);
    if (!member) return jsonResponse({ error: "会員が見つかりません" }, 404);

    const gate = await loadMemberMealPersonalGate(supabase, member.id);
    const today = tokyoTodayYmd();
    const data = await loadMealPersonalDashboard(supabase, member.id, today);
    return jsonResponse({
      enabled: Boolean(gate?.full),
      ...data,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return jsonResponse({ error: "取得中にエラーが発生しました", detail: message }, 500);
  }
}

export async function POST(req: Request, ctx: { params: { memberId: string } | Promise<{ memberId: string }> }) {
  try {
    const params = await ctx.params;
    const memberId = params.memberId?.trim();
    if (!memberId) return jsonResponse({ error: "memberId が不正です" }, 400);
    const raw = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    if (raw.action !== "update_macros" && raw.action !== "delete_meal") {
      return jsonResponse({ error: "action が不正です" }, 400);
    }
    const mealId = String(raw.meal_id ?? "").trim();
    if (!mealId) return jsonResponse({ error: "meal_id が不正です" }, 400);
    const supabase = createSupabaseServiceClient();
    const { data: member, error: memberErr } = await supabase
      .from("members")
      .select("id, member_code")
      .eq("id", memberId)
      .maybeSingle();
    if (memberErr) return jsonResponse({ error: "会員の取得に失敗しました", detail: memberErr.message }, 500);
    if (!member) return jsonResponse({ error: "会員が見つかりません" }, 404);
    const gate = await loadMemberMealPersonalGate(supabase, member.id);
    if (!gate?.full) {
      return jsonResponse({ error: "この機能は現在ご利用いただけません" }, 403);
    }
    if (raw.action === "delete_meal") {
      const deleted = await deleteMemberMealLogsByIds(supabase, member.id, [mealId]);
      if (!deleted.ok) return jsonResponse({ error: deleted.error }, 500);
      const today = tokyoTodayYmd();
      const data = await loadMealPersonalDashboard(supabase, member.id, today);
      return jsonResponse({ ok: true, applied: "deleted", ...data });
    }
    const kcal = Math.round(Number(raw.kcal));
    const proteinG = Number(raw.protein_g);
    const fatG = Number(raw.fat_g);
    const carbG = Number(raw.carb_g);
    if (![kcal, proteinG, fatG, carbG].every((n) => Number.isFinite(n))) {
      return jsonResponse({ error: "栄養値が不正です" }, 400);
    }
    const items = Array.isArray(raw.items) ? raw.items.map((x) => String(x).trim()).filter(Boolean) : undefined;
    const saved = await updateMemberMealLog(supabase, {
      memberId: member.id,
      mealId,
      items,
      kcal,
      proteinG,
      fatG,
      carbG,
      note: raw.note == null ? undefined : String(raw.note),
      source: "manual",
    });
    if (!saved.ok) return jsonResponse({ error: saved.error }, 500);
    const today = tokyoTodayYmd();
    const data = await loadMealPersonalDashboard(supabase, member.id, today);
    return jsonResponse({ ok: true, meal: saved.meal, ...data });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return jsonResponse({ error: "更新中にエラーが発生しました", detail: message }, 500);
  }
}
