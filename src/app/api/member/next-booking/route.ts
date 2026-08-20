import { createSupabaseServiceClient } from "@/lib/supabase/admin";
import { resolveSessionSurveyInviteContext } from "@/lib/sessionSurveyInvite";
import { loadNextBookingOffer } from "@/lib/sessionSurveyNextBooking";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "access-control-allow-origin": "*" },
  });
}

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

    const offer = await loadNextBookingOffer(supabase, {
      memberId: ctx.member_id,
      storeId: ctx.store_id,
      sessionDate: ctx.session_date,
    });

    return json({
      invite: {
        token: ctx.invite_id || token || "signed",
        session_date: ctx.session_date,
        trainer_name: ctx.trainer_name,
        store_name: ctx.store_name,
      },
      submit: {
        token: ctx.invite_id || undefined,
        s: s || undefined,
        sig: sig || undefined,
      },
      next_booking: offer,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return json({ error: "エラーが発生しました", detail: message }, 500);
  }
}
