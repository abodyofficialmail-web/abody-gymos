import { jsonResponse } from "@/app/api/booking-v2/_cors";
import { parseGoalPhotoPaths, signGoalPhotoUrls } from "@/lib/goalHearingPhotos";
import { createSupabaseServiceClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function OPTIONS() {
  return jsonResponse({}, 200);
}

async function resolveMemberId(ctx: { params: { memberId: string } | Promise<{ memberId: string }> }) {
  const params = await ctx.params;
  return String(params?.memberId ?? "").trim();
}

export async function GET(_request: Request, ctx: { params: { memberId: string } }) {
  try {
    const memberId = await resolveMemberId(ctx);
    if (!memberId) return jsonResponse({ error: "memberId が不正です" }, 400);

    const supabase = createSupabaseServiceClient();
    const { data: member, error: memberErr } = await supabase
      .from("members")
      .select("id")
      .eq("id", memberId)
      .maybeSingle();
    if (memberErr) return jsonResponse({ error: "会員の取得に失敗しました", detail: memberErr.message }, 500);
    if (!member) return jsonResponse({ error: "会員が見つかりません" }, 404);

    const { data: response, error: respErr } = await supabase
      .from("goal_hearing_responses")
      .select("id, created_at, goal_photo_paths, primary_goal, secondary_goal, tertiary_goal")
      .eq("member_id", memberId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (respErr) {
      const missing =
        respErr.message?.includes("goal_hearing_responses") && respErr.message?.includes("does not exist");
      if (missing) {
        return jsonResponse({ photos: [], response: null, error: "goal_hearing_table_missing" }, 200);
      }
      return jsonResponse({ error: "目標ヒアリングの取得に失敗しました", detail: respErr.message }, 500);
    }

    if (!response) {
      return jsonResponse({ photos: [], response: null }, 200);
    }

    const photos = await signGoalPhotoUrls(supabase, response.goal_photo_paths);
    const photoCount = parseGoalPhotoPaths(response.goal_photo_paths).length;

    return jsonResponse(
      {
        photos: photos.filter((p) => p.url),
        photo_errors: photos.filter((p) => !p.url).map((p) => p.path),
        response: {
          id: response.id,
          created_at: response.created_at,
          photo_count: photoCount,
          primary_goal: response.primary_goal,
          secondary_goal: response.secondary_goal,
          tertiary_goal: response.tertiary_goal,
        },
      },
      200
    );
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return jsonResponse({ error: "取得中にエラーが発生しました", detail: message }, 500);
  }
}
