import { z } from "zod";
import { createSupabaseServiceClient } from "@/lib/supabase/admin";
import { sendJuneLowBookingLine } from "@/lib/juneLowBookingLine";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function mustAuth(req: Request): boolean {
  const gateSecret = process.env.TRAINER_GATE_SECRET?.trim();
  const testKey = req.headers.get("x-reservation-reminder-test-key") ?? "";
  if (gateSecret && testKey === gateSecret) return true;
  const serviceKey = req.headers.get("x-service-role-key") ?? "";
  const expected = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? "";
  return Boolean(expected && serviceKey === expected);
}

const bodySchema = z.object({
  member_codes: z.array(z.string()).min(1),
  dry_run: z.boolean().optional().default(false),
});

export async function POST(req: Request) {
  try {
    if (!mustAuth(req)) return json({ error: "unauthorized" }, 401);

    const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return json({ error: "invalid_body", detail: parsed.error.flatten() }, 400);

    const supabase = createSupabaseServiceClient();
    const results = [];
    for (const code of parsed.data.member_codes) {
      results.push(await sendJuneLowBookingLine(supabase, { memberCode: code, dryRun: parsed.data.dry_run }));
    }

    return json({ ok: results.every((r) => r.ok), results }, 200);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return json({ error: message }, 500);
  }
}
