import { createClient } from "@supabase/supabase-js";
import { DateTime } from "luxon";
import { z } from "zod";
import type { Database } from "@/types/database";
import type { SupabaseClient } from "@supabase/supabase-js";
import { jsonResponse } from "../_cors";
const bodySchema = z.object({
  store_id: z.string().uuid("store_id は有効なUUIDである必要があります"),
  trainer_id: z.string().uuid("trainer_id は有効なUUIDである必要があります").optional(),
  member_code: z.string().min(1, "member_code は必須です"),
  start_at: z.string().min(1, "start_at は必須です"),
  end_at: z.string().min(1, "end_at は必須です"),
});

const getQuerySchema = z.object({
  trainer_id: z.string().uuid("trainer_id は有効なUUIDである必要があります").optional(),
  member_id: z.string().uuid("member_id は有効なUUIDである必要があります").optional(),
  month: z.string().regex(/^\d{4}-\d{2}$/u, "month は YYYY-MM 形式である必要があります").optional(),
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

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const parsed = getQuerySchema.safeParse({
      trainer_id: url.searchParams.get("trainer_id") ?? undefined,
      member_id: url.searchParams.get("member_id") ?? undefined,
      month: url.searchParams.get("month") ?? undefined,
    });
    if (!parsed.success) {
      return jsonResponse({ error: "クエリが不正です", detail: parsed.error.flatten() }, 400);
    }
    const { trainer_id, member_id, month } = parsed.data;
    let supabase: SupabaseClient<Database>;
    try {
      supabase = createServiceSupabase();
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return jsonResponse({ error: "サーバー設定エラー", detail: message }, 500);
    }
    const monthKey = month ?? DateTime.now().setZone("Asia/Tokyo").toFormat("yyyy-MM");
    const start = DateTime.fromISO(`${monthKey}-01`, { zone: "Asia/Tokyo" }).startOf("month");
    const end = start.plus({ months: 1 });
    // NOTE: Database 型定義にリレーションが無い場合でも JOIN できるよう any 経由で実行
    let q = (supabase as any)
      .from("reservations")
      .select(
        `
          id,
          start_at,
          end_at,
          trainer_id,
          member_id,
          store_id,
          status,
          created_at,
          member:members(
            id,
            member_code,
            name
          ),
          trainers(
            id,
            display_name
          ),
          stores(
            id,
            name
          )
        `
      )
      .neq("status", "cancelled")
      .gte("start_at", start.toUTC().toISO()!)
      .lt("start_at", end.toUTC().toISO()!)
      .order("start_at", { ascending: true });
    if (trainer_id) q = q.eq("trainer_id", trainer_id);
    if (member_id) q = q.eq("member_id", member_id);
    const { data, error } = await q;
    if (error) {
      return jsonResponse({ error: "予約一覧の取得に失敗しました", detail: error.message }, 500);
    }

    const rows = (data ?? []) as any[];
    const enriched = rows.map((r) => ({
      id: r.id,
      store_id: r.store_id,
      trainer_id: r.trainer_id,
      member_id: r.member_id,
      start_at: r.start_at,
      end_at: r.end_at,
      status: r.status,
      created_at: r.created_at,
      store_name: r.stores?.name ?? "",
      trainer_name: r.trainers?.display_name ?? "",
      member_code: r.member?.member_code ?? "",
      member_name: r.member?.name ?? "",
      member: r.member ? { id: r.member.id, name: r.member.name ?? "" } : null,
    }));

    return jsonResponse({ reservations: enriched }, 200);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return jsonResponse({ error: "予約一覧の取得でエラーが発生しました", detail: message }, 500);
  }
}

/**
 * リクエスト body: { store_id, trainer_id, member_code, start_at, end_at }
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
    const { store_id, trainer_id: trainerIdInput, member_code, start_at, end_at } = parsed.data;
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
    // trainer_id は未指定でも予約を成立させる（将来的に管理画面で後から割当）
    // - trainer_id 指定がある場合のみ、そのトレーナーに対してバリデーション/重複チェックを行う
    // - trainer_id 未指定の場合は「シフト（枠の受け皿）があるか」と「同時刻の予約数が容量を超えていないか」だけ確認する
    const trainer_id = trainerIdInput ?? null;
    if (trainer_id) {
      const { data: trainerRow, error: trainerErr } = await supabase
        .from("trainers")
        .select("id, store_id, is_active")
        .eq("id", trainer_id)
        .maybeSingle();
      if (trainerErr) {
        return jsonResponse({ error: "トレーナーの照会に失敗しました", detail: trainerErr.message }, 500);
      }
      if (!trainerRow || !trainerRow.is_active || trainerRow.store_id !== store_id) {
        return jsonResponse({ error: "トレーナーが不正です", detail: { trainer_id } }, 400);
      }
    }

    // trainer 未指定の場合の「シフトベース」判定（容量チェック）
    if (!trainer_id) {
      const { data: storeRow, error: storeErr } = await supabase
        .from("stores")
        .select("id, timezone")
        .eq("id", store_id)
        .maybeSingle();
      if (storeErr) {
        return jsonResponse({ error: "店舗の取得に失敗しました", detail: storeErr.message }, 500);
      }
      if (!storeRow) {
        return jsonResponse({ error: "店舗が見つかりません" }, 404);
      }
      const zone = storeRow.timezone?.trim() || "Asia/Tokyo";

      const startMs = DateTime.fromISO(start_at).toMillis();
      const endMs = DateTime.fromISO(end_at).toMillis();
      if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || !(endMs > startMs)) {
        return jsonResponse({ error: "start_at / end_at が不正です" }, 400);
      }
      const dateYmd = DateTime.fromISO(start_at).setZone(zone).toISODate();
      if (!dateYmd) {
        return jsonResponse({ error: "start_at の日付解釈に失敗しました" }, 400);
      }
      const startLocal = DateTime.fromISO(start_at).setZone(zone).toFormat("HH:mm:ss");
      const endLocal = DateTime.fromISO(end_at).setZone(zone).toFormat("HH:mm:ss");

      // この枠をカバーできるトレーナー（=容量）を算出
      const { data: trainers, error: trainersErr } = await supabase
        .from("trainers")
        .select("id")
        .eq("store_id", store_id)
        .eq("is_active", true);
      if (trainersErr) {
        return jsonResponse({ error: "トレーナー一覧の取得に失敗しました", detail: trainersErr.message }, 500);
      }
      const trainerIds = (trainers ?? []).map((t) => t.id).filter(Boolean);
      if (trainerIds.length === 0) {
        return jsonResponse({ error: "この時間は予約できません" }, 409);
      }

      const { data: shiftsRaw, error: shiftsErr } = await supabase
        .from("trainer_shifts")
        .select("trainer_id, start_local, end_local, status, is_break")
        .eq("store_id", store_id)
        .eq("shift_date", dateYmd)
        .in("trainer_id", trainerIds)
        .neq("status", "draft");
      if (shiftsErr) {
        return jsonResponse({ error: "シフトの取得に失敗しました", detail: shiftsErr.message }, 500);
      }

      const availableTrainerSet = new Set<string>();
      for (const s of (shiftsRaw ?? []) as any[]) {
        if (s?.is_break) continue;
        if (!s?.trainer_id) continue;
        if (String(s.start_local) <= startLocal && String(s.end_local) >= endLocal) {
          availableTrainerSet.add(String(s.trainer_id));
        }
      }
      const capacity = availableTrainerSet.size;
      if (capacity === 0) {
        return jsonResponse({ error: "この時間は予約できません" }, 409);
      }

      // 既存予約数（同一店舗・同一開始時刻）を見て、容量を超えるなら不可
      const { count: bookedCount, error: bookedErr } = await supabase
        .from("reservations")
        .select("id", { count: "exact", head: true })
        .eq("store_id", store_id)
        .eq("start_at", start_at)
        .neq("status", "cancelled");
      if (bookedErr) {
        return jsonResponse({ error: "予約状況の確認に失敗しました", detail: bookedErr.message }, 500);
      }
      if ((bookedCount ?? 0) >= capacity) {
        return jsonResponse({ error: "この時間は予約できません" }, 409);
      }
    }

    // 予約重複チェック（insert前に必ず実行）
    // 1) 同一 store_id + trainer_id + start_at + status != cancelled が存在すれば拒否
    if (trainer_id) {
      const { count, error: dupErr } = await supabase
        .from("reservations")
        .select("id", { count: "exact", head: true })
        .eq("store_id", store_id)
        .eq("trainer_id", trainer_id)
        .eq("start_at", start_at)
        .neq("status", "cancelled");
      if (dupErr) {
        return jsonResponse(
          { error: "予約の重複確認に失敗しました", detail: dupErr.message },
          500
        );
      }
      if ((count ?? 0) > 0) {
        return jsonResponse({ error: "この時間は予約できません" }, 409);
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
      start_at,
      end_at,
      status: "confirmed",
      notes: "created_from=member_booking_site",
    };
    if (trainer_id) {
      (insertRow as any).trainer_id = trainer_id;
    } else {
      (insertRow as any).trainer_id = null;
    }
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
