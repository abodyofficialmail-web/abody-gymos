import { createSupabaseServiceClient } from "@/lib/supabase/admin";
import { jsonResponse } from "@/app/api/booking-v2/_cors";

export async function OPTIONS() {
  return jsonResponse({}, 200);
}

export async function GET(_request: Request, ctx: { params: { memberId: string } }) {
  try {
    const supabase = createSupabaseServiceClient();

    const { data: member, error } = await (supabase as any)
      .from("members")
      .select("id, member_code, name, email, is_active, line_user_id")
      .eq("id", ctx.params.memberId)
      .maybeSingle();

    if (error) return jsonResponse({ error: "取得に失敗しました", detail: error.message }, 500);
    if (!member) return jsonResponse({ error: "会員が見つかりません" }, 404);

    return jsonResponse({ member }, 200);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return jsonResponse({ error: "取得中にエラーが発生しました", detail: message }, 500);
  }
}
