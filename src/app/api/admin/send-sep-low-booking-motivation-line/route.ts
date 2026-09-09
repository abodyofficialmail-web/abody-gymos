import { z } from "zod";
import { createSupabaseServiceClient } from "@/lib/supabase/admin";
import {
  SEP_LOW_BOOKING_MOTIVATION_MEMBER_CODES,
  sendSepLowBookingMotivationLine,
} from "@/lib/sepLowBookingMotivationLine";

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
  member_codes: z.array(z.string()).optional(),
  text: z.string().min(1).optional(),
  video_url: z.string().url().optional(),
  preview_image_url: z.string().url().optional(),
  dry_run: z.boolean().optional().default(false),
});

export async function POST(req: Request) {
  try {
    if (!mustAuth(req)) return json({ error: "unauthorized" }, 401);

    const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return json({ error: "invalid_body", detail: parsed.error.flatten() }, 400);

    const memberCodes = (parsed.data.member_codes?.length
      ? parsed.data.member_codes
      : [...SEP_LOW_BOOKING_MOTIVATION_MEMBER_CODES]
    ).map((c) => c.trim().toUpperCase());

    if (!parsed.data.dry_run && (!parsed.data.video_url || !parsed.data.preview_image_url)) {
      return json({ error: "video_url_and_preview_image_url_required_for_send" }, 400);
    }

    const supabase = createSupabaseServiceClient();
    const results = [];
    for (const code of memberCodes) {
      results.push(
        await sendSepLowBookingMotivationLine(supabase, {
          memberCode: code,
          text: parsed.data.text,
          videoUrl: parsed.data.video_url,
          previewImageUrl: parsed.data.preview_image_url,
          dryRun: parsed.data.dry_run,
        }),
      );
      if (!parsed.data.dry_run) await new Promise((r) => setTimeout(r, 300));
    }

    const sent = results.filter((r) => r.ok && !("dry_run" in r && r.dry_run)).length;
    const ready = results.filter((r) => r.ok && "dry_run" in r && r.dry_run).length;
    const failed = results.filter((r) => !r.ok).length;

    return json(
      {
        ok: failed === 0,
        dry_run: parsed.data.dry_run,
        member_count: memberCodes.length,
        sent,
        ready,
        failed,
        results,
      },
      200,
    );
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return json({ error: message }, 500);
  }
}
