import { z } from "zod";
import { createSupabaseServiceClient } from "@/lib/supabase/admin";
import { setMemberIdCookie } from "../_cookies";

function json(body: any, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const parsed = z
      .object({ line_user_id: z.string().min(1) })
      .safeParse(body);
    if (!parsed.success) return json({ error: "リクエストが不正です", detail: parsed.error.flatten() }, 400);

    const supabase = createSupabaseServiceClient();
    const { data: member, error } = await (supabase as any)
      .from("members")
      .select("id, is_active")
      .eq("line_user_id", parsed.data.line_user_id)
      .maybeSingle();

    if (error) return json({ error: "照会に失敗しました", detail: error.message }, 500);
    if (!member || !member.is_active) {
      return json(
        {
          error: "未紐付けです",
          code: "NOT_LINKED",
          message: "LINE連携が必要です。会員番号のログインから連携してください。",
        },
        404
      );
    }

    setMemberIdCookie(member.id);
    return json({ ok: true, member_id: member.id }, 200);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return json({ error: "エラーが発生しました", detail: message }, 500);
  }
}

