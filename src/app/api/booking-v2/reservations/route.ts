import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database } from "@/types/database";
import type { SupabaseClient } from "@supabase/supabase-js";
import { jsonResponse } from "../_cors";
const bodySchema = z.object({
  store_id: z.string().uuid("store_id は有効なUUIDである必要があります"),
  member_code: z.string().min(1, "member_code は必須です"),
  start_at: z.string().min(1, "start_at は必須です"),
  end_at: z.string().min(1, "end_at は必須です"),
});
function createServiceSupabase(): SupabaseClient<Database> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL または SUPABASE_SERVICE_ROLE_KEY が未設定です。"
    );
  }
  return createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
export async function OPTIONS() {
  return jsonResponse({}, 200);
}
/**
 * リクエスト body: { store_id, member_code, start_at, end_at }
 * DBの reservations は member_id 必須のため、member_code から members を引いてから insert します。
 */
export async function POST(request: Request) {
  console.log("① API入った");
  try {
    const raw = await request.json().catch(() => null);
    console.log("② body取得", raw);
    const parsed = bodySchema.safeParse(raw);
    if (!parsed.success) {
      return jsonResponse(
        { error: "リクエストが不正です", detail: parsed.error.flatten() },
        400
      );
    }
    const { store_id, member_code, start_at, end_at } = parsed.data;
    const code = member_code.trim();
    let supabase: SupabaseClient<Database>;
    try {
      supabase = createServiceSupabase();
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return jsonResponse({ error: "サーバー設定エラー", detail: message }, 500);
    }
    const { data: member, error: memberErr } = await supabase
      .from("members")
      .select("id, member_code, is_active")
      .eq("member_code", code)
      .maybeSingle();
    if (memberErr) {
      return jsonResponse(
        { error: "会員の照会に失敗しました", detail: memberErr.message },
        500
      );
    }
    if (!member || !member.is_active) {
      return jsonResponse({ error: "会員が見つかりません", detail: { member_code: code } }, 404);
    }
    // 予約重複チェック（insert前に必ず実行）
    // 1) 同一 store_id + start_at + status != cancelled が存在すれば拒否
    {
      const { count, error: dupErr } = await supabase
        .from("reservations")
        .select("id", { count: "exact", head: true })
        .eq("store_id", store_id)
        .eq("start_at", start_at)
        .neq("status", "cancelled");
      if (dupErr) {
        return jsonResponse(
          { error: "予約の重複確認に失敗しました", detail: dupErr.message },
          500
        );
      }
      if ((count ?? 0) > 0) {
        return jsonResponse({ error: "この時間は既に予約されています" }, 409);
      }
    }
    // 2) 同一 member_code + start_at + status != cancelled が存在すれば拒否
    // reservations には member_code がないため、member_id で二重予約を判定する
    {
      const { count, error: dupErr } = await supabase
        .from("reservations")
        .select("id", { count: "exact", head: true })
        .eq("member_id", member.id)
        .eq("start_at", start_at)
        .neq("status", "cancelled");
      if (dupErr) {
        return jsonResponse(
          { error: "予約の重複確認に失敗しました", detail: dupErr.message },
          500
        );
      }
      if ((count ?? 0) > 0) {
        return jsonResponse({ error: "この時間は既に予約されています" }, 409);
      }
    }
    console.log("③ DB前（reservations insert）");
    const insertRow: Database["public"]["Tables"]["reservations"]["Insert"] = {
      store_id,
      member_id: member.id,
      trainer_id: null,
      start_at,
      end_at,
      status: "confirmed",
      notes: "created_from=member_booking_site",
    };
    const { data: inserted, error: insErr } = await supabase
      .from("reservations")
      .insert(insertRow)
      .select(
        "id, store_id, member_id, trainer_id, start_at, end_at, status, notes, created_at, updated_at"
      )
      .single();
    if (insErr) {
      // partial unique index による二重予約防止（Postgres unique_violation）
      if ((insErr as any)?.code === "23505") {
        return jsonResponse({ error: "既に予約されています" }, 409);
      }
      return jsonResponse(
        { error: "予約の保存に失敗しました", detail: insErr.message },
        500
      );
    }
    return jsonResponse(
      {
        reservation: inserted,
        /** リクエストで渡した会員コード（DB行には member_code カラムがないため別フィールド） */
        member_code: code,
      },
      200
    );
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.log("POST reservations: 予期しないエラー", message);
    return jsonResponse({ error: "予約処理でエラーが発生しました", detail: message }, 500);
  }
}
