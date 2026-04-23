import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database } from "@/types/database";
import { jsonResponse } from "../_cors";

export async function OPTIONS() {
  return jsonResponse({}, 200);
}

const querySchema = z.object({
  member_code: z.string().min(1, "member_code は必須です"),
});

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const parsed = querySchema.safeParse({ member_code: url.searchParams.get("member_code") });
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

    const code = parsed.data.member_code.trim().toUpperCase();
    const { data: member, error } = await supabase
      .from("members")
      .select("id, member_code, name, is_active")
      .eq("member_code", code)
      .maybeSingle();

    if (error) {
      return jsonResponse({ error: "会員の取得に失敗しました", detail: error.message }, 500);
    }
    if (!member || !member.is_active) {
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

