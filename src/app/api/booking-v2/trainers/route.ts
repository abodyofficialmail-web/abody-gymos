import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database } from "@/types/database";
import { jsonResponse } from "../_cors";

export async function OPTIONS() {
  return jsonResponse({}, 200);
}

const querySchema = z
  .object({
    store_id: z.string().uuid("store_id は有効なUUIDである必要があります").optional(),
    /** 1 / true: 店舗に関係なくアクティブな全トレーナー（体験予約など） */
    all: z.enum(["1", "true", "yes"]).optional(),
  })
  .refine((d) => Boolean(d.store_id) || d.all === "1" || d.all === "true" || d.all === "yes", {
    message: "store_id または all=1 を指定してください",
  });

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const parsed = querySchema.safeParse({
      store_id: url.searchParams.get("store_id") ?? undefined,
      all: url.searchParams.get("all") ?? undefined,
    });
    if (!parsed.success) {
      return jsonResponse({ error: "クエリが不正です", detail: parsed.error.flatten() }, 400);
    }
    const { store_id, all } = parsed.data;
    const listAll = all === "1" || all === "true" || all === "yes";

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

    if (listAll) {
      const { data, error } = await supabase
        .from("trainers")
        .select("id, display_name, store_id, stores(name)")
        .eq("is_active", true)
        .order("created_at", { ascending: true });
      if (error) {
        return jsonResponse({ error: "トレーナー一覧の取得に失敗しました", detail: error.message }, 500);
      }
      const trainers = (data ?? []).map((t: any) => ({
        id: t.id as string,
        display_name: t.display_name as string,
        store_id: t.store_id as string,
        store_name: (t.stores && typeof t.stores === "object" && "name" in t.stores ? String((t.stores as { name: string }).name) : "") || "",
      }));
      return jsonResponse({ trainers }, 200);
    }

    const { data, error } = await supabase
      .from("trainers")
      .select("id, display_name, store_id")
      .eq("store_id", store_id!)
      .eq("is_active", true)
      .order("created_at", { ascending: true });
    if (error) {
      return jsonResponse({ error: "トレーナー一覧の取得に失敗しました", detail: error.message }, 500);
    }
    const trainers = (data ?? []).map((t: any) => ({
      id: t.id,
      display_name: t.display_name,
      store_id: t.store_id,
      store_name: "",
    }));
    return jsonResponse({ trainers }, 200);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return jsonResponse({ error: "トレーナー一覧の取得中にエラーが発生しました", detail: message }, 500);
  }
}
