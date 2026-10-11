import { jsonResponse } from "@/app/api/booking-v2/_cors";
import { fetchMealLineDeliveryTrial, mealLineDeliveryView, setMealLineDeliveryStaffEnabled } from "@/lib/mealLineDelivery";
import { loadMemberMealPersonalGate } from "@/lib/memberMealPersonalPass";
import { createSupabaseServiceClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function OPTIONS() {
  return jsonResponse({}, 200);
}

async function deliveryState(memberId: string) {
  const supabase = createSupabaseServiceClient();
  const gate = await loadMemberMealPersonalGate(supabase, memberId);
  if (!gate) return { status: 404 as const, body: { error: "会員が見つかりません" } };
  const { data: member, error: memberErr } = await supabase
    .from("members")
    .select("line_user_id")
    .eq("id", memberId)
    .maybeSingle();
  if (memberErr) return { status: 500 as const, body: { error: "会員の取得に失敗しました", detail: memberErr.message } };
  const trial = await fetchMealLineDeliveryTrial(supabase, memberId);
  if (!trial.ok) return { status: 500 as const, body: { error: trial.error } };
  const view = mealLineDeliveryView({
    memberCode: gate.member_code,
    pass: gate.pass,
    trialStartedAt: trial.row.trialStartedAt,
    trialEndsAt: trial.row.trialEndsAt,
  });
  return {
    status: 200 as const,
    body: {
      enabled: view.entitled,
      line_linked: Boolean(member?.line_user_id),
      staff_controlled: view.staff_controlled,
    },
  };
}

export async function GET(_request: Request, ctx: { params: { memberId: string } | Promise<{ memberId: string }> }) {
  try {
    const params = await ctx.params;
    const memberId = params.memberId?.trim();
    if (!memberId) return jsonResponse({ error: "memberId が不正です" }, 400);
    const result = await deliveryState(memberId);
    return jsonResponse(result.body, result.status);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return jsonResponse({ error: "取得中にエラーが発生しました", detail: message }, 500);
  }
}

export async function PATCH(request: Request, ctx: { params: { memberId: string } | Promise<{ memberId: string }> }) {
  try {
    const params = await ctx.params;
    const memberId = params.memberId?.trim();
    if (!memberId) return jsonResponse({ error: "memberId が不正です" }, 400);
    const raw = (await request.json().catch(() => ({}))) as { enabled?: unknown };
    if (typeof raw.enabled !== "boolean") return jsonResponse({ error: "enabled が不正です" }, 400);

    const supabase = createSupabaseServiceClient();
    const gate = await loadMemberMealPersonalGate(supabase, memberId);
    if (!gate) return jsonResponse({ error: "会員が見つかりません" }, 404);
    const saved = await setMealLineDeliveryStaffEnabled(supabase, memberId, raw.enabled);
    if (!saved.ok) {
      return jsonResponse({ error: saved.error }, saved.missingColumn ? 503 : 500);
    }
    const result = await deliveryState(memberId);
    return jsonResponse(result.body, result.status);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return jsonResponse({ error: "保存中にエラーが発生しました", detail: message }, 500);
  }
}
