import { DateTime } from "luxon";
import { z } from "zod";
import { createSupabaseServiceClient } from "@/lib/supabase/admin";
import { POST as postReservation } from "@/app/api/booking-v2/reservations/route";
import { GET as getAvailableSlots } from "@/app/api/booking-v2/available-slots/route";
import { resolveSessionSurveyInviteContext } from "@/lib/sessionSurveyInvite";
import {
  loadNextBookingEligibility,
  loadNextBookingOffer,
} from "@/lib/sessionSurveyNextBooking";
import { lineMessageWithReservationDetails } from "@/lib/lineReservationMessage";
import { linePushTokenForMember, normalizeLineChannelKey } from "@/lib/lineChannel";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "access-control-allow-origin": "*" },
  });
}

const postSchema = z.object({
  token: z.string().uuid().optional(),
  s: z.string().optional(),
  sig: z.string().optional(),
  start_at: z.string().min(1),
  end_at: z.string().min(1),
});

async function slotStillAvailable(storeId: string, date: string, startAt: string, endAt: string): Promise<boolean> {
  const req = new Request(
    `http://session-survey.internal/api/booking-v2/available-slots?store_id=${encodeURIComponent(storeId)}&date=${encodeURIComponent(date)}`
  );
  const res = await getAvailableSlots(req);
  const body = await res.json().catch(() => null);
  if (!res.ok || !Array.isArray(body)) return false;
  return (body as Array<{ start_at?: string; end_at?: string }>).some(
    (s) => s.start_at === startAt && s.end_at === endAt
  );
}

async function pushLine(params: { to: string; text: string; token: string | null }) {
  if (!params.token) return;
  await fetch("https://api.line.me/v2/bot/message/push", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${params.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ to: params.to, messages: [{ type: "text", text: params.text }] }),
  }).catch((e) => console.error("session survey next booking LINE failed", e));
}

export async function POST(request: Request) {
  try {
    const raw = await request.json().catch(() => null);
    const parsed = postSchema.safeParse(raw);
    if (!parsed.success) {
      return json({ error: "予約内容を確認してください", detail: parsed.error.flatten() }, 400);
    }

    const supabase = createSupabaseServiceClient();
    const ctx = await resolveSessionSurveyInviteContext(supabase, {
      token: parsed.data.token,
      s: parsed.data.s,
      sig: parsed.data.sig,
    });
    if (!ctx.ok) return json({ error: ctx.error, detail: ctx.detail }, ctx.status);

    const eligibility = await loadNextBookingEligibility(supabase, ctx.member_id);
    if (!eligibility.eligible) {
      return json({ error: "いまはこちらからの予約案内対象ではありません" }, 409);
    }

    const start = DateTime.fromISO(parsed.data.start_at);
    const end = DateTime.fromISO(parsed.data.end_at);
    if (!start.isValid || !end.isValid || end <= start) {
      return json({ error: "日時が不正です" }, 400);
    }
    const dateYmd = start.setZone("Asia/Tokyo").toISODate();
    if (!dateYmd) return json({ error: "日時が不正です" }, 400);

    const available = await slotStillAvailable(ctx.store_id, dateYmd, parsed.data.start_at, parsed.data.end_at);
    if (!available) {
      return json({ error: "この時間は埋まりました。別の枠を選んでください" }, 409);
    }

    const { data: member, error: memberErr } = await supabase
      .from("members")
      .select("id, member_code, name, email, is_active, line_user_id, line_channel_key")
      .eq("id", ctx.member_id)
      .maybeSingle();
    if (memberErr) return json({ error: "会員の照会に失敗しました", detail: memberErr.message }, 500);
    if (!member?.is_active) return json({ error: "会員が見つかりません" }, 404);

    const { data: todayRows } = await supabase
      .from("reservations")
      .select("session_type")
      .eq("member_id", ctx.member_id)
      .neq("status", "cancelled")
      .gte("start_at", DateTime.fromISO(ctx.session_date, { zone: "Asia/Tokyo" }).startOf("day").toUTC().toISO()!)
      .lt(
        "start_at",
        DateTime.fromISO(ctx.session_date, { zone: "Asia/Tokyo" }).plus({ days: 1 }).startOf("day").toUTC().toISO()!
      )
      .order("start_at", { ascending: true })
      .limit(1);
    const sessionType = todayRows?.[0]?.session_type === "online" ? "online" : "store";

    const email = String(member.email ?? "").trim();
    let reservation: Record<string, unknown> | null = null;

    if (email.includes("@")) {
      const res = await postReservation(
        new Request("http://session-survey.internal/api/booking-v2/reservations", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            store_id: ctx.store_id,
            email,
            start_at: parsed.data.start_at,
            end_at: parsed.data.end_at,
            session_type: sessionType,
          }),
        })
      );
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        detail?: unknown;
        reservation?: Record<string, unknown>;
      };
      if (!res.ok) {
        return json({ error: body.error ?? "予約を確定できませんでした", detail: body.detail }, res.status);
      }
      reservation = body.reservation ?? null;
    } else {
      const { count, error: dupErr } = await supabase
        .from("reservations")
        .select("id", { count: "exact", head: true })
        .eq("member_id", ctx.member_id)
        .lt("start_at", parsed.data.end_at)
        .gt("end_at", parsed.data.start_at)
        .neq("status", "cancelled");
      if (dupErr) return json({ error: "予約の重複確認に失敗しました", detail: dupErr.message }, 500);
      if ((count ?? 0) > 0) return json({ error: "この時間は既に予約されています" }, 409);

      const insertRow = {
        store_id: ctx.store_id,
        member_id: ctx.member_id,
        trainer_id: null,
        start_at: parsed.data.start_at,
        end_at: parsed.data.end_at,
        session_type: sessionType,
        status: "confirmed",
        notes: "created_from=session_survey_next_booking",
        blocks_capacity: true,
      };
      const first = await supabase.from("reservations").insert(insertRow).select("id, start_at, end_at, session_type, store_id, status").single();
      if (first.error) {
        const msg = String(first.error.message ?? "");
        if (first.error.code === "23505") return json({ error: "既に予約されています" }, 409);
        if (/blocks_capacity|guest_name|does not exist|column/i.test(msg)) {
          const rowMinimal = { ...insertRow } as Record<string, unknown>;
          delete rowMinimal.blocks_capacity;
          const second = await supabase
            .from("reservations")
            .insert(rowMinimal as typeof insertRow)
            .select("id, start_at, end_at, session_type, store_id, status")
            .single();
          if (second.error) return json({ error: "予約の保存に失敗しました", detail: second.error.message }, 500);
          reservation = second.data as Record<string, unknown>;
        } else {
          return json({ error: "予約の保存に失敗しました", detail: first.error.message }, 500);
        }
      } else {
        reservation = first.data as Record<string, unknown>;
      }

      const lineUserId = member.line_user_id;
      if (lineUserId && reservation) {
        const text = lineMessageWithReservationDetails({
          storeName: ctx.store_name,
          startAtUtcIso: String(reservation.start_at),
          endAtUtcIso: String(reservation.end_at),
          sessionType,
        });
        const line = linePushTokenForMember({
          lineChannelKey: normalizeLineChannelKey(member.line_channel_key),
          memberCode: String(member.member_code ?? ""),
          fallbackStoreName: ctx.store_name,
        });
        await pushLine({ to: lineUserId, text, token: line.token });
      }
    }

    let next_booking = null;
    try {
      next_booking = await loadNextBookingOffer(supabase, {
        memberId: ctx.member_id,
        storeId: ctx.store_id,
        sessionDate: ctx.session_date,
      });
    } catch (e) {
      console.error("session survey next booking refresh failed", e);
    }

    return json({
      ok: true,
      reservation,
      next_booking,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return json({ error: "予約処理でエラーが発生しました", detail: message }, 500);
  }
}
