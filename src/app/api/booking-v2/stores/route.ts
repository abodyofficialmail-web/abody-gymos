import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { jsonResponse } from "../_cors";
export async function OPTIONS() {
  return jsonResponse({}, 200);
}
export async function GET() {
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !serviceRoleKey) {
      return jsonResponse(
        {
        error:
          "サーバー設定が不足しています。NEXT_PUBLIC_SUPABASE_URL と SUPABASE_SERVICE_ROLE_KEY を設定してください。",
        },
        500
      );
    }
    const supabase = createClient<Database>(url, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await supabase
      .from("stores")
      .select("id, name")
      .order("created_at", { ascending: true });
    if (error) {
      return jsonResponse({ error: "店舗一覧の取得に失敗しました", detail: error.message }, 500);
    }
    return jsonResponse({ stores: (data ?? []).map((s) => ({ id: s.id, name: s.name })) }, 200);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return jsonResponse(
      {
      error: "店舗一覧の取得中に予期しないエラーが発生しました",
      detail: message,
      },
      500
    );
  }
}
