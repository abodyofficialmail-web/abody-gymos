import { z } from "zod";
import { createSupabaseServiceClient } from "@/lib/supabase/admin";
import { sendMorningWeightReminderForCode } from "@/lib/morningWeightReminderLine";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function mustAuth(req: Request): boolean {
  const gateSecret = process.env.TRAINER_GATE_SECRET?.trim();
  const cronSecret = process.env.CRON_SECRET?.trim();
  const testKey =
    req.headers.get("x-weight-log-test-key") ??
    req.headers.get("x-reservation-reminder-test-key") ??
    "";
  const auth = req.headers.get("authorization") ?? "";
  const bearer = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
  if (gateSecret && (testKey === gateSecret || bearer === gateSecret)) return true;
  if (cronSecret && (testKey === cronSecret || bearer === cronSecret)) return true;
  return false;
}

const bodySchema = z.object({
  member_codes: z.array(z.string()).min(1).optional(),
  dry_run: z.boolean().optional(),
});

export async function POST(req: Request) {
  try {
    if (!mustAuth(req)) return json({ error: "unauthorized" }, 401);

    const raw = await req.json().catch(() => ({}));
    const parsed = bodySchema.safeParse(raw);
    if (!parsed.success) return json({ error: "invalid_body", detail: parsed.error.flatten() }, 400);

    const memberCodes = (parsed.data.member_codes ?? ["EBI020"]).map((c) => c.trim().toUpperCase());
    const dryRun = Boolean(parsed.data.dry_run);
    const supabase = createSupabaseServiceClient();
    const results: Array<Record<string, unknown>> = [];

    for (const memberCode of memberCodes) {
      results.push(
        await sendMorningWeightReminderForCode(supabase, {
          memberCode,
          dryRun,
          force: true,
          recordDispatch: false,
        })
      );
    }

    return json({ ok: true, results }, 200);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return json({ error: message }, 500);
  }
}
