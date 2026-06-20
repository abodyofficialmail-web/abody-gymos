import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import timezone from "dayjs/plugin/timezone";
import { z } from "zod";
import { createSupabaseServiceClient } from "@/lib/supabase/admin";
import type { Database } from "@/types/database";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getMemberIdFromCookie } from "../../../_cookies";
import { effectiveBookingCapacity } from "@/lib/bookingStoreCapacity";
import {
  MAX_MEMBER_RESCHEDULE_COUNT,
  getMemberRescheduleEligibility,
  validateMemberRescheduleTarget,
} from "@/lib/memberReschedule";
import { fetchMemberForLine } from "@/lib/fetchMemberForLine";
import { linePushTokenForMember, normalizeLineChannelKey } from "@/lib/lineChannel";
import { pushLineTextAsChunks } from "@/lib/lineMessagingPush";
import { lineMessageForReschedule } from "@/lib/lineReservationMessage";

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

const reservationSelectFull =
  "id, member_id, store_id, start_at, end_at, status, session_type, notes, reschedule_count";
const reservationSelectLegacy = "id, member_id, store_id, start_at, end_at, status, session_type, notes";

function isMissingRescheduleCountColumn(err: unknown): boolean {
  const msg = String((err as { message?: string })?.message ?? "");
  return (
    /reschedule_count|last_rescheduled_at|does not exist|column/i.test(msg) ||
    (/PGRST/i.test(msg) && /column/i.test(msg))
  );
}

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

    let cur: Record<string, unknown> | null = null;
    let curErr: { message?: string } | null = null;
    {
      const first = await (supabase as any)
        .from("reservations")
        .select(reservationSelectFull)
        .eq("id", ctx.params.reservationId)
        .eq("member_id", memberId)
        .neq("status", "cancelled")
        .maybeSingle();
      cur = first.data ?? null;
      curErr = first.error ?? null;
      if (curErr && isMissingRescheduleCountColumn(curErr)) {
        const second = await (supabase as any)
          .from("reservations")
          .select(reservationSelectLegacy)
          .eq("id", ctx.params.reservationId)
          .eq("member_id", memberId)
          .neq("status", "cancelled")
          .maybeSingle();
        cur = second.data ?? null;
        curErr = second.error ?? null;
      }
    }
    if (curErr) return json({ error: "予約の取得に失敗しました", detail: curErr.message }, 500);
    if (!cur) return json({ error: "予約が見つかりません" }, 404);

    const count = Number((cur as any)?.reschedule_count ?? 0);
    const eligibility = getMemberRescheduleEligibility({
      reservationStartAt: String(cur.start_at),
      rescheduleCount: count,
    });
    if (!eligibility.ok) {
      return json({ error: eligibility.reason }, 409);
    }

    const { start_at, end_at } = parsed.data;
    const targetCheck = validateMemberRescheduleTarget({
      mode: eligibility.mode,
      reservationStartAt: String(cur.start_at),
      reservationEndAt: String(cur.end_at),
      targetStartAt: start_at,
      targetEndAt: end_at,
    });
    if (!targetCheck.ok) {
      return json({ error: targetCheck.reason }, 409);
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

      const { data: storeRow, error: storeErr } = await supabase
        .from("stores")
        .select("name")
        .eq("id", cur.store_id)
        .maybeSingle();
      if (storeErr) return json({ error: "店舗の取得に失敗しました", detail: storeErr.message }, 500);

      const shifts = await fetchShiftsForCapacityCheck({ supabase, store_id: cur.store_id, dateYmd });
      const availableTrainerSet = new Set<string>();
      for (const s of shifts) {
        if (s.is_break) continue;
        if (s.start_min <= startMin && s.end_min >= endMin) availableTrainerSet.add(s.trainer_id);
      }
      const capacity = effectiveBookingCapacity({
        storeName: storeRow?.name,
        trainerCount: availableTrainerSet.size,
      });
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
    const notes = `${String((cur as any)?.notes ?? "")}\nrescheduled_from_member_page`.trim();
    const updateBase = {
      start_at,
      end_at,
      updated_at: new Date().toISOString(),
      notes,
    };
    const updateWithCount = {
      ...updateBase,
      reschedule_count: nextCount,
      last_rescheduled_at: new Date().toISOString(),
    };

    let updated: Record<string, unknown> | null = null;
    let upErr: { message?: string } | null = null;
    {
      const first = await (supabase as any)
        .from("reservations")
        .update(updateWithCount)
        .eq("id", ctx.params.reservationId)
        .eq("member_id", memberId)
        .select("id, start_at, end_at, reschedule_count")
        .maybeSingle();
      updated = first.data ?? null;
      upErr = first.error ?? null;
      if (upErr && isMissingRescheduleCountColumn(upErr)) {
        const second = await (supabase as any)
          .from("reservations")
          .update(updateBase)
          .eq("id", ctx.params.reservationId)
          .eq("member_id", memberId)
          .select("id, start_at, end_at")
          .maybeSingle();
        updated = second.data ? { ...second.data, reschedule_count: nextCount } : null;
        upErr = second.error ?? null;
      }
    }
    if (upErr) return json({ error: "予約変更に失敗しました", detail: upErr.message }, 500);
    if (!updated) return json({ error: "予約が見つかりません" }, 404);

    let lineNotified = false;
    try {
      const { member, error: memberErr } = await fetchMemberForLine(supabase, memberId);
      if (!memberErr && member?.line_user_id) {
        const { data: store } = await supabase.from("stores").select("name").eq("id", cur.store_id).maybeSingle();
        const storeName = store?.name ?? "";
        const line = linePushTokenForMember({
          lineChannelKey: normalizeLineChannelKey(member.line_channel_key),
          memberCode: member.member_code,
          fallbackStoreName: storeName,
        });
        const st = String((cur as any).session_type ?? "store");
        const sessionType: "store" | "online" = st === "online" ? "online" : "store";
        const text = lineMessageForReschedule({
          storeName,
          startAtUtcIso: String(updated.start_at),
          endAtUtcIso: String(updated.end_at),
          sessionType,
        });
        lineNotified = await pushLineTextAsChunks(line.token, member.line_user_id, text);
        if (!lineNotified) {
          console.error("LINE push failed (member reschedule)", {
            memberId,
            memberCode: member.member_code,
            storeName,
            lineChannelSource: line.source,
            hasToken: Boolean(line.token),
          });
        }
      }
    } catch (e) {
      console.error("LINE push unexpected error (member reschedule)", e);
    }

    return json({ ok: true, reservation: updated, line_notified: lineNotified }, 200);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return json({ error: "エラーが発生しました", detail: message }, 500);
  }
}

