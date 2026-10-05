import { z } from "zod";
import { verifyMealPersonalLoginCode } from "@/lib/mealPersonalLoginCode";
import { createSupabaseServiceClient } from "@/lib/supabase/admin";
import { setMemberIdCookie } from "../../_cookies";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const parsed = z
      .object({
        email: z.string().trim().email().max(200),
        code: z.string().trim().min(6).max(6),
      })
      .safeParse(body);
    if (!parsed.success) return json({ error: "メールアドレスと6桁の確認コードを入れてください" }, 400);

    const supabase = createSupabaseServiceClient();
    const verified = await verifyMealPersonalLoginCode(supabase, parsed.data);
    if (!verified.ok) return json({ error: verified.error }, verified.status);
    setMemberIdCookie(verified.memberId);
    return json({ ok: true, member_code: verified.memberCode }, 200);
  } catch (e) {
    const message = e instanceof Error ? e.message : "確認に失敗しました";
    const status = /ジムの会員|別のアドレス|使えません/.test(message) ? 409 : 500;
    return json({ error: message }, status);
  }
}
