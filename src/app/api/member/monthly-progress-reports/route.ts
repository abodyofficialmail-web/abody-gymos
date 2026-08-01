import { getMemberIdFromCookie } from "@/app/api/member/_cookies";
import { listMonthlyProgressReportsForMember } from "@/lib/monthlyProgressReports";
import { createSupabaseServiceClient } from "@/lib/supabase/admin";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

export async function GET() {
  try {
    const memberId = getMemberIdFromCookie();
    if (!memberId) return json({ error: "未ログイン" }, 401);

    const supabase = createSupabaseServiceClient();
    const { data: member, error: mErr } = await (supabase as any)
      .from("members")
      .select("id, is_active")
      .eq("id", memberId)
      .maybeSingle();
    if (mErr) return json({ error: "会員の取得に失敗しました", detail: mErr.message }, 500);
    if (!member || !member.is_active) return json({ error: "未ログイン" }, 401);

    const reports = await listMonthlyProgressReportsForMember(supabase, memberId);
    return json({ reports }, 200);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return json({ error: "取得中にエラーが発生しました", detail: message }, 500);
  }
}
