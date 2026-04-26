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
      .object({
        member_code: z.string().min(1),
        email: z.string().min(1),
      })
      .safeParse(body);
    if (!parsed.success) return json({ error: "リクエストが不正です", detail: parsed.error.flatten() }, 400);

    const member_code = parsed.data.member_code.trim().toUpperCase();
    const email = parsed.data.email.trim();
    if (!/^[A-Z]{3}\d{3}$/u.test(member_code)) return json({ error: "会員番号の形式が不正です" }, 400);

    const supabase = createSupabaseServiceClient();
    const { data: member, error } = await (supabase as any)
      .from("members")
      .select("id, is_active, email")
      .eq("member_code", member_code)
      .maybeSingle();

    if (error) return json({ error: "照会に失敗しました", detail: error.message }, 500);
    if (!member || !member.is_active) return json({ error: "ログインに失敗しました" }, 401);

    const dbEmail = String((member as any).email ?? "").trim();
    if (!dbEmail || dbEmail.toLowerCase() !== email.toLowerCase()) return json({ error: "ログインに失敗しました" }, 401);

    setMemberIdCookie(member.id);
    return json({ ok: true, member_id: member.id }, 200);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return json({ error: "エラーが発生しました", detail: message }, 500);
  }
}

