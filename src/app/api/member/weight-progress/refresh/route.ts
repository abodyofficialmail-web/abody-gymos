import { getMemberIdFromCookie } from "../../_cookies";
import { refreshMemberWeightProgressAiComments } from "@/lib/weightProgress/loadMemberWeightProgress";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** 会員向け: AIコメントを事前生成してキャッシュする（表示は待たない用途／再読込前に呼ぶ） */
export async function POST(request: Request) {
  try {
    const memberId = getMemberIdFromCookie();
    if (!memberId) return json({ error: "未ログイン" }, 401);

    const body = await request.json().catch(() => ({}));
    const ym = typeof body?.year_month === "string" ? body.year_month : undefined;
    if (ym && !/^\d{4}-\d{2}$/.test(ym)) {
      return json({ error: "year_month は YYYY-MM 形式です" }, 400);
    }

    const result = await refreshMemberWeightProgressAiComments(memberId, ym);
    return json({ ok: true, ...result });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return json({ error: "AIコメント生成に失敗しました", detail: message }, 500);
  }
}
