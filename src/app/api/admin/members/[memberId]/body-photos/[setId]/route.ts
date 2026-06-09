import { jsonResponse } from "@/app/api/booking-v2/_cors";
import { deleteBodyPhotoSet } from "@/lib/memberBodyPhotos";
import { createSupabaseServiceClient } from "@/lib/supabase/admin";

export async function OPTIONS() {
  return jsonResponse({}, 200);
}

export async function DELETE(_request: Request, ctx: { params: { memberId: string; setId: string } }) {
  try {
    const memberId = ctx.params.memberId?.trim();
    const setId = ctx.params.setId?.trim();
    if (!memberId || !setId) return jsonResponse({ error: "パラメータが不正です" }, 400);

    const supabase = createSupabaseServiceClient();
    await deleteBodyPhotoSet(supabase, memberId, setId);
    return jsonResponse({ ok: true }, 200);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (message === "体型写真が見つかりません") {
      return jsonResponse({ error: message }, 404);
    }
    return jsonResponse({ error: "削除中にエラーが発生しました", detail: message }, 500);
  }
}
