import { z } from "zod";
import { createSupabaseServiceClient } from "@/lib/supabase/admin";
import { sendPreSessionReminderTest } from "@/lib/preSessionReminderLine";

const DEFAULT_APP_URL = "https://abody-gymos.vercel.app";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function mustAuth(req: Request): boolean {
  const gateSecret = process.env.TRAINER_GATE_SECRET?.trim();
  const testKey = req.headers.get("x-reservation-reminder-test-key") ?? "";
  return Boolean(gateSecret && testKey === gateSecret);
}

function resolveAppUrl() {
  return process.env.NEXT_PUBLIC_APP_URL?.trim()?.replace(/\/$/, "") || DEFAULT_APP_URL;
}

const bodySchema = z.object({
  member_codes: z.array(z.string()).min(1).optional(),
});

export async function POST(req: Request) {
  try {
    if (!mustAuth(req)) return json({ error: "unauthorized" }, 401);

    const raw = await req.json().catch(() => ({}));
    const parsed = bodySchema.safeParse(raw);
    if (!parsed.success) return json({ error: "invalid_body", detail: parsed.error.flatten() }, 400);

    const memberCodes = (parsed.data.member_codes ?? ["EBI020"]).map((c) => c.trim().toUpperCase());
    const supabase = createSupabaseServiceClient();
    const appUrl = resolveAppUrl();
    const results: Array<Record<string, unknown>> = [];

    for (const memberCode of memberCodes) {
      results.push(await sendPreSessionReminderTest(supabase, { memberCode, appUrl }));
    }

    return json({ ok: true, results }, 200);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return json({ error: message }, 500);
  }
}
