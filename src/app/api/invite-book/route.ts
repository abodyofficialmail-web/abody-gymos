import { z } from "zod";
import { createSupabaseServiceClient } from "@/lib/supabase/admin";
import { jsonResponse } from "@/app/api/booking-v2/_cors";
import { bookInviteSlot, listOpenInviteSlots, loadInviteContext } from "@/lib/inviteShiftBooking";

export async function OPTIONS() {
  return jsonResponse({}, 200);
}

const getSchema = z.object({
  s: z.string().min(1),
  sig: z.string().min(1),
});

const postSchema = z.object({
  s: z.string().min(1),
  sig: z.string().min(1),
  start_at: z.string().min(1),
  end_at: z.string().min(1),
});

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const parsed = getSchema.safeParse({ s: url.searchParams.get("s"), sig: url.searchParams.get("sig") });
    if (!parsed.success) return jsonResponse({ error: "リンクが不正です" }, 400);
    const supabase = createSupabaseServiceClient();
    const loaded = await loadInviteContext(supabase, parsed.data);
    if (!loaded.ok) return jsonResponse({ error: loaded.error }, loaded.status);
    const slots = await listOpenInviteSlots(supabase, loaded.ctx);
    return jsonResponse({
      invite: {
        s: loaded.ctx.query.s,
        sig: loaded.ctx.query.sig,
        store_name: loaded.ctx.store_name,
        trainer_name: loaded.ctx.trainer_name,
        slot_minutes: loaded.ctx.slot_minutes,
        date_label: slots[0]?.date_label ?? null,
      },
      slots,
    });
  } catch (e) {
    return jsonResponse({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
}

export async function POST(request: Request) {
  try {
    const raw = await request.json().catch(() => null);
    const parsed = postSchema.safeParse(raw);
    if (!parsed.success) return jsonResponse({ error: "予約内容を確認してください" }, 400);
    const supabase = createSupabaseServiceClient();
    const loaded = await loadInviteContext(supabase, parsed.data);
    if (!loaded.ok) return jsonResponse({ error: loaded.error }, loaded.status);
    const booked = await bookInviteSlot(supabase, loaded.ctx, parsed.data.start_at, parsed.data.end_at);
    if (!booked.ok) return jsonResponse({ error: booked.error }, booked.status);
    const slots = await listOpenInviteSlots(supabase, loaded.ctx);
    return jsonResponse({ ok: true, reservation: booked.reservation, slots });
  } catch (e) {
    return jsonResponse({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
}
