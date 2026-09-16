import { jsonResponse } from "@/app/api/booking-v2/_cors";
import { getMemberIdFromCookie } from "@/app/api/member/_cookies";
import { getAppUrl } from "@/lib/constants";
import { loadMemberMealPersonalGate } from "@/lib/memberMealPersonalPass";
import { createSupabaseServiceClient } from "@/lib/supabase/admin";
import { createMealPersonalCheckoutUrl } from "@/lib/stripeMealPersonalPass";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function OPTIONS() {
  return jsonResponse({}, 200);
}

export async function GET() {
  try {
    const memberId = getMemberIdFromCookie();
    const app = getAppUrl();
    if (!memberId) {
      return Response.redirect(`${app}/login`, 302);
    }

    const supabase = createSupabaseServiceClient();
    const gate = await loadMemberMealPersonalGate(supabase, memberId);
    if (!gate || gate.is_active === false) {
      return jsonResponse({ error: "未ログイン" }, 401);
    }
    if (gate.full) {
      return Response.redirect(`${app}/meal-log`, 302);
    }

    const { data: member } = await supabase
      .from("members")
      .select("email, member_code")
      .eq("id", memberId)
      .maybeSingle();

    const checkoutUrl = await createMealPersonalCheckoutUrl({
      email: String((member as { email?: string | null } | null)?.email ?? ""),
      memberId,
      memberCode: String(member?.member_code ?? gate.member_code),
    });
    if (!checkoutUrl) {
      return jsonResponse({ error: "決済リンクが未設定です。STRIPE_MEAL_PERSONAL_PRICE_ID を設定してください" }, 503);
    }
    return Response.redirect(checkoutUrl, 302);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return jsonResponse({ error: "決済画面を開けませんでした", detail: message }, 500);
  }
}
