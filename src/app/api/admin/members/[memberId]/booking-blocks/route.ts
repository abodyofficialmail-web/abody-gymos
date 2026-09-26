import { z } from "zod";
import { createSupabaseServiceClient } from "@/lib/supabase/admin";
import { jsonResponse } from "@/app/api/booking-v2/_cors";

export async function OPTIONS() {
  return jsonResponse({}, 200);
}

const postSchema = z.object({
  blocked_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u, "日付は YYYY-MM-DD です"),
  note: z.string().trim().max(200).optional().nullable(),
});

const deleteSchema = z.object({
  blocked_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u).optional(),
  id: z.string().uuid().optional(),
});

export async function POST(request: Request, ctx: { params: { memberId: string } }) {
  try {
    const parsed = postSchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) {
      return jsonResponse({ error: parsed.error.flatten().fieldErrors.blocked_date?.[0] ?? "リクエストが不正です" }, 400);
    }
    const supabase = createSupabaseServiceClient();
    const { data, error } = await (supabase as any)
      .from("member_booking_date_blocks")
      .upsert(
        {
          member_id: ctx.params.memberId,
          blocked_date: parsed.data.blocked_date,
          note: parsed.data.note ?? "スタッフ指定",
        },
        { onConflict: "member_id,blocked_date" }
      )
      .select("id, blocked_date, note, created_at")
      .maybeSingle();
    if (error) {
      const msg = String(error.message ?? "");
      if (/member_booking_date_blocks|does not exist|schema cache/i.test(msg)) {
        return jsonResponse(
          { error: "予約制限の保存準備ができていません（DBマイグレーション未適用の可能性）", detail: error.message },
          500
        );
      }
      return jsonResponse({ error: "保存に失敗しました", detail: error.message }, 500);
    }
    return jsonResponse({ ok: true, block: data }, 200);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return jsonResponse({ error: "保存中にエラーが発生しました", detail: message }, 500);
  }
}

export async function DELETE(request: Request, ctx: { params: { memberId: string } }) {
  try {
    const parsed = deleteSchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success || (!parsed.data.blocked_date && !parsed.data.id)) {
      return jsonResponse({ error: "削除対象を指定してください" }, 400);
    }
    const supabase = createSupabaseServiceClient();
    let q = (supabase as any).from("member_booking_date_blocks").delete().eq("member_id", ctx.params.memberId);
    if (parsed.data.id) q = q.eq("id", parsed.data.id);
    else q = q.eq("blocked_date", parsed.data.blocked_date);
    const { error } = await q;
    if (error) return jsonResponse({ error: "削除に失敗しました", detail: error.message }, 500);
    return jsonResponse({ ok: true }, 200);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return jsonResponse({ error: "削除中にエラーが発生しました", detail: message }, 500);
  }
}
