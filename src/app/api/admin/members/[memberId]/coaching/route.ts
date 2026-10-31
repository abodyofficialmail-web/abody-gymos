import { z } from "zod";
import { createSupabaseServiceClient } from "@/lib/supabase/admin";
import { jsonResponse } from "@/app/api/booking-v2/_cors";

export async function OPTIONS() {
  return jsonResponse({}, 200);
}

const monthSchema = z.string().regex(/^\d{4}-\d{2}$/u, "month は YYYY-MM です");
const actionSchema = z.string().regex(/^(ticket|next_booking|proposal|motivation|imp_[0-9a-f]{8})$/u);

function missingTable(message: string): boolean {
  return /member_coaching_checks|does not exist|schema cache/i.test(message);
}

function rejectedActionKey(message: string): boolean {
  return /member_coaching_checks_action_chk/i.test(message);
}

export async function GET(request: Request, ctx: { params: { memberId: string } }) {
  const month = new URL(request.url).searchParams.get("month") ?? "";
  const parsed = monthSchema.safeParse(month);
  if (!parsed.success) return jsonResponse({ error: "month は YYYY-MM です" }, 400);
  try {
    const supabase = createSupabaseServiceClient();
    const { data, error } = await (supabase as any)
      .from("member_coaching_checks")
      .select("action_key, trainer_id, trainer_name, done_at")
      .eq("member_id", ctx.params.memberId)
      .eq("year_month", parsed.data);
    if (error) {
      if (missingTable(error.message)) return jsonResponse({ schema_ready: false, checks: [] }, 200);
      return jsonResponse({ error: error.message }, 500);
    }
    return jsonResponse({ schema_ready: true, checks: data ?? [] }, 200);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return jsonResponse({ error: "取得中にエラーが発生しました", detail: message }, 500);
  }
}

const bodySchema = z.object({
  month: monthSchema,
  action_key: actionSchema,
  done: z.boolean(),
  trainer_id: z.string().uuid().optional().nullable(),
});

export async function POST(request: Request, ctx: { params: { memberId: string } }) {
  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return jsonResponse({ error: "リクエストが不正です" }, 400);
  const { month, action_key, done, trainer_id } = parsed.data;
  if (done && !trainer_id) return jsonResponse({ error: "実施したトレーナーを選んでください" }, 400);
  try {
    const supabase = createSupabaseServiceClient();
    if (!done) {
      const removed = await (supabase as any)
        .from("member_coaching_checks")
        .delete()
        .eq("member_id", ctx.params.memberId)
        .eq("year_month", month)
        .eq("action_key", action_key);
      if (removed.error) {
        if (missingTable(removed.error.message)) return jsonResponse({ error: "実施記録のテーブルがまだありません" }, 503);
        if (rejectedActionKey(removed.error.message)) {
          return jsonResponse({ error: "個別の提案チェックを保存する更新がまだです" }, 503);
        }
        return jsonResponse({ error: removed.error.message }, 500);
      }
      return jsonResponse({ ok: true }, 200);
    }

    const trainer = await supabase.from("trainers").select("display_name").eq("id", trainer_id!).maybeSingle();
    if (trainer.error) return jsonResponse({ error: trainer.error.message }, 500);
    const trainerName = String(trainer.data?.display_name ?? "").trim();
    if (!trainerName) return jsonResponse({ error: "トレーナーが見つかりません" }, 400);

    const saved = await (supabase as any).from("member_coaching_checks").upsert(
      {
        member_id: ctx.params.memberId,
        year_month: month,
        action_key,
        trainer_id,
        trainer_name: trainerName,
        done_at: new Date().toISOString(),
      },
      { onConflict: "member_id,year_month,action_key" }
    );
    if (saved.error) {
      if (missingTable(saved.error.message)) return jsonResponse({ error: "実施記録のテーブルがまだありません" }, 503);
      if (rejectedActionKey(saved.error.message)) {
        return jsonResponse({ error: "個別の提案チェックを保存する更新がまだです" }, 503);
      }
      return jsonResponse({ error: saved.error.message }, 500);
    }
    return jsonResponse({ ok: true, trainer_name: trainerName }, 200);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return jsonResponse({ error: "保存中にエラーが発生しました", detail: message }, 500);
  }
}
