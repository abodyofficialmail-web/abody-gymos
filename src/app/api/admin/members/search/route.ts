import { z } from "zod";
import { createSupabaseServiceClient } from "@/lib/supabase/admin";
import { jsonResponse } from "@/app/api/booking-v2/_cors";

export async function OPTIONS() {
  return jsonResponse({}, 200);
}

const querySchema = z.object({
  q: z.string().trim().optional().default(""),
  limit: z.coerce.number().int().min(1).max(50).optional().default(20),
});

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const parsed = querySchema.safeParse({
      q: url.searchParams.get("q") ?? "",
      limit: url.searchParams.get("limit") ?? undefined,
    });
    if (!parsed.success) {
      return jsonResponse({ error: "クエリが不正です", detail: parsed.error.flatten() }, 400);
    }
    const { q, limit } = parsed.data;
    const supabase = createSupabaseServiceClient();

    // 基本はアクティブ会員のみ（カルテ用途）
    // NOTE: or検索は supabase の `or()` 文字列で実装
    let includeProposed = true;
    const runQuery = (withProposed: boolean) => {
      const cols = "id, member_code, name, email, line_user_id, is_active, store_id" + (withProposed ? ", booking_stop_proposed" : "");
      return (supabase as any).from("members").select(cols).eq("is_active", true).order("member_code", { ascending: true }).limit(limit);
    };
    let query = runQuery(includeProposed);

    const keyword = q.trim();
    if (keyword) {
      // member_code / name / email を部分一致
      const escaped = keyword.replaceAll('"', '\\"');
      query = query.or(`member_code.ilike."%${escaped}%",name.ilike."%${escaped}%",email.ilike."%${escaped}%"`);
    }

    let { data, error } = await query;
    if (error && includeProposed && /booking_stop_proposed|does not exist|schema cache/i.test(String(error.message ?? ""))) {
      includeProposed = false;
      query = runQuery(false);
      const keywordRetry = q.trim();
      if (keywordRetry) {
        const escapedRetry = keywordRetry.replaceAll('"', '\\"');
        query = query.or(`member_code.ilike."%${escapedRetry}%",name.ilike."%${escapedRetry}%",email.ilike."%${escapedRetry}%"`);
      }
      const second = await query;
      data = second.data;
      error = second.error;
    }
    if (error) return jsonResponse({ error: "会員の検索に失敗しました", detail: error.message }, 500);

    const members = (data ?? []) as Array<{ id: string; booking_stop_proposed?: boolean | null }>;
    const datesByMember = new Map<string, string[]>();
    const memberIds = members.map((m) => m.id).filter(Boolean);
    if (memberIds.length > 0) {
      const todayYmd = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Tokyo" });
      const blocks = await (supabase as any)
        .from("member_booking_date_blocks")
        .select("member_id, blocked_date")
        .in("member_id", memberIds)
        .gte("blocked_date", todayYmd);
      if (!blocks.error) {
        for (const row of blocks.data ?? []) {
          const memberId = String(row.member_id ?? "");
          const ymd = String(row.blocked_date ?? "").slice(0, 10);
          if (!memberId || !ymd) continue;
          const list = datesByMember.get(memberId) ?? [];
          list.push(ymd);
          datesByMember.set(memberId, list);
        }
      }
    }
    return jsonResponse({
      members: members.map((m) => ({
        ...m,
        booking_stop_proposed: Boolean(m.booking_stop_proposed),
        booking_stop_dates: datesByMember.get(m.id) ?? [],
      })),
    }, 200);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return jsonResponse({ error: "会員検索でエラーが発生しました", detail: message }, 500);
  }
}

