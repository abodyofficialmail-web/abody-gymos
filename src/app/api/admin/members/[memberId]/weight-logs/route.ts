import { jsonResponse } from "@/app/api/booking-v2/_cors";
import { isMemberWeightLogEnabled } from "@/lib/memberWeightLogRollout";
import { fetchOrBackfillNutritionTarget } from "@/lib/memberNutritionTargets";
import { buildWeightLogStats, listMemberWeightLogs, tokyoTodayYmd } from "@/lib/memberWeightLogs";
import { createSupabaseServiceClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function OPTIONS() {
  return jsonResponse({}, 200);
}

export async function GET(_request: Request, ctx: { params: { memberId: string } | Promise<{ memberId: string }> }) {
  try {
    const params = await ctx.params;
    const memberId = params.memberId?.trim();
    if (!memberId) return jsonResponse({ error: "memberId が不正です" }, 400);

    const supabase = createSupabaseServiceClient();
    const { data: member, error: memberErr } = await supabase
      .from("members")
      .select("id, member_code")
      .eq("id", memberId)
      .maybeSingle();
    if (memberErr) return jsonResponse({ error: "会員の取得に失敗しました", detail: memberErr.message }, 500);
    if (!member) return jsonResponse({ error: "会員が見つかりません" }, 404);

    const today = tokyoTodayYmd();
    const [listed, nutritionRes] = await Promise.all([
      listMemberWeightLogs(supabase, member.id, today),
      fetchOrBackfillNutritionTarget(supabase, member.id),
    ]);
    const nutrition = nutritionRes.ok ? nutritionRes.target : null;
    if (!listed.ok) {
      if (listed.missingTable) {
        return jsonResponse({
          enabled: isMemberWeightLogEnabled(member.member_code),
          today,
          today_log: null,
          logs: [],
          stats: buildWeightLogStats([], today),
          nutrition,
        });
      }
      return jsonResponse({ error: "体重記録の取得に失敗しました", detail: listed.error }, 500);
    }

    return jsonResponse({
      enabled: isMemberWeightLogEnabled(member.member_code),
      today,
      today_log: listed.logs.find((l) => l.log_date === today) ?? null,
      logs: listed.logs,
      stats: buildWeightLogStats(listed.logs, today),
      nutrition,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return jsonResponse({ error: "取得中にエラーが発生しました", detail: message }, 500);
  }
}
