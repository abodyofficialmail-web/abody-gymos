import { z } from "zod";
import { findMemberByEmail } from "@/lib/mealPersonalAccount";
import { isMealPersonalStandaloneAccount } from "@/lib/memberMealPersonalRollout";
import { createSupabaseServiceClient } from "@/lib/supabase/admin";
import { setMemberIdCookie } from "../../_cookies";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const parsed = z.object({ email: z.string().trim().email().max(200) }).safeParse(body);
    if (!parsed.success) return json({ error: "ログインIDのメールアドレスを入れてください" }, 400);

    const supabase = createSupabaseServiceClient();
    const member = await findMemberByEmail(supabase, parsed.data.email);
    if (member === "error") return json({ error: "照会に失敗しました" }, 500);
    if (member === "multiple" || !member || !isMealPersonalStandaloneAccount(member.member_code)) {
      return json({ error: "このメールアドレスの食事パーソナルアカウントはありません" }, 401);
    }
    setMemberIdCookie(member.id);
    return json({ ok: true, member_code: member.member_code }, 200);
  } catch (e) {
    const message = e instanceof Error ? e.message : "ログインに失敗しました";
    return json({ error: message }, 500);
  }
}
