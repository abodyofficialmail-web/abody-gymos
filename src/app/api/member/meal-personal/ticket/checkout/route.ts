import { jsonResponse } from "@/app/api/booking-v2/_cors";
import { getMemberIdFromCookie } from "@/app/api/member/_cookies";
import { createMealSessionTicketCheckoutUrl, mealSessionTicketCheckoutReady } from "@/lib/mealSessionTicket";
import { isMealPersonalStandaloneAccount } from "@/lib/memberMealPersonalRollout";
import { createSupabaseServiceClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const memberId = getMemberIdFromCookie();
    if (!memberId) return jsonResponse({ error: "未ログイン" }, 401);
    if (!mealSessionTicketCheckoutReady()) {
      return jsonResponse({ error: "チケット決済の準備ができていません" }, 503);
    }
    const supabase = createSupabaseServiceClient();
    const { data: member, error } = await supabase
      .from("members")
      .select("email, member_code")
      .eq("id", memberId)
      .maybeSingle();
    if (error || !member) return jsonResponse({ error: "会員が見つかりません" }, 404);
    if (!isMealPersonalStandaloneAccount(member.member_code)) {
      return jsonResponse({ error: "食事パーソナルのアカウントだけで買えます" }, 403);
    }
    const url = await createMealSessionTicketCheckoutUrl({
      memberId,
      memberCode: member.member_code,
      email: member.email,
    });
    if (!url) return jsonResponse({ error: "決済画面を開けませんでした" }, 503);
    return jsonResponse({ ok: true, url }, 200);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return jsonResponse({ error: message }, 500);
  }
}
