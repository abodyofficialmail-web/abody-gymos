import { z } from "zod";
import { createMealPersonalAccount } from "@/lib/mealPersonalAccount";
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
        display_name: z.string().trim().min(1).max(20),
        email: z.string().trim().email().max(200),
      })
      .safeParse(body);
    if (!parsed.success) return json({ error: "ニックネームとメールアドレスを確認してください" }, 400);

    const supabase = createSupabaseServiceClient();
    const account = await createMealPersonalAccount(supabase, {
      displayName: parsed.data.display_name,
      email: parsed.data.email,
    });
    setMemberIdCookie(account.id);
    return json({ ok: true, member_code: account.member_code, created: account.created }, 200);
  } catch (e) {
    const message = e instanceof Error ? e.message : "アカウントの作成に失敗しました";
    const status = /ジムの会員|使えません|別のアドレス/.test(message) ? 409 : 500;
    return json({ error: message }, status);
  }
}
