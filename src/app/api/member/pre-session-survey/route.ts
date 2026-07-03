import { z } from "zod";
import { DateTime } from "luxon";
import { createSupabaseServiceClient } from "@/lib/supabase/admin";
import {
  PRE_SESSION_INTENSITY_OPTIONS,
  PRE_SESSION_MEAL_OPTIONS,
  type PreSessionIntensityId,
  type PreSessionMealId,
} from "@/lib/preSessionSurvey";
import { verifyPreSessionSurveySigned } from "@/lib/preSessionSurveySigned";

const TZ = "Asia/Tokyo";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "access-control-allow-origin": "*" },
  });
}

const mealIds = PRE_SESSION_MEAL_OPTIONS.map((m) => m.id);
const intensityIds = PRE_SESSION_INTENSITY_OPTIONS.map((i) => i.id);

const postSchema = z.object({
  s: z.string(),
  sig: z.string(),
  condition_score: z.number().int().min(1).max(5),
  meal_status: z.enum(mealIds as [PreSessionMealId, ...PreSessionMealId[]]),
  intensity_preference: z.enum(intensityIds as [PreSessionIntensityId, ...PreSessionIntensityId[]]),
  request_focus: z.string().max(2000).optional(),
  concern: z.string().max(2000).optional(),
  free_comment: z.string().max(4000).optional(),
});

function isTableMissing(err: { code?: string; message?: string } | null): boolean {
  const c = String(err?.code ?? "");
  const m = String(err?.message ?? "");
  return c === "PGRST205" || m.includes("pre_session_survey") || m.includes("Could not find the table");
}

async function resolveContext(
  supabase: ReturnType<typeof createSupabaseServiceClient>,
  s: string,
  sig: string
) {
  const signed = verifyPreSessionSurveySigned(s, sig);
  if (!signed) return { ok: false as const, status: 400, error: "リンクが無効または期限切れです" };

  const { data: reservation, error: rErr } = await supabase
    .from("reservations")
    .select(
      `
      id,
      member_id,
      trainer_id,
      store_id,
      start_at,
      status,
      session_type,
      stores ( name ),
      trainers ( display_name )
    `
    )
    .eq("id", signed.reservation_id)
    .maybeSingle();

  if (rErr) {
    if (isTableMissing(rErr)) return { ok: false as const, status: 503, error: "準備中です" };
    return { ok: false as const, status: 500, error: "取得に失敗しました" };
  }

  if (!reservation?.id || reservation.member_id !== signed.member_id) {
    return { ok: false as const, status: 404, error: "予約が見つかりません" };
  }

  const storeName = (reservation as { stores?: { name?: string } }).stores?.name ?? "";
  const trainerName = (reservation as { trainers?: { display_name?: string } }).trainers?.display_name ?? "";

  const { data: existing } = await supabase
    .from("pre_session_survey_responses")
    .select("id")
    .eq("reservation_id", reservation.id)
    .maybeSingle();

  return {
    ok: true as const,
    reservation,
    store_name: storeName,
    trainer_name: trainerName,
    already_responded: Boolean(existing?.id),
  };
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const s = url.searchParams.get("s") ?? "";
    const sig = url.searchParams.get("sig") ?? "";
    if (!s || !sig) return json({ error: "リンクが不正です" }, 400);

    const supabase = createSupabaseServiceClient();
    const ctx = await resolveContext(supabase, s, sig);
    if (!ctx.ok) return json({ error: ctx.error }, ctx.status);

    const start = DateTime.fromISO(ctx.reservation.start_at).setZone(TZ);
    const sessionLabel = ctx.reservation.session_type === "online" ? "オンライン" : "店舗";

    return json({
      survey: {
        reservation_id: ctx.reservation.id,
        session_start_at: ctx.reservation.start_at,
        session_date_label: start.isValid ? start.setLocale("ja").toFormat("M月d日（ccc） HH:mm") : "",
        session_type_label: sessionLabel,
        store_name: ctx.store_name,
        trainer_name: ctx.trainer_name,
        already_responded: ctx.already_responded,
      },
      meal_options: PRE_SESSION_MEAL_OPTIONS,
      intensity_options: PRE_SESSION_INTENSITY_OPTIONS,
      submit: { s, sig },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return json({ error: message }, 500);
  }
}

export async function POST(req: Request) {
  try {
    const raw = await req.json().catch(() => ({}));
    const parsed = postSchema.safeParse(raw);
    if (!parsed.success) return json({ error: "invalid_body", detail: parsed.error.flatten() }, 400);

    const supabase = createSupabaseServiceClient();
    const ctx = await resolveContext(supabase, parsed.data.s, parsed.data.sig);
    if (!ctx.ok) return json({ error: ctx.error }, ctx.status);
    if (ctx.already_responded) return json({ ok: true, already_responded: true });

    const row = {
      reservation_id: ctx.reservation.id,
      member_id: ctx.reservation.member_id!,
      trainer_id: ctx.reservation.trainer_id,
      store_id: ctx.reservation.store_id,
      session_start_at: ctx.reservation.start_at,
      condition_score: parsed.data.condition_score,
      meal_status: parsed.data.meal_status,
      intensity_preference: parsed.data.intensity_preference,
      request_focus: parsed.data.request_focus?.trim() || null,
      concern: parsed.data.concern?.trim() || null,
      free_comment: parsed.data.free_comment?.trim() || null,
    };

    const { error: insErr } = await supabase.from("pre_session_survey_responses").insert(row);
    if (insErr) {
      if (isTableMissing(insErr)) {
        return json({ error: "ヒアリングの保存準備ができていません。しばらくしてからお試しください。" }, 503);
      }
      const msg = String(insErr.message ?? "");
      if (msg.includes("duplicate") || msg.includes("unique")) {
        return json({ ok: true, already_responded: true });
      }
      return json({ error: "保存に失敗しました", detail: msg }, 500);
    }

    return json({ ok: true });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return json({ error: message }, 500);
  }
}
