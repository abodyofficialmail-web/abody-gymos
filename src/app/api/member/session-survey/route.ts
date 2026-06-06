import { z } from "zod";
import { createSupabaseServiceClient } from "@/lib/supabase/admin";
import {
  SESSION_SURVEY_HIGHLIGHTS,
  SESSION_SURVEY_INTENSITY,
  followupStatusForRating,
  needsSessionSurveyFollowup,
} from "@/lib/sessionSurvey";
import { verifySessionSurveySigned } from "@/lib/sessionSurveySigned";
import { upsertSessionSurveyInvite } from "@/lib/sessionSurveyLine";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "access-control-allow-origin": "*" },
  });
}

const highlightIds = SESSION_SURVEY_HIGHLIGHTS.map((h) => h.id);
const intensityIds = SESSION_SURVEY_INTENSITY.map((i) => i.id);

const postSchema = z.object({
  token: z.string().uuid().optional(),
  s: z.string().optional(),
  sig: z.string().optional(),
  rating: z.number().int().min(1).max(5),
  highlights: z.array(z.enum(highlightIds as [string, ...string[]])).min(1),
  intensity_feedback: z.enum(intensityIds as [string, ...string[]]),
  comment_general: z.string().max(4000).optional(),
  comment_improve: z.string().max(4000).optional(),
  comment_questions: z.string().max(4000).optional(),
});

async function loadTrainerStore(
  supabase: ReturnType<typeof createSupabaseServiceClient>,
  trainerId: string,
  storeId: string
) {
  const [{ data: trainer }, { data: store }] = await Promise.all([
    supabase.from("trainers").select("display_name").eq("id", trainerId).maybeSingle(),
    supabase.from("stores").select("name").eq("id", storeId).maybeSingle(),
  ]);
  return {
    trainer_name: trainer?.display_name ?? "",
    store_name: store?.name ?? "",
  };
}

async function resolveInviteContext(
  supabase: ReturnType<typeof createSupabaseServiceClient>,
  params: { token?: string; s?: string; sig?: string }
): Promise<
  | {
      ok: true;
      invite_id: string;
      member_id: string;
      trainer_id: string;
      store_id: string;
      session_date: string;
      trainer_name: string;
      store_name: string;
      already_responded: boolean;
    }
  | { ok: false; status: number; error: string; detail?: string }
> {
  if (params.token) {
    const { data: invite, error } = await supabase
      .from("session_survey_invites")
      .select("id, session_date, member_id, trainer_id, store_id")
      .eq("id", params.token)
      .maybeSingle();

    if (error) {
      const msg = String(error.message ?? "");
      if (msg.includes("session_survey")) {
        return { ok: false, status: 503, error: "アンケートの準備ができていません", detail: msg };
      }
      return { ok: false, status: 500, error: "取得に失敗しました", detail: msg };
    }
    if (!invite) return { ok: false, status: 404, error: "リンクが無効です" };

    const meta = await loadTrainerStore(supabase, invite.trainer_id, invite.store_id);
    const { data: existing } = await supabase
      .from("session_survey_responses")
      .select("id")
      .eq("invite_id", invite.id)
      .maybeSingle();

    return {
      ok: true,
      invite_id: invite.id,
      member_id: invite.member_id,
      trainer_id: invite.trainer_id,
      store_id: invite.store_id,
      session_date: invite.session_date,
      trainer_name: meta.trainer_name,
      store_name: meta.store_name,
      already_responded: Boolean(existing?.id),
    };
  }

  const signed = verifySessionSurveySigned(params.s ?? "", params.sig ?? "");
  if (!signed) return { ok: false, status: 400, error: "リンクが無効または期限切れです" };

  const meta = await loadTrainerStore(supabase, signed.trainer_id, signed.store_id);
  const invite = await upsertSessionSurveyInvite(supabase, {
    member_id: signed.member_id,
    trainer_id: signed.trainer_id,
    store_id: signed.store_id,
    session_date: signed.session_date,
    client_note_id: signed.client_note_id ?? null,
  });

  if (!invite) {
    return {
      ok: true,
      invite_id: "",
      member_id: signed.member_id,
      trainer_id: signed.trainer_id,
      store_id: signed.store_id,
      session_date: signed.session_date,
      trainer_name: meta.trainer_name,
      store_name: meta.store_name,
      already_responded: false,
    };
  }

  const { data: existing } = await supabase
    .from("session_survey_responses")
    .select("id")
    .eq("invite_id", invite.id)
    .maybeSingle();

  return {
    ok: true,
    invite_id: invite.id,
    member_id: signed.member_id,
    trainer_id: signed.trainer_id,
    store_id: signed.store_id,
    session_date: signed.session_date,
    trainer_name: meta.trainer_name,
    store_name: meta.store_name,
    already_responded: Boolean(existing?.id),
  };
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const token = url.searchParams.get("token")?.trim();
    const s = url.searchParams.get("s")?.trim();
    const sig = url.searchParams.get("sig")?.trim();
    if (!token && !(s && sig)) return json({ error: "リンクが不正です" }, 400);

    const supabase = createSupabaseServiceClient();
    const ctx = await resolveInviteContext(supabase, { token, s, sig });
    if (!ctx.ok) return json({ error: ctx.error, detail: ctx.detail }, ctx.status);

    return json({
      invite: {
        token: ctx.invite_id || token || "signed",
        session_date: ctx.session_date,
        trainer_name: ctx.trainer_name,
        store_name: ctx.store_name,
        already_responded: ctx.already_responded,
      },
      highlights: SESSION_SURVEY_HIGHLIGHTS,
      intensity_options: SESSION_SURVEY_INTENSITY,
      submit: {
        token: ctx.invite_id || undefined,
        s: s || undefined,
        sig: sig || undefined,
      },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return json({ error: "エラーが発生しました", detail: message }, 500);
  }
}

export async function POST(request: Request) {
  try {
    const raw = await request.json().catch(() => null);
    const parsed = postSchema.safeParse(raw);
    if (!parsed.success) {
      return json({ error: "入力内容を確認してください", detail: parsed.error.flatten() }, 400);
    }

    const supabase = createSupabaseServiceClient();
    const ctx = await resolveInviteContext(supabase, {
      token: parsed.data.token,
      s: parsed.data.s,
      sig: parsed.data.sig,
    });
    if (!ctx.ok) return json({ error: ctx.error, detail: ctx.detail }, ctx.status);
    if (ctx.already_responded) return json({ error: "すでに回答済みです" }, 409);
    let inviteId = ctx.invite_id;
    if (!inviteId) {
      const retry = await upsertSessionSurveyInvite(supabase, {
        member_id: ctx.member_id,
        trainer_id: ctx.trainer_id,
        store_id: ctx.store_id,
        session_date: ctx.session_date,
        client_note_id: null,
      });
      if (!retry?.id) {
        return json(
          {
            error: "回答の保存準備ができていません",
            detail:
              "Supabase に session_survey テーブルがありません。Dashboard の SQL Editor で supabase/migrations/20260523120000_session_survey.sql を実行してください。",
          },
          503
        );
      }
      inviteId = retry.id;
    }

    let highlights = [...parsed.data.highlights];
    if (highlights.includes("none") && highlights.length > 1) highlights = ["none"];

    const rating = parsed.data.rating;
    const { data: row, error: insErr } = await supabase
      .from("session_survey_responses")
      .insert({
        invite_id: inviteId,
        member_id: ctx.member_id,
        trainer_id: ctx.trainer_id,
        store_id: ctx.store_id,
        session_date: ctx.session_date,
        rating,
        highlights,
        intensity_feedback: parsed.data.intensity_feedback,
        comment_general: parsed.data.comment_general?.trim() || null,
        comment_improve: parsed.data.comment_improve?.trim() || null,
        comment_questions: parsed.data.comment_questions?.trim() || null,
        needs_followup: needsSessionSurveyFollowup(rating),
        followup_status: followupStatusForRating(rating),
      })
      .select("id, rating, needs_followup")
      .single();

    if (insErr) return json({ error: "保存に失敗しました", detail: insErr.message }, 500);

    return json({ ok: true, response: row }, 200);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return json({ error: "エラーが発生しました", detail: message }, 500);
  }
}
