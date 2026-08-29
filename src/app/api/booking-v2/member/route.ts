import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database } from "@/types/database";
import { jsonResponse } from "../_cors";

export async function OPTIONS() {
  return jsonResponse({}, 200);
}

const querySchema = z.object({
  email: z.string().min(1, "email は必須です").email("メールアドレスの形式が不正です"),
  store_id: z.string().uuid().optional(),
});

type MemberRow = {
  id: string;
  member_code: string;
  name: string | null;
  is_active: boolean | null;
  store_id?: string | null;
};

function pickActiveMember(rows: MemberRow[], storeId?: string): MemberRow | null {
  // メールは店舗を跨いで重複し得るため、予約作成 API と同じ優先順位で1件選ぶ
  if (storeId) {
    const home = rows.find((m) => m?.is_active && String(m?.store_id ?? "") === storeId);
    if (home) return home;
  }
  return rows.find((m) => m?.is_active) ?? null;
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const storeIdRaw = url.searchParams.get("store_id");
    const parsed = querySchema.safeParse({
      email: url.searchParams.get("email"),
      store_id: storeIdRaw && storeIdRaw.trim() ? storeIdRaw.trim() : undefined,
    });
    if (!parsed.success) {
      return jsonResponse({ error: "クエリが不正です", detail: parsed.error.flatten() }, 400);
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !serviceRoleKey) {
      return jsonResponse(
        {
          error:
            "サーバー設定が不足しています。NEXT_PUBLIC_SUPABASE_URL と SUPABASE_SERVICE_ROLE_KEY を設定してください。",
        },
        500
      );
    }

    const supabase = createClient<Database>(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const email = parsed.data.email.trim();
    const { data: rows, error } = await supabase
      .from("members")
      .select("id, member_code, name, is_active, store_id")
      .ilike("email", email)
      .limit(10);

    if (error) {
      return jsonResponse({ error: "会員の取得に失敗しました", detail: error.message }, 500);
    }

    const member = pickActiveMember((rows ?? []) as MemberRow[], parsed.data.store_id);
    if (!member) {
      return jsonResponse({ error: "会員が見つかりません" }, 404);
    }

    return jsonResponse(
      {
        member: {
          id: member.id,
          member_code: member.member_code,
          name: member.name ?? "",
        },
      },
      200
    );
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return jsonResponse({ error: "会員の取得中にエラーが発生しました", detail: message }, 500);
  }
}
