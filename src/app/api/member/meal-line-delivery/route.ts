import { jsonResponse } from "@/app/api/booking-v2/_cors";
import { getMemberIdFromCookie } from "@/app/api/member/_cookies";
import { fetchMealLineDeliveryTrial, mealLineDeliveryView } from "@/lib/mealLineDelivery";
import { loadMemberMealPersonalGate } from "@/lib/memberMealPersonalPass";
import { createSupabaseServiceClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function OPTIONS() {
  return jsonResponse({}, 200);
}

export async function GET() {
  try {
    const memberId = getMemberIdFromCookie();
    if (!memberId) return jsonResponse({ error: "未ログイン" }, 401);
    const supabase = createSupabaseServiceClient();
    const gate = await loadMemberMealPersonalGate(supabase, memberId);
    if (!gate || gate.is_active === false) return jsonResponse({ error: "未ログイン" }, 401);
    const trial = await fetchMealLineDeliveryTrial(supabase, memberId);
    if (!trial.ok) return jsonResponse({ error: trial.error }, 500);
    return jsonResponse({
      delivery: mealLineDeliveryView({
        memberCode: gate.member_code,
        pass: gate.pass,
        trialStartedAt: trial.row.trialStartedAt,
        trialEndsAt: trial.row.trialEndsAt,
      }),
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return jsonResponse({ error: message }, 500);
  }
}
