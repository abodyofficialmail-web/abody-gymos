import { z } from "zod";
import { createSupabaseServiceClient } from "@/lib/supabase/admin";
import { jsonResponse } from "@/app/api/booking-v2/_cors";
import { applyTicketDelta } from "@/lib/booking/memberBookingRulesDb";

export async function OPTIONS() {
  return jsonResponse({}, 200);
}

const bodySchema = z.object({
  delta: z.number().int().refine((n) => n !== 0, "増減は0以外にしてください"),
  note: z.string().trim().max(200).optional().nullable(),
});

export async function POST(request: Request, ctx: { params: { memberId: string } }) {
  try {
    const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) {
      const first = parsed.error.flatten().formErrors[0] ?? parsed.error.flatten().fieldErrors.delta?.[0];
      return jsonResponse({ error: first ?? "リクエストが不正です" }, 400);
    }
    const supabase = createSupabaseServiceClient();
    const result = await applyTicketDelta(supabase, {
      memberId: ctx.params.memberId,
      delta: parsed.data.delta,
      reason: parsed.data.delta > 0 ? "staff_grant" : "staff_adjust",
      note: parsed.data.note ?? (parsed.data.delta > 0 ? "スタッフ付与" : "スタッフ調整"),
    });
    if (!result.ok) return jsonResponse({ error: result.error ?? "更新に失敗しました" }, 400);
    return jsonResponse({ ok: true, bonus_ticket_koma: result.ticketKoma }, 200);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return jsonResponse({ error: "更新中にエラーが発生しました", detail: message }, 500);
  }
}
