import { jsonResponse } from "@/app/api/booking-v2/_cors";
import { refreshMemberWeightProgressAiComments } from "@/lib/weightProgress/loadMemberWeightProgress";

export async function OPTIONS() {
  return jsonResponse({}, 200);
}

/** 事前生成（表示はキャッシュ読込のみ。このAPIで裏生成する） */
export async function POST(request: Request, ctx: { params: { memberId: string } }) {
  try {
    const memberId = ctx.params.memberId;
    if (!memberId) return jsonResponse({ error: "memberId が必要です" }, 400);
    const body = await request.json().catch(() => ({}));
    const ym = typeof body?.year_month === "string" ? body.year_month : undefined;
    if (ym && !/^\d{4}-\d{2}$/.test(ym)) {
      return jsonResponse({ error: "year_month は YYYY-MM 形式です" }, 400);
    }
    const result = await refreshMemberWeightProgressAiComments(memberId, ym);
    return jsonResponse({ ok: true, ...result }, 200);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return jsonResponse({ error: "AIコメント生成に失敗しました", detail: message }, 500);
  }
}
