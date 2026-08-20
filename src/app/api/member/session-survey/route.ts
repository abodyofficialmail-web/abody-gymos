import { z } from "zod";
import { createSupabaseServiceClient } from "@/lib/supabase/admin";
import {
  SESSION_SURVEY_HIGHLIGHTS,
  SESSION_SURVEY_INTENSITY,
  followupStatusForRating,
  needsSessionSurveyFollowup,
} from "@/lib/sessionSurvey";
import { upsertSessionSurveyInvite } from "@/lib/sessionSurveyLine";
import { resolveSessionSurveyInviteContext } from "@/lib/sessionSurveyInvite";
import { loadNextBookingOffer } from "@/lib/sessionSurveyNextBooking";

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

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const token = url.searchParams.get("token")?.trim();
    const s = url.searchParams.get("s")?.trim();
    const sig = url.searchParams.get("sig")?.trim();
    if (!token && !(s && sig)) return json({ error: "リンクが不正です" }, 400);

    const supabase = createSupabaseServiceClient();
    const ctx = await resolveSessionSurveyInviteContext(supabase, { token, s, sig });
    if (!ctx.ok) return json({ error: ctx.error, detail: ctx.detail }, ctx.status);

    let next_booking = null;
    try {
      next_booking = await loadNextBookingOffer(supabase, {
        memberId: ctx.member_id,
        storeId: ctx.store_id,
        sessionDate: ctx.session_date,
      });
    } catch (e) {
      console.error("session survey next booking offer failed", e);
    }

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
      next_booking,
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
    const ctx = await resolveSessionSurveyInviteContext(supabase, {
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
