import { z } from "zod";
import { issueMealPersonalLoginCode } from "@/lib/mealPersonalLoginCode";
import { createSupabaseServiceClient } from "@/lib/supabase/admin";

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
    const issued = await issueMealPersonalLoginCode(supabase, {
      email: parsed.data.email,
      displayName: parsed.data.display_name,
    });
    if (!issued.ok) return json({ error: issued.error }, issued.status);
    return json({ ok: true, verification_required: true }, 200);
  } catch (e) {
    const message = e instanceof Error ? e.message : "確認コードを送れませんでした";
    return json({ error: message }, 500);
  }
}
