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
    let query = (supabase as any)
      .from("members")
      .select("id, member_code, name, email, line_user_id, is_active, store_id")
      .eq("is_active", true)
      .order("member_code", { ascending: true })
      .limit(limit);

    const keyword = q.trim();
    if (keyword) {
      // member_code / name / email を部分一致
      const escaped = keyword.replaceAll('"', '\\"');
      query = query.or(`member_code.ilike."%${escaped}%",name.ilike."%${escaped}%",email.ilike."%${escaped}%"`);
    }

    const { data, error } = await query;
    if (error) return jsonResponse({ error: "会員の検索に失敗しました", detail: error.message }, 500);
    return jsonResponse({ members: data ?? [] }, 200);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return jsonResponse({ error: "会員検索でエラーが発生しました", detail: message }, 500);
  }
}

