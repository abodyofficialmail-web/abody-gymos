import { z } from "zod";
import { createSupabaseServiceClient } from "@/lib/supabase/admin";
import { jsonResponse } from "@/app/api/booking-v2/_cors";

export async function OPTIONS() {
  return jsonResponse({}, 200);
}

const bodySchema = z.object({
  email: z
    .string()
    .trim()
    .max(254)
    .optional()
    .transform((v) => (v === "" ? null : v ?? null))
    .refine((v) => v === null || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), { message: "email が不正です" }),
});

export async function PATCH(request: Request, ctx: { params: { memberId: string } }) {
  try {
    const body = await request.json().catch(() => ({}));
    const parsed = bodySchema.safeParse(body);
    if (!parsed.success) {
      return jsonResponse({ error: "リクエストが不正です", detail: parsed.error.flatten() }, 400);
    }

    const supabase = createSupabaseServiceClient();
    const { data: member, error } = await (supabase as any)
      .from("members")
      .update({ email: parsed.data.email })
      .eq("id", ctx.params.memberId)
      .select("id, member_code, name, email, is_active, line_user_id")
      .maybeSingle();

    if (error) {
      const msg = String(error.message ?? "");
      if (msg.toLowerCase().includes("email")) {
        return jsonResponse(
          {
            error: "メール保存の準備ができていません（members.email カラムが未追加の可能性）",
            detail: error.message,
          },
          500
        );
      }
      return jsonResponse({ error: "更新に失敗しました", detail: error.message }, 500);
    }
    if (!member) return jsonResponse({ error: "会員が見つかりません" }, 404);

    return jsonResponse({ member }, 200);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return jsonResponse({ error: "更新中にエラーが発生しました", detail: message }, 500);
  }
}

