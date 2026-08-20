import { z } from "zod";
import { createSupabaseServiceClient } from "@/lib/supabase/admin";
import { sendGoalHearingMondayLine } from "@/lib/goalHearingMondayLine";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function mustAuth(req: Request): boolean {
  const gateSecret = process.env.TRAINER_GATE_SECRET?.trim();
  const cronSecret = process.env.CRON_SECRET?.trim();
  const testKey =
    req.headers.get("x-goal-hearing-test-key") ?? req.headers.get("x-reservation-reminder-test-key") ?? "";
  const auth = req.headers.get("authorization") ?? "";
  const bearer = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
  if (gateSecret && (testKey === gateSecret || bearer === gateSecret)) return true;
  if (cronSecret && (testKey === cronSecret || bearer === cronSecret)) return true;
  const serviceKey = req.headers.get("x-service-role-key") ?? "";
  const expected = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? "";
  if (expected && serviceKey === expected) return true;
  return false;
}

const bodySchema = z.object({
  member_codes: z.array(z.string()).min(1).optional(),
  deliver_to_member_code: z.string().min(1).optional(),
  dry_run: z.boolean().optional(),
});

export async function POST(req: Request) {
  try {
    if (!mustAuth(req)) return json({ error: "unauthorized" }, 401);
    const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return json({ error: "invalid_body", detail: parsed.error.flatten() }, 400);

    const memberCodes = (parsed.data.member_codes ?? ["EBI020"]).map((c) => c.trim().toUpperCase());
    const deliverTo = parsed.data.deliver_to_member_code?.trim().toUpperCase();
    const dryRun = Boolean(parsed.data.dry_run);
    const supabase = createSupabaseServiceClient();
    const results = [];
    for (const memberCode of memberCodes) {
      results.push(
        await sendGoalHearingMondayLine(supabase, {
          memberCode,
          dryRun,
          deliverToMemberCode: deliverTo,
          recordDispatch: false,
        })
      );
    }
    return json({ ok: true, results });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
}
