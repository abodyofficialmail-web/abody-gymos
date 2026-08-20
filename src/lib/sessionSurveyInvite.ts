import { createSupabaseServiceClient } from "@/lib/supabase/admin";
import { verifySessionSurveySigned } from "@/lib/sessionSurveySigned";
import { upsertSessionSurveyInvite } from "@/lib/sessionSurveyLine";

export type SessionSurveyInviteContext = {
  invite_id: string;
  member_id: string;
  trainer_id: string;
  store_id: string;
  session_date: string;
  trainer_name: string;
  store_name: string;
  already_responded: boolean;
};

export type SessionSurveyInviteResolveResult =
  | { ok: true } & SessionSurveyInviteContext
  | { ok: false; status: number; error: string; detail?: string };

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

export async function resolveSessionSurveyInviteContext(
  supabase: ReturnType<typeof createSupabaseServiceClient>,
  params: { token?: string; s?: string; sig?: string }
): Promise<SessionSurveyInviteResolveResult> {
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
