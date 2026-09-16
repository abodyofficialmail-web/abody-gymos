import { z } from "zod";
import { jsonResponse } from "@/app/api/booking-v2/_cors";
import { activateMealPersonalPassFromCheckoutSession } from "@/lib/stripeMealPersonalPass";
import { stripeGet } from "@/lib/stripeTrainerPass";

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
    const activated = await activateMealPersonalPassFromCheckoutSession(session);
    return jsonResponse({ ok: true, member_id: activated.memberId }, 200);
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    const status = typeof e === "object" && e && "status" in e && typeof (e as { status?: number }).status === "number"
      ? (e as { status: number }).status
      : 500;
    return jsonResponse({ error: message }, status);
  }
}
