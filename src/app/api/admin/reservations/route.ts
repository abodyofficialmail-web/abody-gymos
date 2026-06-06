import { z } from "zod";
import { DateTime } from "luxon";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import timezone from "dayjs/plugin/timezone";
import { createSupabaseServiceClient } from "@/lib/supabase/admin";
import { jsonResponse } from "@/app/api/booking-v2/_cors";
import { linePushTokenForMember, normalizeLineChannelKey } from "@/lib/lineChannel";
import { lineMessageWithReservationDetails } from "@/lib/lineReservationMessage";
import type { Database } from "@/types/database";
import type { SupabaseClient } from "@supabase/supabase-js";
import { effectiveBookingCapacity } from "@/lib/bookingStoreCapacity";

dayjs.extend(utc);
dayjs.extend(timezone);

export async function OPTIONS() {
  return jsonResponse({}, 200);
}

const bodySchema = z
  .object({
    store_id: z.string().uuid(),
    member_id: z.string().uuid().optional(),
    guest_name: z.string().optional(),
    trainer_id: z.string().uuid().optional(),
    blocks_capacity: z.boolean().optional(),
    start_at: z.string().min(1),
    end_at: z.string().min(1),
    session_type: z.enum(["store", "online"]).optional().default("store"),
  })
  .superRefine((data, ctx) => {
    const trial = Boolean(String(data.guest_name ?? "").trim());
    if (trial) {
      if (!data.trainer_id) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "担当トレーナーを指定してください", path: ["trainer_id"] });
      }
      if (data.blocks_capacity === undefined) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "予約枠を確保するか指定してください", path: ["blocks_capacity"] });
      }
      if (data.member_id) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "体験予約では会員IDは指定できません", path: ["member_id"] });
      }
    } else if (!data.member_id) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "会員を指定してください", path: ["member_id"] });
    }
  });

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

async function countOverlappingBlocking(params: {
  supabase: ReturnType<typeof createSupabaseServiceClient>;
  store_id: string;
  end_at: string;
  start_at: string;
}) {
  const { supabase, store_id, end_at, start_at } = params;
  const run = (onlyBlockingCapacity: boolean) => {
    let q = supabase
      .from("reservations")
      .select("id", { count: "exact", head: true })
      .eq("store_id", store_id)
      .lt("start_at", end_at)
      .gt("end_at", start_at)
      .neq("status", "cancelled");
    if (onlyBlockingCapacity) q = q.eq("blocks_capacity", true);
    return q;
  };
  const primary = await run(true);
  if (!primary.error) return primary;
  return await run(false);
}

export async function POST(request: Request) {
  try {
    const raw = await request.json().catch(() => null);
    const parsed = bodySchema.safeParse(raw);
    if (!parsed.success) return jsonResponse({ error: "リクエストが不正です", detail: parsed.error.flatten() }, 400);

    const { store_id, member_id, guest_name, trainer_id, blocks_capacity, start_at, end_at, session_type } = parsed.data;
    const supabase = createSupabaseServiceClient();

    const { data: store, error: storeErr } = await supabase.from("stores").select("id, name").eq("id", store_id).maybeSingle();
    if (storeErr) return jsonResponse({ error: "店舗の取得に失敗しました", detail: storeErr.message }, 500);
    if (!store) return jsonResponse({ error: "店舗が見つかりません" }, 404);

    const trialGuestName = String(guest_name ?? "").trim();
    const isTrial = trialGuestName.length > 0;

    if (isTrial) {
      const tid = trainer_id!;
      const blocks = blocks_capacity!;

      const { data: trainerRow, error: trErr } = await supabase
        .from("trainers")
        .select("id, store_id, is_active")
        .eq("id", tid)
        .maybeSingle();
      if (trErr) return jsonResponse({ error: "トレーナーの照会に失敗しました", detail: trErr.message }, 500);
      if (!trainerRow || !trainerRow.is_active) {
        return jsonResponse({ error: "担当トレーナーが不正です", detail: { trainer_id: tid } }, 400);
      }

      const newStart = dayjs(start_at).tz("Asia/Tokyo");
      const newEnd = dayjs(end_at).tz("Asia/Tokyo");
      const dateYmd = newStart.format("YYYY-MM-DD");
      const startMin = newStart.hour() * 60 + newStart.minute();
      const endMin = newEnd.hour() * 60 + newEnd.minute();
      if (!dateYmd || !Number.isFinite(startMin) || !Number.isFinite(endMin) || endMin <= startMin) {
        return jsonResponse({ error: "start_at / end_at が不正です" }, 400);
      }

      const shifts = await fetchShiftsForCapacityCheck({ supabase, store_id, dateYmd });

      if (blocks) {
        const availableTrainerSet = new Set<string>();
        for (const s of shifts) {
          if (s.is_break) continue;
          if (s.start_min <= startMin && s.end_min >= endMin) availableTrainerSet.add(s.trainer_id);
        }
        // 開催店舗にシフトが無くても、管理画面で明示した担当トレーナーは枠として数える（他店所属トレでの体験など）
        availableTrainerSet.add(tid);
        const capacity = effectiveBookingCapacity({
          storeName: store.name,
          trainerCount: availableTrainerSet.size,
        });

        const { count: bookedCount, error: bookedErr } = await countOverlappingBlocking({
          supabase,
          store_id,
          end_at,
          start_at,
        });
        if (bookedErr) return jsonResponse({ error: "予約状況の確認に失敗しました", detail: bookedErr.message }, 500);
        if ((bookedCount ?? 0) >= capacity) return jsonResponse({ error: "この時間は予約できません" }, 409);
      }

      const insertRow: Database["public"]["Tables"]["reservations"]["Insert"] = {
        store_id,
        member_id: null,
        trainer_id: tid,
        guest_name: trialGuestName,
        blocks_capacity: blocks,
        start_at,
        end_at,
        session_type,
        status: "confirmed",
        notes: "created_from=admin_dashboard_trial",
      };

      const selectTrialFull =
        "id, store_id, member_id, trainer_id, guest_name, blocks_capacity, start_at, end_at, session_type, status, created_at";
      const selectTrialLegacy =
        "id, store_id, member_id, trainer_id, guest_name, start_at, end_at, session_type, status, created_at";
      const selectTrialMinimal =
        "id, store_id, member_id, trainer_id, start_at, end_at, session_type, status, created_at";

      let inserted: Record<string, unknown> | null = null;
      let insErr: { message?: string; code?: string } | null = null;
      {
        const first = await supabase.from("reservations").insert(insertRow).select(selectTrialFull).single();
        inserted = first.data as Record<string, unknown> | null;
        insErr = first.error;
      }
      const schemaMsg = (e: unknown) => String((e as any)?.message ?? "");
      if (insErr && /blocks_capacity|guest_name|schema cache|Could not find/i.test(schemaMsg(insErr))) {
        const row2 = { ...(insertRow as Record<string, unknown>) };
        delete row2.blocks_capacity;
        const second = await supabase.from("reservations").insert(row2 as any).select(selectTrialLegacy).single();
        inserted = second.data as Record<string, unknown> | null;
        insErr = second.error;
      }
      if (insErr && /guest_name|schema cache|Could not find/i.test(schemaMsg(insErr))) {
        const row3: Record<string, unknown> = {
          store_id,
          member_id: null,
          trainer_id: tid,
          start_at,
          end_at,
          session_type,
          status: "confirmed",
          notes: `created_from=admin_dashboard_trial|guest=${encodeURIComponent(trialGuestName)}`,
        };
        const third = await supabase.from("reservations").insert(row3 as any).select(selectTrialMinimal).single();
        inserted = third.data as Record<string, unknown> | null;
        insErr = third.error;
      }
      if (insErr) {
        if ((insErr as any)?.code === "23505") return jsonResponse({ error: "既に予約されています" }, 409);
        return jsonResponse({ error: "予約の保存に失敗しました", detail: insErr.message }, 500);
      }
      if (!inserted) {
        return jsonResponse({ error: "予約の保存に失敗しました" }, 500);
      }

      return jsonResponse(
        {
          reservation: inserted,
          guest: { name: trialGuestName },
          store: { id: store.id, name: store.name ?? "" },
        },
        200
      );
    }

    const memberIdForInsert = member_id as string;
    const { data: member, error: memberErr } = await (supabase as any)
      .from("members")
      .select("id, member_code, name, is_active, line_user_id, line_channel_key")
      .eq("id", memberIdForInsert)
      .maybeSingle();
    if (memberErr) return jsonResponse({ error: "会員の取得に失敗しました", detail: memberErr.message }, 500);
    if (!member || !member.is_active) return jsonResponse({ error: "会員が見つかりません" }, 404);

    {
      const newStart = dayjs(start_at).tz("Asia/Tokyo");
      const newEnd = dayjs(end_at).tz("Asia/Tokyo");
      const dateYmd = newStart.format("YYYY-MM-DD");
      const startMin = newStart.hour() * 60 + newStart.minute();
      const endMin = newEnd.hour() * 60 + newEnd.minute();
      if (!dateYmd || !Number.isFinite(startMin) || !Number.isFinite(endMin) || endMin <= startMin) {
        return jsonResponse({ error: "start_at / end_at が不正です" }, 400);
      }

      const shifts = await fetchShiftsForCapacityCheck({ supabase, store_id, dateYmd });
      const availableTrainerSet = new Set<string>();
      for (const s of shifts) {
        if (s.is_break) continue;
        if (s.start_min <= startMin && s.end_min >= endMin) availableTrainerSet.add(s.trainer_id);
      }
      const capacity = effectiveBookingCapacity({
        storeName: store.name,
        trainerCount: availableTrainerSet.size,
      });
      if (capacity === 0) return jsonResponse({ error: "この時間は予約できません" }, 409);

      const { count: bookedCount, error: bookedErr } = await countOverlappingBlocking({
        supabase,
        store_id,
        end_at,
        start_at,
      });
      if (bookedErr) return jsonResponse({ error: "予約状況の確認に失敗しました", detail: bookedErr.message }, 500);
      if ((bookedCount ?? 0) >= capacity) return jsonResponse({ error: "この時間は予約できません" }, 409);
    }

    {
      const { count, error } = await supabase
        .from("reservations")
        .select("id", { count: "exact", head: true })
        .eq("member_id", memberIdForInsert)
        .lt("start_at", end_at)
        .gt("end_at", start_at)
        .neq("status", "cancelled");
      if (error) return jsonResponse({ error: "予約の重複確認に失敗しました", detail: error.message }, 500);
      if ((count ?? 0) > 0) return jsonResponse({ error: "この時間は既に予約されています" }, 409);
    }

    const insertRow: Database["public"]["Tables"]["reservations"]["Insert"] = {
      store_id,
      member_id: memberIdForInsert,
      start_at,
      end_at,
      session_type,
      status: "confirmed",
      notes: "created_from=admin_dashboard",
      blocks_capacity: true,
    };
    (insertRow as any).trainer_id = null;

    const selectMemberFull =
      "id, store_id, member_id, trainer_id, guest_name, blocks_capacity, start_at, end_at, session_type, status, created_at";
    const selectMemberLegacy =
      "id, store_id, member_id, trainer_id, start_at, end_at, session_type, status, created_at";

    let inserted: Record<string, unknown> | null = null;
    let insErr: { message?: string; code?: string } | null = null;
    {
      const first = await supabase.from("reservations").insert(insertRow).select(selectMemberFull).single();
      inserted = first.data as Record<string, unknown> | null;
      insErr = first.error;
    }
    if (insErr && /blocks_capacity|schema cache|Could not find/i.test(String((insErr as any)?.message ?? ""))) {
      const row2 = { ...(insertRow as Record<string, unknown>) };
      delete row2.blocks_capacity;
      const second = await supabase.from("reservations").insert(row2 as any).select(selectMemberLegacy).single();
      inserted = second.data as Record<string, unknown> | null;
      insErr = second.error;
    }
    if (insErr) {
      if ((insErr as any)?.code === "23505") return jsonResponse({ error: "既に予約されています" }, 409);
      return jsonResponse({ error: "予約の保存に失敗しました", detail: insErr.message }, 500);
    }
    if (!inserted) {
      return jsonResponse({ error: "予約の保存に失敗しました" }, 500);
    }

    try {
      const lineUserId = (member as any)?.line_user_id as string | null | undefined;
      if (lineUserId) {
        const line = linePushTokenForMember({
          lineChannelKey: normalizeLineChannelKey((member as any)?.line_channel_key),
          memberCode: String((member as any)?.member_code ?? ""),
          fallbackStoreName: store.name ?? "",
        });
        const st = (String(inserted["session_type"] ?? "") as string | null | undefined) || session_type || "store";
        const sessionTypeNormalized: "store" | "online" = st === "online" ? "online" : "store";
        const text = lineMessageWithReservationDetails({
          storeName: store.name ?? "",
          startAtUtcIso: String(inserted["start_at"] ?? ""),
          endAtUtcIso: String(inserted["end_at"] ?? ""),
          sessionType: sessionTypeNormalized,
        });
        await pushLineMessage({
          to: lineUserId,
          text,
          token: line.token,
          debug: {
            storeName: store.name ?? "",
            memberCode: (member as any)?.member_code ?? "",
            lineChannelSource: line.source,
            lineChannelKey: line.channelKey,
            hasToken: Boolean(line.token),
          },
        });
      }
    } catch (e) {
      console.error("LINE push unexpected error", e);
    }

    return jsonResponse(
      {
        reservation: inserted,
        member: { id: member.id, member_code: member.member_code ?? "", name: member.name ?? "" },
        store: { id: store.id, name: store.name ?? "" },
      },
      200
    );
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return jsonResponse({ error: "予約追加でエラーが発生しました", detail: message }, 500);
  }
}

