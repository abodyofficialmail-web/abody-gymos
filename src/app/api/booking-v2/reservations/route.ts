import { createClient } from "@supabase/supabase-js";
import { DateTime } from "luxon";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import timezone from "dayjs/plugin/timezone";
import { z } from "zod";
import type { Database } from "@/types/database";
import type { SupabaseClient } from "@supabase/supabase-js";
import { jsonResponse } from "../_cors";

dayjs.extend(utc);
dayjs.extend(timezone);

function parseHHMMToParts(v: string): { h: number; m: number } | null {
  const s = String(v ?? "").trim();
  if (!/^\d{2}:\d{2}$/u.test(s)) return null;
  const h = Number(s.slice(0, 2));
  const m = Number(s.slice(3, 5));
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  if (h < 0 || h > 23 || m < 0 || m > 59) return null;
  return { h, m };
}

function isPastBookingCutoff(params: { zone: string; bookingYmd: string; cutoffHHMM: string }): boolean {
  const { zone, bookingYmd, cutoffHHMM } = params;
  const t = parseHHMMToParts(cutoffHHMM) ?? { h: 22, m: 0 };
  const cutoff = DateTime.fromISO(`${bookingYmd}T${String(t.h).padStart(2, "0")}:${String(t.m).padStart(2, "0")}:00`, { zone })
    .minus({ days: 1 });
  const now = DateTime.now().setZone(zone);
  return now.toMillis() > cutoff.toMillis();
}

function lineMessageWithReservationDetails(params: {
  storeName: string;
  startAtUtcIso: string;
  endAtUtcIso: string;
  sessionType: "store" | "online";
}): string {
  const { storeName, startAtUtcIso, endAtUtcIso, sessionType } = params;
  const start = DateTime.fromISO(startAtUtcIso).setZone("Asia/Tokyo");
  const end = DateTime.fromISO(endAtUtcIso).setZone("Asia/Tokyo");

  // 例: 4月23日（木）
  const formattedDate = start.setLocale("ja").toFormat("M月d日（ccc）");
  const formattedTime = `${start.toFormat("HH:mm")}〜${end.toFormat("HH:mm")}`;

  let address = "";
  if (storeName === "恵比寿") {
    address = `
〒150-0022
東京都渋谷区恵比寿南1-14-9
アルティun 304

JR恵比寿駅 徒歩5分
日比谷線恵比寿駅 徒歩5分
`.trim();
  }
  if (storeName === "上野") {
    address = `
〒110-0016
東京都台東区台東4丁目31-5 オリオンビル4F

JR御徒町駅 徒歩3分
上野駅 徒歩7分
`.trim();
  }
  if (storeName === "桜木町") {
    address = `
神奈川県横浜市中区野毛町2-59-4
パストラル野毛マリヤ201

JR桜木町駅 徒歩4分
`.trim();
  }

  const sessionLabel = sessionType === "online" ? "オンライン" : "店舗";
  const addressBlock =
    sessionType === "online"
      ? ""
      : `
📍住所
${address}
`.trim();

  return `
【ご予約確定】
店舗：${storeName}
日時：${formattedDate} ${formattedTime}

セッション種別：${sessionLabel}

${addressBlock ? `${addressBlock}\n\n` : ""}※当日でも店舗⇄オンラインの変更が可能です。
ご希望の場合はLINEでご連絡ください。

当日は動きやすい服装でお越しください！
更衣室もございます☺️

当日のトレーニング楽しみにお待ちしております！
`.trim();
}

function tokenForStoreName(storeName: string): string | null {
  // 店舗ごとにLINE公式アカウント（チャネル）が違う前提。
  // 予約確定通知(push)は「連携したチャネルのアクセストークン」で送る必要があるため、
  // ここでは店舗名でチャネルを切り替える。
  if (storeName === "上野") return process.env.LINE_CHANNEL_ACCESS_TOKEN_UENO ?? null;
  if (storeName === "桜木町") return process.env.LINE_CHANNEL_ACCESS_TOKEN_SAKURAGICHO ?? null;
  return process.env.LINE_CHANNEL_ACCESS_TOKEN ?? null;
}

async function pushLineMessage(params: { to: string; text: string; token: string | null; debug?: any }) {
  const { to, text, token, debug } = params;
  if (!token) {
    console.error("LINE access token is not set", debug ?? {});
    return;
  }
  const res = await fetch("https://api.line.me/v2/bot/message/push", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      to,
      messages: [{ type: "text", text }],
    }),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    console.error("LINE push failed", { status: res.status, body: t, debug });
  }
}

function parseTimeToMinutesLoose(t: string): number {
  const s = String(t ?? "").trim();
  if (!s) return NaN;
  // "HH:mm" or "HH:mm:ss"
  const hh = s.slice(0, 2);
  const mm = s.slice(3, 5);
  const h = Number(hh);
  const m = Number(mm);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return NaN;
  return h * 60 + m;
}

async function trainerCandidatesForSlot(params: {
  supabase: SupabaseClient<Database>;
  store_id: string;
  start_at: string;
  end_at: string;
}): Promise<string[]> {
  const { supabase, store_id, start_at, end_at } = params;
  const start = dayjs(start_at).tz("Asia/Tokyo");
  const end = dayjs(end_at).tz("Asia/Tokyo");
  const dateYmd = start.format("YYYY-MM-DD");
  const startMin = start.hour() * 60 + start.minute();
  const endMin = end.hour() * 60 + end.minute();
  if (!dateYmd || !Number.isFinite(startMin) || !Number.isFinite(endMin) || endMin <= startMin) return [];

  let shifts: Array<{ trainer_id: string; start_min: number; end_min: number; is_break?: boolean | null }> = [];
  try {
    shifts = await fetchShiftsForCapacityCheck({ supabase, store_id, dateYmd });
  } catch {
    return [];
  }

  const candidateIds = Array.from(
    new Set(
      shifts
        .filter((s) => !s.is_break && s.start_min <= startMin && s.end_min >= endMin)
        .map((s) => s.trainer_id)
    )
  );
  if (candidateIds.length === 0) return [];

  const { data: trainers, error } = await (supabase as any)
    .from("trainers")
    .select("id, display_name")
    .in("id", candidateIds);
  if (error) return [];
  const nameById = new Map((trainers ?? []).map((t: any) => [t.id, t.display_name]));
  return candidateIds.map((id) => String(nameById.get(id) ?? "")).filter(Boolean);
}

async function fetchShiftsForCapacityCheck(params: {
  supabase: SupabaseClient<Database>;
  store_id: string;
  dateYmd: string;
}): Promise<
  Array<{ trainer_id: string; start_min: number; end_min: number; is_break?: boolean | null }>
> {
  const { supabase, store_id, dateYmd } = params;
  // shift_date が date 型 or timestamp 系どちらでも動くように
  // まず date 文字列で一致（date型に強い）→ 0件なら timestamp 範囲（timestamp型に強い）へフォールバック
  const dayStartTs = `${dateYmd}T00:00:00`;
  const dayEndTs = `${dateYmd}T23:59:59`;

  // schema A: shift_date / start_local / end_local
  const qAeq = await (supabase as any)
    .from("trainer_shifts")
    .select("trainer_id, start_local, end_local, is_break, status")
    .eq("store_id", store_id)
    .eq("shift_date", dateYmd)
    .neq("status", "draft");

  let rows: any[] = [];
  let useSchemaB = false;
  if (qAeq?.error) {
    // カラムがない/型が違う等
    useSchemaB = true;
  } else {
    rows = qAeq.data ?? [];
    // A が空（または時刻が全部取れない）場合は B も試す
    const hasAnyTimeA = rows.some((r) => (r as any)?.start_local && (r as any)?.end_local);
    if (!hasAnyTimeA) {
      // timestamp型の可能性があるので範囲検索も試す
      const qArange = await (supabase as any)
        .from("trainer_shifts")
        .select("trainer_id, start_local, end_local, is_break, status")
        .eq("store_id", store_id)
        .gte("shift_date", dayStartTs)
        .lt("shift_date", dayEndTs)
        .neq("status", "draft");
      if (!qArange?.error) {
        const rows2 = qArange.data ?? [];
        const hasAnyTimeA2 = rows2.some((r: any) => (r as any)?.start_local && (r as any)?.end_local);
        if (hasAnyTimeA2) rows = rows2;
      }
      // それでも無ければ B を試す
      useSchemaB = true;
    }
  }

  // schema B: date / start_time / end_time
  if (useSchemaB) {
    const qBeq = await (supabase as any)
      .from("trainer_shifts")
      .select("trainer_id, start_time, end_time, is_break, status")
      .eq("store_id", store_id)
      .eq("date", dateYmd)
      .neq("status", "draft");
    if (qBeq?.error) {
      throw qBeq.error;
    }
    rows = qBeq.data ?? [];
    const hasAnyTimeB = rows.some((r) => (r as any)?.start_time && (r as any)?.end_time);
    if (!hasAnyTimeB) {
      const qBrange = await (supabase as any)
        .from("trainer_shifts")
        .select("trainer_id, start_time, end_time, is_break, status")
        .eq("store_id", store_id)
        .gte("date", dayStartTs)
        .lt("date", dayEndTs)
        .neq("status", "draft");
      if (!qBrange?.error) rows = qBrange.data ?? [];
    }
  }

  return (rows ?? [])
    .map((r) => {
      const startRaw = r.start_local ?? r.start_time ?? "";
      const endRaw = r.end_local ?? r.end_time ?? "";
      const start_min = parseTimeToMinutesLoose(String(startRaw));
      const end_min = parseTimeToMinutesLoose(String(endRaw));
      return {
        trainer_id: String(r.trainer_id ?? ""),
        start_min,
        end_min,
        is_break: (r as any).is_break ?? null,
      };
    })
    .filter((r) => r.trainer_id && Number.isFinite(r.start_min) && Number.isFinite(r.end_min) && r.end_min > r.start_min);
}
const bodySchema = z.object({
  store_id: z.string().uuid("store_id は有効なUUIDである必要があります"),
  trainer_id: z.string().uuid("trainer_id は有効なUUIDである必要があります").optional(),
  member_code: z.string().min(1, "member_code は必須です"),
  start_at: z.string().min(1, "start_at は必須です"),
  end_at: z.string().min(1, "end_at は必須です"),
  session_type: z.enum(["store", "online"]).optional().default("store"),
});

const getQuerySchema = z.object({
  trainer_id: z.string().uuid("trainer_id は有効なUUIDである必要があります").optional(),
  member_id: z.string().uuid("member_id は有効なUUIDである必要があります").optional(),
  store_id: z.string().uuid("store_id は有効なUUIDである必要があります").optional(),
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
      store_id: url.searchParams.get("store_id") ?? undefined,
      month: url.searchParams.get("month") ?? undefined,
    });
    if (!parsed.success) {
      return jsonResponse({ error: "クエリが不正です", detail: parsed.error.flatten() }, 400);
    }
    const { trainer_id, member_id, store_id, month } = parsed.data;
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
          session_type,
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
    if (store_id) q = q.eq("store_id", store_id);
    const { data, error } = await q;
    if (error) {
      return jsonResponse({ error: "予約一覧の取得に失敗しました", detail: error.message }, 500);
    }

    const rows = (data ?? []) as any[];
    const enrichedBase = rows.map((r) => ({
      id: r.id,
      store_id: r.store_id,
      trainer_id: r.trainer_id,
      member_id: r.member_id,
      start_at: r.start_at,
      end_at: r.end_at,
      session_type: (r as any).session_type ?? "store",
      status: r.status,
      created_at: r.created_at,
      store_name: r.stores?.name ?? "",
      trainer_name: r.trainers?.display_name ?? "",
      member_code: r.member?.member_code ?? "",
      member_name: r.member?.name ?? "",
      member: r.member ? { id: r.member.id, name: r.member.name ?? "" } : null,
    }));

    const enriched = await Promise.all(
      enrichedBase.map(async (r) => {
        if (r.trainer_id) return r;
        const candidates = await trainerCandidatesForSlot({
          supabase,
          store_id: r.store_id,
          start_at: r.start_at,
          end_at: r.end_at,
        });
        return { ...r, trainer_candidates: candidates };
      })
    );

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
    const { store_id, trainer_id: trainerIdInput, member_code, start_at, end_at, session_type } = parsed.data;
    const code = member_code.trim();
    console.log({ store_id, new_start_at: start_at, new_end_at: end_at });
    let supabase: SupabaseClient<Database>;
    try {
      supabase = createServiceSupabase();
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return jsonResponse({ error: "サーバー設定エラー", detail: message }, 500);
    }
    const { data: member, error: memberErr } = await supabase
      .from("members")
      .select("id, member_code, is_active, line_user_id")
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
        .select("id, timezone, booking_cutoff_prev_day_time")
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
      // start_at / end_at をJSTに変換（シフトもJST前提のため、比較をJSTに統一）
      const newStart = dayjs(start_at).tz("Asia/Tokyo");
      const newEnd = dayjs(end_at).tz("Asia/Tokyo");

      // デバッグ（絶対入れる）
      console.log("JST変換", {
        raw_start: start_at,
        jst_start: newStart.format(),
        jst_hour: newStart.hour(),
      });

      // 日付もJSTで揃える（UTC基準だと shift_date/date とズレる）
      const targetDate = dayjs(start_at).tz("Asia/Tokyo").format("YYYY-MM-DD");
      console.log("targetDate", targetDate);
      if (!targetDate) {
        return jsonResponse({ error: "start_at の日付解釈に失敗しました" }, 400);
      }

      // 予約締切（前日 HH:MM）チェック
      const cutoff = String((storeRow as any)?.booking_cutoff_prev_day_time ?? "22:00");
      if (isPastBookingCutoff({ zone, bookingYmd: targetDate, cutoffHHMM: cutoff })) {
        return jsonResponse({ error: `この予約は締切（前日${cutoff}）を過ぎています` }, 409);
      }

      const newStartMinutes = newStart.hour() * 60 + newStart.minute();
      const newEndMinutes = newEnd.hour() * 60 + newEnd.minute();
      if (
        !Number.isFinite(newStartMinutes) ||
        !Number.isFinite(newEndMinutes) ||
        newEndMinutes <= newStartMinutes
      ) {
        return jsonResponse({ error: "start_at / end_at の時刻解釈に失敗しました" }, 400);
      }

      let shifts: Array<{ trainer_id: string; start_min: number; end_min: number; is_break?: boolean | null }> = [];
      try {
        // trainers は参照せず、store_id + 日付 のシフトのみで容量を判定する
        shifts = await fetchShiftsForCapacityCheck({ supabase, store_id, dateYmd: targetDate });
      } catch (e: any) {
        return jsonResponse(
          { error: "シフトの取得に失敗しました", detail: String(e?.message ?? e) },
          500
        );
      }
      console.log("shift取得結果", {
        store_id,
        targetDate,
        shiftsCount: shifts.length,
        shifts,
      });

      // capacity = その時間帯をカバーできるシフト数（=同時に捌ける人数）
      const availableTrainerSet = new Set<string>();
      for (const s of shifts) {
        if (s.is_break) continue;
        if (s.start_min <= newStartMinutes && s.end_min >= newEndMinutes) {
          availableTrainerSet.add(s.trainer_id);
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
        .lt("start_at", end_at)
        .gt("end_at", start_at)
        .neq("status", "cancelled");
      if (bookedErr) {
        return jsonResponse({ error: "予約状況の確認に失敗しました", detail: bookedErr.message }, 500);
      }
      if ((bookedCount ?? 0) >= capacity) {
        return jsonResponse({ error: "この時間は予約できません" }, 409);
      }
    }

    // 予約重複チェック（insert前に必ず実行）
    // 1) 同一 store_id + trainer_id + 時間帯が重なる予約が存在すれば拒否
    if (trainer_id) {
      const { count, error: dupErr } = await supabase
        .from("reservations")
        .select("id", { count: "exact", head: true })
        .eq("store_id", store_id)
        .eq("trainer_id", trainer_id)
        .lt("start_at", end_at)
        .gt("end_at", start_at)
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
    // 2) 同一 member_code + 時間帯が重なる予約が存在すれば拒否
    // reservations には member_code がないため、member_id で二重予約を判定する
    {
      const { count, error: dupErr } = await supabase
        .from("reservations")
        .select("id", { count: "exact", head: true })
        .eq("member_id", member.id)
        .lt("start_at", end_at)
        .gt("end_at", start_at)
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
      session_type,
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
        "id, store_id, member_id, trainer_id, start_at, end_at, session_type, status, notes, created_at, updated_at"
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

    // 予約確定後にLINEへ自動送信（line_user_id がある場合のみ）
    try {
      const lineUserId = (member as any)?.line_user_id as string | null | undefined;
      if (lineUserId) {
        const { data: storeRow, error: storeErr } = await supabase
          .from("stores")
          .select("id, name")
          .eq("id", store_id)
          .maybeSingle();
        if (storeErr) {
          console.error("store lookup failed for LINE push", storeErr);
        } else {
          const st = ((inserted as any)?.session_type as string | null | undefined) ?? session_type ?? "store";
          const sessionTypeNormalized: "store" | "online" = st === "online" ? "online" : "store";
          const text = lineMessageWithReservationDetails({
            storeName: storeRow?.name ?? "",
            startAtUtcIso: inserted.start_at,
            endAtUtcIso: inserted.end_at,
            sessionType: sessionTypeNormalized,
          });
          const token = tokenForStoreName(storeRow?.name ?? "");
          await pushLineMessage({
            to: lineUserId,
            text,
            token,
            debug: { storeName: storeRow?.name ?? "", hasToken: Boolean(token) },
          });
        }
      }
    } catch (e) {
      console.error("LINE push unexpected error", e);
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
