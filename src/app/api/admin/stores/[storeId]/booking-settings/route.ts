import { z } from "zod";
import { createSupabaseServiceClient } from "@/lib/supabase/admin";
import { jsonResponse } from "@/app/api/booking-v2/_cors";

export async function OPTIONS() {
  return jsonResponse({}, 200);
}

const bodySchema = z.object({
  booking_cutoff_prev_day_time: z
    .string()
    .trim()
    .regex(/^\d{2}:\d{2}$/u, "HH:MM 形式で入力してください")
    .optional(),
});

export async function PATCH(request: Request, ctx: { params: { storeId: string } }) {
  try {
    const body = await request.json().catch(() => ({}));
    const parsed = bodySchema.safeParse(body);
    if (!parsed.success) return jsonResponse({ error: "リクエストが不正です", detail: parsed.error.flatten() }, 400);

    const supabase = createSupabaseServiceClient();
    const { data: store, error } = await (supabase as any)
      .from("stores")
      .update({
        booking_cutoff_prev_day_time: parsed.data.booking_cutoff_prev_day_time,
        updated_at: new Date().toISOString(),
      })
      .eq("id", ctx.params.storeId)
      .select("id, name, booking_cutoff_prev_day_time")
      .maybeSingle();

    if (error) return jsonResponse({ error: "更新に失敗しました", detail: error.message }, 500);
    if (!store) return jsonResponse({ error: "店舗が見つかりません" }, 404);
    return jsonResponse({ store }, 200);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return jsonResponse({ error: "更新中にエラーが発生しました", detail: message }, 500);
  }
}

