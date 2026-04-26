import { createSupabaseServiceClient } from "@/lib/supabase/admin";
import { getMemberIdFromCookie } from "../../../_cookies";

function json(body: any, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

export async function PATCH(_request: Request, ctx: { params: { reservationId: string } }) {
  try {
    const memberId = getMemberIdFromCookie();
    if (!memberId) return json({ error: "未ログイン" }, 401);

    const supabase = createSupabaseServiceClient();
    const { data: updated, error } = await (supabase as any)
      .from("reservations")
      .update({ status: "cancelled", updated_at: new Date().toISOString() })
      .eq("id", ctx.params.reservationId)
      .eq("member_id", memberId)
      .select("id, status")
      .maybeSingle();

    if (error) return json({ error: "キャンセルに失敗しました", detail: error.message }, 500);
    if (!updated) return json({ error: "予約が見つかりません" }, 404);

    return json({ ok: true, reservation: updated }, 200);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return json({ error: "エラーが発生しました", detail: message }, 500);
  }
}

