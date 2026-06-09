import { getMemberIdFromCookie } from "@/app/api/member/_cookies";
import { listBodyPhotoSetsForMember } from "@/lib/memberBodyPhotos";
import { createSupabaseServiceClient } from "@/lib/supabase/admin";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

export async function GET() {
  try {
    const memberId = getMemberIdFromCookie();
    if (!memberId) return json({ error: "未ログイン" }, 401);

    const supabase = createSupabaseServiceClient();
    const { data: member, error: mErr } = await (supabase as any)
      .from("members")
      .select("id, is_active")
      .eq("id", memberId)
      .maybeSingle();
    if (mErr) return json({ error: "会員の取得に失敗しました", detail: mErr.message }, 500);
    if (!member || !member.is_active) return json({ error: "未ログイン" }, 401);

    const sets = await listBodyPhotoSetsForMember(supabase, memberId);
    return json({ sets }, 200);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const isMissingTable = message.includes("member_body_photo_sets") && message.includes("does not exist");
    if (isMissingTable) return json({ sets: [] }, 200);
    return json({ error: "取得中にエラーが発生しました", detail: message }, 500);
  }
}
