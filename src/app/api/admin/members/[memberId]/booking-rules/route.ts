import { z } from "zod";
import { createSupabaseServiceClient } from "@/lib/supabase/admin";
import { jsonResponse } from "@/app/api/booking-v2/_cors";
import { MEMBERSHIP_PLANS } from "@/lib/memberPlans";
import {
  loadMemberBookingRuleContext,
  snapshotFromContext,
} from "@/lib/booking/memberBookingRulesDb";

export async function OPTIONS() {
  return jsonResponse({}, 200);
}

const patchSchema = z.object({
  membership_plan: z.union([z.enum(MEMBERSHIP_PLANS), z.null()]).optional(),
});

export async function GET(_request: Request, ctx: { params: { memberId: string } }) {
  try {
    const supabase = createSupabaseServiceClient();
    const nowIso = new Date().toISOString();
    const loaded = await loadMemberBookingRuleContext(supabase, { memberId: ctx.params.memberId, nowIso });
    const blocks = await (supabase as any)
      .from("member_booking_date_blocks")
      .select("id, blocked_date, note, created_at")
      .eq("member_id", ctx.params.memberId)
      .order("blocked_date", { ascending: true });
    const ledger = await (supabase as any)
      .from("member_ticket_ledger")
      .select("id, delta, reason, note, created_at")
      .eq("member_id", ctx.params.memberId)
      .order("created_at", { ascending: false })
      .limit(20);

    return jsonResponse({
      schema_ready: loaded.schemaReady,
      snapshot: snapshotFromContext(loaded, nowIso),
      blocks: blocks.error ? [] : blocks.data ?? [],
      tickets: ledger.error ? [] : ledger.data ?? [],
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return jsonResponse({ error: "取得に失敗しました", detail: message }, 500);
  }
}

export async function PATCH(request: Request, ctx: { params: { memberId: string } }) {
  try {
    const parsed = patchSchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) return jsonResponse({ error: "リクエストが不正です" }, 400);
    if (parsed.data.membership_plan === undefined) {
      return jsonResponse({ error: "更新項目がありません" }, 400);
    }

    const supabase = createSupabaseServiceClient();
    const { error } = await (supabase as any)
      .from("members")
      .update({
        membership_plan: parsed.data.membership_plan,
        updated_at: new Date().toISOString(),
      })
      .eq("id", ctx.params.memberId);
    if (error) {
      const msg = String(error.message ?? "");
      if (/membership_plan|does not exist|schema cache/i.test(msg)) {
        return jsonResponse(
          { error: "プラン保存の準備ができていません（DBマイグレーション未適用の可能性）", detail: error.message },
          500
        );
      }
      return jsonResponse({ error: "更新に失敗しました", detail: error.message }, 500);
    }
    return jsonResponse({ ok: true, membership_plan: parsed.data.membership_plan }, 200);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return jsonResponse({ error: "更新中にエラーが発生しました", detail: message }, 500);
  }
}
