import { z } from "zod";
import { jsonResponse } from "@/app/api/booking-v2/_cors";
import { grantMealSessionTicket, MEAL_SESSION_TICKET_PRODUCT } from "@/lib/mealSessionTicket";
import { createSupabaseServiceClient } from "@/lib/supabase/admin";
import { stripeGet } from "@/lib/stripeTrainerPass";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const querySchema = z.object({
  session_id: z.string().min(1),
});

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const parsed = querySchema.safeParse({ session_id: url.searchParams.get("session_id") ?? "" });
    if (!parsed.success) return jsonResponse({ error: "クエリが不正です" }, 400);
    const session = await stripeGet(`/checkout/sessions/${encodeURIComponent(parsed.data.session_id)}`);
    const product = String(session?.metadata?.product ?? "");
    if (product !== MEAL_SESSION_TICKET_PRODUCT) return jsonResponse({ error: "対象外の決済です" }, 400);
    const paid = String(session?.payment_status ?? "") === "paid" || String(session?.status ?? "") === "complete";
    if (!paid) return jsonResponse({ error: "決済が完了していません" }, 409);
    const memberId = String(session?.metadata?.member_id ?? session?.client_reference_id ?? "");
    const granted = await grantMealSessionTicket({
      supabase: createSupabaseServiceClient(),
      memberId,
      stripeSessionId: String(session?.id ?? parsed.data.session_id),
    });
    if (!granted.ok) return jsonResponse({ error: granted.error }, 500);
    return jsonResponse({ ok: true, tickets: granted.tickets, already: Boolean(granted.already) }, 200);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return jsonResponse({ error: message }, 500);
  }
}
