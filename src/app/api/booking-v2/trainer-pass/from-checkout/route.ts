import { z } from "zod";
import { jsonResponse } from "../../_cors";
import { activateTrainerPassFromCheckoutSession, stripeGet } from "@/lib/stripeTrainerPass";
import { fetchTrainerVisibilityPassForEmail } from "@/lib/trainerVisibilityPass";
import { createSupabaseServiceClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function OPTIONS() {
  return jsonResponse({}, 200);
}

const querySchema = z.object({
  session_id: z.string().min(1, "session_id は必須です"),
});

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const parsed = querySchema.safeParse({ session_id: url.searchParams.get("session_id") ?? "" });
    if (!parsed.success) {
      return jsonResponse({ error: "クエリが不正です", detail: parsed.error.flatten() }, 400);
    }

    const session = await stripeGet(`/checkout/sessions/${encodeURIComponent(parsed.data.session_id)}`);
    const activated = await activateTrainerPassFromCheckoutSession(session);
    const supabase = createSupabaseServiceClient();
    const found = await fetchTrainerVisibilityPassForEmail(supabase, activated.email);

    return jsonResponse(
      {
        email: activated.email,
        member: { id: activated.memberId, name: activated.memberName },
        trainer_visibility_pass: found?.pass ?? { active: true, subscribe_url: null },
      },
      200
    );
  } catch (e: any) {
    const message = e instanceof Error ? e.message : String(e);
    const status = typeof e?.status === "number" ? e.status : 500;
    return jsonResponse({ error: message }, status);
  }
}
