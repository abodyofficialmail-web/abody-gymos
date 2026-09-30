import { jsonResponse } from "@/app/api/booking-v2/_cors";
import { loadMealPersonalDashboard } from "@/lib/memberMealDashboard";
import {
  buildMealDaySummary,
  buildMealFeedbackLineMessage,
  generateMealTrainerFeedback,
} from "@/lib/memberMealTrainerFeedback";
import { pushLineTextForMember } from "@/lib/lineMessagingPush";
import { normalizeLineChannelKey } from "@/lib/lineChannel";
import { createSupabaseServiceClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

type Body = {
  action?: string;
  feedback?: string;
  instruction?: string;
};

async function loadMember(memberId: string) {
  const supabase = createSupabaseServiceClient();
  const { data: member, error } = await supabase
    .from("members")
    .select("id, member_code, line_user_id, line_channel_key")
    .eq("id", memberId)
    .maybeSingle();
  return { supabase, member, error };
}

export async function POST(req: Request, ctx: { params: { memberId: string } | Promise<{ memberId: string }> }) {
  try {
    const params = await ctx.params;
    const memberId = params.memberId?.trim();
    if (!memberId) return jsonResponse({ error: "memberId が不正です" }, 400);
    const body = (await req.json().catch(() => ({}))) as Body;
    const action = body.action;
    if (action !== "draft" && action !== "revise" && action !== "send") {
      return jsonResponse({ error: "action が不正です" }, 400);
    }

    const { supabase, member, error } = await loadMember(memberId);
    if (error) return jsonResponse({ error: "会員の取得に失敗しました", detail: error.message }, 500);
    if (!member) return jsonResponse({ error: "会員が見つかりません" }, 404);

    const dash = await loadMealPersonalDashboard(supabase, member.id);
    const summary = buildMealDaySummary({
      date: dash.today,
      meals: dash.today_meals,
      totals: dash.totals,
      target: dash.nutrition,
    });

    if (action === "send") {
      const feedback = String(body.feedback ?? "").trim();
      if (!feedback) return jsonResponse({ error: "フィードバックが空です" }, 400);
      if (dash.today_meals.length === 0) return jsonResponse({ error: "今日の食事記録がありません" }, 400);
      const lineUserId = String(member.line_user_id ?? "").trim();
      if (!lineUserId) return jsonResponse({ error: "この会員はLINE連携がありません" }, 400);
      const text = buildMealFeedbackLineMessage(summary, feedback);
      const sent = await pushLineTextForMember({
        toUserId: lineUserId,
        text,
        memberCode: member.member_code,
        lineChannelKey: normalizeLineChannelKey(member.line_channel_key),
        storeName: dash.store_name,
      });
      if (!sent.ok) {
        return jsonResponse({ error: "LINEの送信に失敗しました", detail: sent.body ?? "" }, 502);
      }
      return jsonResponse({ ok: true, summary, feedback });
    }

    const generated = await generateMealTrainerFeedback({
      summary,
      totals: dash.totals,
      target: dash.nutrition,
      current: action === "revise" ? String(body.feedback ?? "") : undefined,
      instruction: action === "revise" ? String(body.instruction ?? "") : undefined,
    });
    if (action === "revise" && !generated.ai) {
      return jsonResponse(
        { error: "AIでの修正がいま使えません。フィードバック欄を直接編集してください。" },
        503
      );
    }
    return jsonResponse({ ok: true, summary, feedback: generated.feedback, ai: generated.ai });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return jsonResponse({ error: "フィードバックの処理に失敗しました", detail: message }, 500);
  }
}
