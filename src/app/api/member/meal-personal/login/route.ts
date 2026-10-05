import { z } from "zod";
import { findMemberByEmail } from "@/lib/mealPersonalAccount";
import { issueMealPersonalLoginCode } from "@/lib/mealPersonalLoginCode";
import { isMealPersonalStandaloneAccount } from "@/lib/memberMealPersonalRollout";
import { createSupabaseServiceClient } from "@/lib/supabase/admin";

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
    const issued = await issueMealPersonalLoginCode(supabase, { email: parsed.data.email });
    if (!issued.ok) return json({ error: issued.error }, issued.status);
    return json({ ok: true, verification_required: true }, 200);
  } catch (e) {
    const message = e instanceof Error ? e.message : "確認コードを送れませんでした";
    return json({ error: message }, 500);
  }
}
