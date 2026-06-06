import { z } from "zod";
import { DateTime } from "luxon";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import timezone from "dayjs/plugin/timezone";
import { createSupabaseServiceClient } from "@/lib/supabase/admin";
import { jsonResponse } from "@/app/api/booking-v2/_cors";
import { linePushTokenForMember, normalizeLineChannelKey } from "@/lib/lineChannel";
import type { Database } from "@/types/database";
import type { SupabaseClient } from "@supabase/supabase-js";
import { effectiveBookingCapacity } from "@/lib/bookingStoreCapacity";

dayjs.extend(utc);
dayjs.extend(timezone);

export async function OPTIONS() {
  return jsonResponse({}, 200);
}

const patchSchema = z.object({
  action: z.enum(["reschedule", "cancel"]),
  store_id: z.string().uuid().optional(),
  start_at: z.string().min(1).optional(),
  end_at: z.string().min(1).optional(),
  session_type: z.enum(["store", "online"]).optional(),
});

function lineTokenForMember(
  member: { member_code: string | null; line_channel_key?: string | null } | null,
  storeName: string
) {
  return linePushTokenForMember({
    lineChannelKey: normalizeLineChannelKey(member?.line_channel_key),
    memberCode: member?.member_code ?? "",
    fallbackStoreName: storeName,
  });
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
    body: JSON.stringify({ to, messages: [{ type: "text", text }] }),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    console.error("LINE push failed", { status: res.status, body: t, debug });
  }
}

function messageForAdminReschedule(params: {
  storeName: string;
  startAtUtcIso: string;
  endAtUtcIso: string;
  sessionType: "store" | "online";
}): string {
  const { storeName, startAtUtcIso, endAtUtcIso, sessionType } = params;
  const start = DateTime.fromISO(startAtUtcIso).setZone("Asia/Tokyo");
  const end = DateTime.fromISO(endAtUtcIso).setZone("Asia/Tokyo");
  const formattedDate = start.setLocale("ja").toFormat("M月d日（ccc）");
  const formattedTime = `${start.toFormat("HH:mm")}〜${end.toFormat("HH:mm")}`;
  const sessionLabel = sessionType === "online" ? "オンライン" : "店舗";
  return `
【ご予約変更】
店舗：${storeName}
日時：${formattedDate} ${formattedTime}
セッション種別：${sessionLabel}

よろしくお願いいたします。
`.trim();
}

function messageForAdminCancel(params: { storeName: string; startAtUtcIso: string; endAtUtcIso: string }): string {
  const { storeName, startAtUtcIso, endAtUtcIso } = params;
  const start = DateTime.fromISO(startAtUtcIso).setZone("Asia/Tokyo");
  const end = DateTime.fromISO(endAtUtcIso).setZone("Asia/Tokyo");
  const formattedDate = start.setLocale("ja").toFormat("M月d日（ccc）");
  const formattedTime = `${start.toFormat("HH:mm")}〜${end.toFormat("HH:mm")}`;
  return `
【ご予約キャンセル】
店舗：${storeName}
日時：${formattedDate} ${formattedTime}

またのご予約をお待ちしております。
`.trim();
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

type ReservationRowForAdmin = {
  id: string;
  store_id: string;
  member_id: string | null;
  trainer_id: string | null;
  guest_name: string | null;
  blocks_capacity?: boolean;
  start_at: string;
  end_at: string;
  session_type: string | null;
  status: string | null;
};

function isMissingColumnError(e: any, column: string): boolean {
  const msg = String(e?.message ?? e ?? "");
  return msg.includes(`column`) && msg.includes(column);
}

async function fetchReservationForAdmin(
  supabase: SupabaseClient<Database>,
  id: string
): Promise<{ data: ReservationRowForAdmin | null; error: any | null }> {
  // 新旧スキーマ差（blocks_capacity など）を吸収する
  const qA = await (supabase as any)
    .from("reservations")
    .select("id, store_id, member_id, trainer_id, guest_name, blocks_capacity, start_at, end_at, session_type, status")
    .eq("id", id)
    .maybeSingle();
  if (!qA?.error) return { data: qA.data ?? null, error: null };

  // guest_name / blocks_capacity のどちらか（または両方）が無い環境向けフォールバック
  if (isMissingColumnError(qA.error, "blocks_capacity") || isMissingColumnError(qA.error, "guest_name")) {
    const qB = await (supabase as any)
      .from("reservations")
      .select("id, store_id, member_id, trainer_id, guest_name, start_at, end_at, session_type, status")
      .eq("id", id)
      .maybeSingle();
    if (!qB?.error) {
      return { data: { ...(qB.data ?? {}), blocks_capacity: true } as any, error: null };
    }

    // guest_name が無いDBでは qB も失敗するので、guest_name を外して再試行
    if (isMissingColumnError(qB.error, "guest_name")) {
      const qC = await (supabase as any)
        .from("reservations")
        .select("id, store_id, member_id, trainer_id, start_at, end_at, session_type, status")
        .eq("id", id)
        .maybeSingle();
      if (qC?.error) return { data: null, error: qC.error };
      return { data: { ...(qC.data ?? {}), guest_name: null, blocks_capacity: true } as any, error: null };
    }

    return { data: null, error: qB.error };
  }

  return { data: null, error: qA.error };
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

async function fetchOverlappedReservationsForCapacityCheck(params: {
  supabase: SupabaseClient<Database>;
  store_id: string;
  start_at: string;
  end_at: string;
}): Promise<{ data: Array<{ id: string; start_at: string; end_at: string }> | null; error: any | null }> {
  const { supabase, store_id, start_at, end_at } = params;

  const qA = await (supabase as any)
    .from("reservations")
    .select("id, start_at, end_at")
    .eq("store_id", store_id)
    .eq("blocks_capacity", true)
    .lt("start_at", end_at)
    .gt("end_at", start_at)
    .neq("status", "cancelled");
  if (!qA?.error) return { data: qA.data ?? [], error: null };

  // blocks_capacity が無いDBでは全予約が枠を潰す前提で数える（= フィルタを外す）
  if (isMissingColumnError(qA.error, "blocks_capacity")) {
    const qB = await (supabase as any)
      .from("reservations")
      .select("id, start_at, end_at")
      .eq("store_id", store_id)
      .lt("start_at", end_at)
      .gt("end_at", start_at)
      .neq("status", "cancelled");
    if (qB?.error) return { data: null, error: qB.error };
    return { data: qB.data ?? [], error: null };
  }

  return { data: null, error: qA.error };
}

export async function PATCH(request: Request, ctx: { params: { reservationId: string } }) {
  try {
    const raw = await request.json().catch(() => null);
    const parsed = patchSchema.safeParse(raw);
    if (!parsed.success) return jsonResponse({ error: "リクエストが不正です", detail: parsed.error.flatten() }, 400);

    const supabase = createSupabaseServiceClient();

    const { data: cur, error: curErr } = await fetchReservationForAdmin(supabase, ctx.params.reservationId);
    if (curErr) return jsonResponse({ error: "予約の取得に失敗しました", detail: curErr.message }, 500);
    if (!cur) return jsonResponse({ error: "予約が見つかりません" }, 404);

    let member: { id: string; member_code: string | null; name: string | null; is_active: boolean | null; line_user_id: string | null } | null =
      null;
    if (cur.member_id) {
      const { data: m, error: memberErr } = await (supabase as any)
        .from("members")
        .select("id, member_code, name, is_active, line_user_id, line_channel_key")
        .eq("id", cur.member_id)
        .maybeSingle();
      if (memberErr) return jsonResponse({ error: "会員の取得に失敗しました", detail: memberErr.message }, 500);
      if (!m || !m.is_active) return jsonResponse({ error: "会員が見つかりません" }, 404);
      member = m;
    }

    if (parsed.data.action === "cancel") {
      const { data: cancelled, error: upErr } = await (supabase as any)
        .from("reservations")
        .update({ status: "cancelled", updated_at: new Date().toISOString() })
        .eq("id", ctx.params.reservationId)
        .select("id, store_id, member_id, trainer_id, guest_name, start_at, end_at, session_type, status")
        .maybeSingle();
      if (upErr) {
        // guest_name が無いDB向けフォールバック
        if (isMissingColumnError(upErr, "guest_name")) {
          const q2 = await (supabase as any)
            .from("reservations")
            .update({ status: "cancelled", updated_at: new Date().toISOString() })
            .eq("id", ctx.params.reservationId)
            .select("id, store_id, member_id, trainer_id, start_at, end_at, session_type, status")
            .maybeSingle();
          if (q2?.error) return jsonResponse({ error: "キャンセルに失敗しました", detail: q2.error.message }, 500);
          if (!q2?.data) return jsonResponse({ error: "予約が見つかりません" }, 404);

          const cancelled2 = { ...(q2.data ?? {}), guest_name: null } as any;

          try {
            const lineUserId = (member as any)?.line_user_id as string | null | undefined;
            if (lineUserId) {
              const { data: store } = await (supabase as any).from("stores").select("id, name").eq("id", cancelled2.store_id).maybeSingle();
              const line = lineTokenForMember(member, store?.name ?? "");
              const text = messageForAdminCancel({ storeName: store?.name ?? "", startAtUtcIso: cancelled2.start_at, endAtUtcIso: cancelled2.end_at });
              await pushLineMessage({ to: lineUserId, text, token: line.token, debug: { storeName: store?.name ?? "", memberCode: member?.member_code ?? "", lineChannelSource: line.source, lineChannelKey: line.channelKey, hasToken: Boolean(line.token) } });
            }
          } catch (e) {
            console.error("LINE push unexpected error", e);
          }

          return jsonResponse({ reservation: cancelled2 }, 200);
        }

        return jsonResponse({ error: "キャンセルに失敗しました", detail: upErr.message }, 500);
      }
      if (!cancelled) return jsonResponse({ error: "予約が見つかりません" }, 404);

      try {
        const lineUserId = (member as any)?.line_user_id as string | null | undefined;
        if (lineUserId) {
          const { data: store } = await (supabase as any).from("stores").select("id, name").eq("id", cancelled.store_id).maybeSingle();
          const line = lineTokenForMember(member, store?.name ?? "");
          const text = messageForAdminCancel({ storeName: store?.name ?? "", startAtUtcIso: cancelled.start_at, endAtUtcIso: cancelled.end_at });
          await pushLineMessage({ to: lineUserId, text, token: line.token, debug: { storeName: store?.name ?? "", memberCode: member?.member_code ?? "", lineChannelSource: line.source, lineChannelKey: line.channelKey, hasToken: Boolean(line.token) } });
        }
      } catch (e) {
        console.error("LINE push unexpected error", e);
      }

      return jsonResponse({ reservation: cancelled }, 200);
    }

    // reschedule
    const store_id = parsed.data.store_id ?? cur.store_id;
    const start_at = parsed.data.start_at ?? cur.start_at;
    const end_at = parsed.data.end_at ?? cur.end_at;
    const session_type = parsed.data.session_type ?? cur.session_type ?? "store";

    const blocksForCapacity = Boolean((cur as any).blocks_capacity ?? true);

    {
      const newStart = dayjs(start_at).tz("Asia/Tokyo");
      const newEnd = dayjs(end_at).tz("Asia/Tokyo");
      const dateYmd = newStart.format("YYYY-MM-DD");
      const startMin = newStart.hour() * 60 + newStart.minute();
      const endMin = newEnd.hour() * 60 + newEnd.minute();
      if (!dateYmd || !Number.isFinite(startMin) || !Number.isFinite(endMin) || endMin <= startMin) {
        return jsonResponse({ error: "start_at / end_at が不正です" }, 400);
      }

      const { data: storeRow, error: storeErr } = await supabase
        .from("stores")
        .select("name")
        .eq("id", store_id)
        .maybeSingle();
      if (storeErr) return jsonResponse({ error: "店舗の取得に失敗しました", detail: storeErr.message }, 500);

      const shifts = await fetchShiftsForCapacityCheck({ supabase, store_id, dateYmd });
      const tid = (cur as any).trainer_id as string | null | undefined;
      const isTrialReservation = !cur.member_id || Boolean(String((cur as any).guest_name ?? "").trim());

      if (tid && !isTrialReservation) {
        const trainerCovers = shifts.some(
          (s) => s.trainer_id === tid && !s.is_break && s.start_min <= startMin && s.end_min >= endMin
        );
        if (!trainerCovers) {
          return jsonResponse({ error: "この時間は担当トレーナーのシフト外です" }, 409);
        }
      }

      if (blocksForCapacity) {
        const availableTrainerSet = new Set<string>();
        for (const s of shifts) {
          if (s.is_break) continue;
          if (s.start_min <= startMin && s.end_min >= endMin) availableTrainerSet.add(s.trainer_id);
        }
        const capacity = effectiveBookingCapacity({
          storeName: storeRow?.name,
          trainerCount: availableTrainerSet.size,
        });
        if (capacity === 0) return jsonResponse({ error: "この時間は予約できません" }, 409);

        const { data: overlapped, error: ovErr } = await fetchOverlappedReservationsForCapacityCheck({
          supabase,
          store_id,
          start_at,
          end_at,
        });
        if (ovErr) return jsonResponse({ error: "予約状況の確認に失敗しました", detail: ovErr.message }, 500);
        const bookedCount = (overlapped ?? []).filter((r: any) => String(r.id) !== String(cur.id)).length;
        if (bookedCount >= capacity) return jsonResponse({ error: "この時間は予約できません" }, 409);
      }
    }

    if (cur.member_id) {
      const { data: memberOverlaps, error } = await (supabase as any)
        .from("reservations")
        .select("id")
        .eq("member_id", cur.member_id)
        .lt("start_at", end_at)
        .gt("end_at", start_at)
        .neq("status", "cancelled");
      if (error) return jsonResponse({ error: "予約の重複確認に失敗しました", detail: error.message }, 500);
      const dup = (memberOverlaps ?? []).some((r: any) => String(r.id) !== String(cur.id));
      if (dup) return jsonResponse({ error: "この時間は既に予約されています" }, 409);
    }

    const { data: updated, error: upErr } = await (supabase as any)
      .from("reservations")
      .update({
        store_id,
        start_at,
        end_at,
        session_type,
        updated_at: new Date().toISOString(),
      })
      .eq("id", ctx.params.reservationId)
      .select("id, store_id, member_id, trainer_id, guest_name, blocks_capacity, start_at, end_at, session_type, status")
      .maybeSingle();
    if (upErr) {
      // blocks_capacity / guest_name が無いDB向けフォールバック
      if (isMissingColumnError(upErr, "blocks_capacity") || isMissingColumnError(upErr, "guest_name")) {
        const q2 = await (supabase as any)
          .from("reservations")
          .update({
            store_id,
            start_at,
            end_at,
            session_type,
            updated_at: new Date().toISOString(),
          })
          .eq("id", ctx.params.reservationId)
          .select("id, store_id, member_id, trainer_id, start_at, end_at, session_type, status")
          .maybeSingle();
        if (q2?.error) return jsonResponse({ error: "予約変更に失敗しました", detail: q2.error.message }, 500);
        if (!q2?.data) return jsonResponse({ error: "予約が見つかりません" }, 404);
        const updated2 = { ...(q2.data ?? {}), guest_name: null, blocks_capacity: true } as any;

        try {
          const lineUserId = (member as any)?.line_user_id as string | null | undefined;
          if (lineUserId) {
            const { data: store } = await (supabase as any).from("stores").select("id, name").eq("id", updated2.store_id).maybeSingle();
            const line = lineTokenForMember(member, store?.name ?? "");
            const st = String(updated2.session_type ?? "store");
            const sessionTypeNormalized: "store" | "online" = st === "online" ? "online" : "store";
            const text = messageForAdminReschedule({
              storeName: store?.name ?? "",
              startAtUtcIso: updated2.start_at,
              endAtUtcIso: updated2.end_at,
              sessionType: sessionTypeNormalized,
            });
            await pushLineMessage({ to: lineUserId, text, token: line.token, debug: { storeName: store?.name ?? "", memberCode: member?.member_code ?? "", lineChannelSource: line.source, lineChannelKey: line.channelKey, hasToken: Boolean(line.token) } });
          }
        } catch (e) {
          console.error("LINE push unexpected error", e);
        }

        return jsonResponse({ reservation: updated2 }, 200);
      }

      return jsonResponse({ error: "予約変更に失敗しました", detail: upErr.message }, 500);
    }
    if (!updated) return jsonResponse({ error: "予約が見つかりません" }, 404);

    try {
      const lineUserId = (member as any)?.line_user_id as string | null | undefined;
      if (lineUserId) {
        const { data: store } = await (supabase as any).from("stores").select("id, name").eq("id", updated.store_id).maybeSingle();
        const line = lineTokenForMember(member, store?.name ?? "");
        const st = String(updated.session_type ?? "store");
        const sessionTypeNormalized: "store" | "online" = st === "online" ? "online" : "store";
        const text = messageForAdminReschedule({
          storeName: store?.name ?? "",
          startAtUtcIso: updated.start_at,
          endAtUtcIso: updated.end_at,
          sessionType: sessionTypeNormalized,
        });
        await pushLineMessage({ to: lineUserId, text, token: line.token, debug: { storeName: store?.name ?? "", memberCode: member?.member_code ?? "", lineChannelSource: line.source, lineChannelKey: line.channelKey, hasToken: Boolean(line.token) } });
      }
    } catch (e) {
      console.error("LINE push unexpected error", e);
    }

    return jsonResponse({ reservation: updated }, 200);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return jsonResponse({ error: "予約更新でエラーが発生しました", detail: message }, 500);
  }
}

