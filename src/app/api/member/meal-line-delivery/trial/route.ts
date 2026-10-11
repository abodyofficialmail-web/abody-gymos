import { jsonResponse } from "@/app/api/booking-v2/_cors";
import { getMemberIdFromCookie } from "@/app/api/member/_cookies";
import { mealLineDeliveryView, startMealLineDeliveryTrial } from "@/lib/mealLineDelivery";
import { loadMemberMealPersonalGate } from "@/lib/memberMealPersonalPass";
import { createSupabaseServiceClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function OPTIONS() {
  return jsonResponse({}, 200);
}

export async function POST() {
  try {
    const memberId = getMemberIdFromCookie();
    if (!memberId) return jsonResponse({ error: "未ログイン" }, 401);
    const supabase = createSupabaseServiceClient();
    const gate = await loadMemberMealPersonalGate(supabase, memberId);
    if (!gate || gate.is_active === false) return jsonResponse({ error: "未ログイン" }, 401);
    if (gate.full) {
      return jsonResponse({
        delivery: mealLineDeliveryView({ memberCode: gate.member_code, pass: gate.pass }),
        error: "配信はすでに有効です",
      }, 409);
    }

    const { data: member } = await supabase.from("members").select("line_user_id").eq("id", memberId).maybeSingle();
    if (!member?.line_user_id) {
      return jsonResponse({ error: "LINE連携後にお試しできます" }, 409);
    }

    const started = await startMealLineDeliveryTrial(supabase, memberId);
    if (!started.ok) {
      return jsonResponse({ error: started.error }, started.missingColumn ? 503 : 409);
    }
    return jsonResponse({
      delivery: mealLineDeliveryView({
        memberCode: gate.member_code,
        pass: gate.pass,
        trialStartedAt: new Date().toISOString(),
        trialEndsAt: started.trialEndsAt,
      }),
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return jsonResponse({ error: message }, 500);
  }
}
