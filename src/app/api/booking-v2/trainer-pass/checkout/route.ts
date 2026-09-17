import { jsonResponse } from "../../_cors";
import { createTrainerVisibilityCheckoutUrl } from "@/lib/stripeTrainerPass";
import { fetchTrainerVisibilityPassForEmail, memberCodesMatch } from "@/lib/trainerVisibilityPass";
import { createSupabaseServiceClient } from "@/lib/supabase/admin";

export async function OPTIONS() {
  return jsonResponse({}, 200);
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const email = String(url.searchParams.get("email") ?? "").trim();
    const memberCode = String(url.searchParams.get("member_code") ?? "").trim();
    if (!email) {
      return jsonResponse({ error: "課金する前に、会員登録のメールアドレスを入力してください" }, 400);
    }
    if (!memberCode) {
      return jsonResponse({ error: "課金する前に、会員番号も入力してください" }, 400);
    }

    const supabase = createSupabaseServiceClient();
    const found = await fetchTrainerVisibilityPassForEmail(supabase, email);
    if (!found) {
      return jsonResponse({ error: "このメールの会員が見つかりません。会員登録と同じメールを入力してください" }, 404);
    }
    if (!memberCodesMatch(found.memberCode, memberCode)) {
      return jsonResponse({ error: "メールと会員番号が同じ会員ではありません。両方とも登録内容と同じものを入力してください" }, 400);
    }

    const checkoutUrl = await createTrainerVisibilityCheckoutUrl({
      email,
      memberId: found.memberId,
      memberCode: found.memberCode,
    });
    if (!checkoutUrl) {
      return jsonResponse({ error: "決済リンクが未設定です" }, 500);
    }
    return Response.redirect(checkoutUrl, 302);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return jsonResponse({ error: "決済画面を開けませんでした", detail: message }, 500);
  }
}
