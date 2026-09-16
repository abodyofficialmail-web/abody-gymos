import { jsonResponse } from "@/app/api/booking-v2/_cors";
import { loadMemberWeightProgress } from "@/lib/weightProgress/loadMemberWeightProgress";

export async function OPTIONS() {
  return jsonResponse({}, 200);
}

export async function GET(request: Request, ctx: { params: { memberId: string } }) {
  try {
    const memberId = ctx.params.memberId;
    if (!memberId) return jsonResponse({ error: "memberId が必要です" }, 400);

    const url = new URL(request.url);
    const ym = url.searchParams.get("year_month") || undefined;
    if (ym && !/^\d{4}-\d{2}$/.test(ym)) {
      return jsonResponse({ error: "year_month は YYYY-MM 形式です" }, 400);
    }

    const bundle = await loadMemberWeightProgress(memberId, ym);
    return jsonResponse(bundle, 200);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return jsonResponse({ error: "重量進捗の取得に失敗しました", detail: message }, 500);
  }
}
