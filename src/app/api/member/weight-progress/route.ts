import { getMemberIdFromCookie } from "../_cookies";
import { loadMemberWeightProgress } from "@/lib/weightProgress/loadMemberWeightProgress";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export async function GET(request: Request) {
  try {
    const memberId = getMemberIdFromCookie();
    if (!memberId) return json({ error: "未ログイン" }, 401);

    const url = new URL(request.url);
    const ym = url.searchParams.get("year_month") || undefined;
    if (ym && !/^\d{4}-\d{2}$/.test(ym)) {
      return json({ error: "year_month は YYYY-MM 形式です" }, 400);
    }

    const bundle = await loadMemberWeightProgress(memberId, ym);
    return json(bundle);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return json({ error: "重量進捗の取得に失敗しました", detail: message }, 500);
  }
}
