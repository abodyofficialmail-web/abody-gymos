import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import timezone from "dayjs/plugin/timezone";
import { z } from "zod";
import { createSupabaseServiceClient } from "@/lib/supabase/admin";
import type { Database } from "@/types/database";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getMemberIdFromCookie } from "../../../_cookies";

dayjs.extend(utc);
dayjs.extend(timezone);

function json(body: any, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const TZ = "Asia/Tokyo";

const bodySchema = z.object({
  start_at: z.string().min(1),
  end_at: z.string().min(1),
});

function parseTimeToMinutesLoose(t: string): number {
  const s = String(t ?? "").trim();
  if (!s) return NaN;
  const hh = s.slice(0, 2);
  const mm = s.slice(3, 5);
  const h = Number(hh);
  const m = Number(mm);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return NaN;
  return h * 60 + m;
}

async function fetchShiftsForCapacityCheck(params: {
  supabase: SupabaseClient<Database>;
  store_id: string;
  dateYmd: string;
}): Promise<Array<{ trainer_id: string; start_min: number; end_min: number; is_break?: boolean | null }>> {
  const { supabase, store_id, dateYmd } = params;
  const dayStartTs = `${dateYmd}T00:00:00`;
  const dayEndTs = `${dateYmd}T23:59:59`;

  const qAeq = await (supabase as any)
    .from("trainer_shifts")
    .select("trainer_id, start_local, end_local, is_break, status")
    .eq("store_id", store_id)
    .eq("shift_date", dateYmd)
    .neq("status", "draft");

  let rows: any[] = [];
  let useSchemaB = false;
  if (qAeq?.error) {
    useSchemaB = true;
  } else {
    rows = qAeq.data ?? [];
    const hasAnyTimeA = rows.some((r) => (r as any)?.start_local && (r as any)?.end_local);
    if (!hasAnyTimeA) {
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
      useSchemaB = true;
    }
  }

  if (useSchemaB) {
    const qBeq = await (supabase as any)
      .from("trainer_shifts")
      .select("trainer_id, start_time, end_time, is_break, status")
      .eq("store_id", store_id)
      .eq("date", dateYmd)
      .neq("status", "draft");
    if (qBeq?.error) throw qBeq.error;
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

export async function PATCH(request: Request, ctx: { params: { reservationId: string } }) {
  try {
    const memberId = getMemberIdFromCookie();
    if (!memberId) return json({ error: "未ログイン" }, 401);

    const raw = await request.json().catch(() => null);
    const parsed = bodySchema.safeParse(raw);
    if (!parsed.success) return json({ error: "リクエストが不正です", detail: parsed.error.flatten() }, 400);

    const supabase = createSupabaseServiceClient();

    const { data: cur, error: curErr } = await (supabase as any)
      .from("reservations")
      .select("id, member_id, store_id, start_at, end_at, status, session_type, reschedule_count")
      .eq("id", ctx.params.reservationId)
      .eq("member_id", memberId)
      .neq("status", "cancelled")
      .maybeSingle();
    if (curErr) return json({ error: "予約の取得に失敗しました", detail: curErr.message }, 500);
    if (!cur) return json({ error: "予約が見つかりません" }, 404);

    const count = Number((cur as any)?.reschedule_count ?? 0);
    if (Number.isFinite(count) && count >= 1) {
      return json({ error: "この予約は本日これ以上変更できません（1日1回まで）" }, 409);
    }

    // 当日限定（JSTで判定）
    const todayYmd = dayjs().tz(TZ).format("YYYY-MM-DD");
    const bookingYmd = dayjs(cur.start_at).tz(TZ).format("YYYY-MM-DD");
    if (todayYmd !== bookingYmd) {
      return json({ error: "予約の変更は当日のみ可能です。前日までは一度キャンセルして再度予約してください。" }, 409);
    }

    const { start_at, end_at } = parsed.data;

    // 同一日・同一店舗のみ（当日内の別時間へ）
    const nextYmd = dayjs(start_at).tz(TZ).format("YYYY-MM-DD");
    if (nextYmd !== bookingYmd) {
      return json({ error: "同じ日付の空き時間のみ変更できます" }, 409);
    }

    // 開始前のみ（開始後は不可）
    const nowMs = dayjs().toDate().getTime();
    const curStartMs = dayjs(cur.start_at).toDate().getTime();
    if (Number.isFinite(curStartMs) && nowMs > curStartMs) {
      return json({ error: "開始時刻を過ぎた予約は変更できません" }, 409);
    }

    // 容量チェック（自分の予約を除外）
    {
      const newStart = dayjs(start_at).tz(TZ);
      const newEnd = dayjs(end_at).tz(TZ);
      const dateYmd = newStart.format("YYYY-MM-DD");
      const startMin = newStart.hour() * 60 + newStart.minute();
      const endMin = newEnd.hour() * 60 + newEnd.minute();
      if (!dateYmd || !Number.isFinite(startMin) || !Number.isFinite(endMin) || endMin <= startMin) {
        return json({ error: "start_at / end_at が不正です" }, 400);
      }

      const shifts = await fetchShiftsForCapacityCheck({ supabase, store_id: cur.store_id, dateYmd });
      const availableTrainerSet = new Set<string>();
      for (const s of shifts) {
        if (s.is_break) continue;
        if (s.start_min <= startMin && s.end_min >= endMin) availableTrainerSet.add(s.trainer_id);
      }
      const capacity = availableTrainerSet.size;
      if (capacity === 0) return json({ error: "この時間は予約できません" }, 409);

      const { data: overlapped, error: ovErr } = await (supabase as any)
        .from("reservations")
        .select("id")
        .eq("store_id", cur.store_id)
        .lt("start_at", end_at)
        .gt("end_at", start_at)
        .neq("status", "cancelled");
      if (ovErr) return json({ error: "予約状況の確認に失敗しました", detail: ovErr.message }, 500);
      const bookedCount = (overlapped ?? []).filter((r: any) => String(r.id) !== String(cur.id)).length;
      if (bookedCount >= capacity) return json({ error: "この時間は予約できません" }, 409);
    }

    // 会員の重複予約チェック（自分自身は除外）
    {
      const { data: memberOverlaps, error } = await (supabase as any)
        .from("reservations")
        .select("id")
        .eq("member_id", memberId)
        .lt("start_at", end_at)
        .gt("end_at", start_at)
        .neq("status", "cancelled");
      if (error) return json({ error: "予約の重複確認に失敗しました", detail: error.message }, 500);
      const dup = (memberOverlaps ?? []).some((r: any) => String(r.id) !== String(cur.id));
      if (dup) return json({ error: "この時間は既に予約されています" }, 409);
    }

    const nextCount = Number.isFinite(count) ? count + 1 : 1;
    const { data: updated, error: upErr } = await (supabase as any)
      .from("reservations")
      .update({
        start_at,
        end_at,
        reschedule_count: nextCount,
        last_rescheduled_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        notes: `${String((cur as any)?.notes ?? "")}\nrescheduled_from_member_page`.trim(),
      })
      .eq("id", ctx.params.reservationId)
      .eq("member_id", memberId)
      .select("id, start_at, end_at, reschedule_count")
      .maybeSingle();
    if (upErr) {
      const msg = String(upErr.message ?? "");
      if (msg.toLowerCase().includes("reschedule_count")) {
        return json(
          {
            error: "予約変更の準備ができていません（reservations.reschedule_count カラムが未追加の可能性）",
            detail: msg,
          },
          500
        );
      }
      return json({ error: "予約変更に失敗しました", detail: upErr.message }, 500);
    }
    if (!updated) return json({ error: "予約が見つかりません" }, 404);

    return json({ ok: true, reservation: updated }, 200);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return json({ error: "エラーが発生しました", detail: message }, 500);
  }
}

