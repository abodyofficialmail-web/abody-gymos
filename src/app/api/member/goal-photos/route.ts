import { getMemberIdFromCookie } from "@/app/api/member/_cookies";
import { parseGoalPhotoPaths, signGoalPhotoUrls } from "@/lib/goalHearingPhotos";
import { createSupabaseServiceClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

export async function GET() {
  try {
    const memberId = getMemberIdFromCookie();
    if (!memberId) return json({ error: "未ログイン" }, 401);

    const supabase = createSupabaseServiceClient();
    const { data: member, error: mErr } = await supabase
      .from("members")
      .select("id, is_active")
      .eq("id", memberId)
      .maybeSingle();
    if (mErr) return json({ error: "会員の取得に失敗しました", detail: mErr.message }, 500);
    if (!member || !member.is_active) return json({ error: "未ログイン" }, 401);

    const { data: response, error: respErr } = await supabase
      .from("goal_hearing_responses")
      .select("id, created_at, goal_photo_paths")
      .eq("member_id", memberId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (respErr) {
      const missing =
        respErr.message?.includes("goal_hearing_responses") && respErr.message?.includes("does not exist");
      if (missing) return json({ photos: [], response: null }, 200);
      return json({ error: "目標写真の取得に失敗しました", detail: respErr.message }, 500);
    }

    if (!response) return json({ photos: [], response: null }, 200);

    const photos = await signGoalPhotoUrls(supabase, response.goal_photo_paths);
    const photoCount = parseGoalPhotoPaths(response.goal_photo_paths).length;

    return json(
      {
        photos: photos.filter((p) => p.url),
        response: {
          id: response.id,
          created_at: response.created_at,
          photo_count: photoCount,
        },
      },
      200
    );
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return json({ error: "取得中にエラーが発生しました", detail: message }, 500);
  }
}
