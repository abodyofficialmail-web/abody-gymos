import { z } from "zod";
import { DateTime } from "luxon";
import { createSupabaseServiceClient } from "@/lib/supabase/admin";
import { jsonResponse } from "@/app/api/booking-v2/_cors";

const ymdSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u);

const getQuerySchema = z.object({
  date: ymdSchema.optional(),
  month: z.string().regex(/^\d{4}-\d{2}$/u).optional(),
  store_id: z.string().uuid().optional(),
  trainer_id: z.string().uuid().optional(),
});

const postBodySchema = z.object({
  store_id: z.string().uuid(),
  trainer_id: z.string().uuid(),
  date: ymdSchema,
  start_at: z.string().min(1), // HH:MM or HH:MM:SS
  end_at: z.string().min(1),
  title: z.string().min(1),
  notes: z.string().optional().nullable(),
  block_booking: z.boolean().optional().default(true),
});

const patchBodySchema = z.object({
  id: z.string().uuid(),
  date: ymdSchema.optional(),
  start_at: z.string().min(1).optional(),
  end_at: z.string().min(1).optional(),
  title: z.string().min(1).optional(),
  notes: z.string().optional().nullable(),
  block_booking: z.boolean().optional(),
});

const deleteBodySchema = z.object({
  id: z.string().uuid(),
});

function normalizeLocalTime(t: string): string {
  const s = String(t ?? "").trim();
  if (/^\d{2}:\d{2}:\d{2}$/u.test(s)) return s;
  if (/^\d{1,2}:\d{2}$/u.test(s)) {
    const [h, m] = s.split(":");
    return `${String(Number(h)).padStart(2, "0")}:${m}:00`;
  }
  if (/^\d{1,2}:\d{2}:\d{2}$/u.test(s)) {
    const [h, m, sec] = s.split(":");
    return `${String(Number(h)).padStart(2, "0")}:${m}:${sec}`;
  }
  return s;
}

export async function OPTIONS() {
  return jsonResponse({}, 200);
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const parsed = getQuerySchema.safeParse({
      date: url.searchParams.get("date") ?? undefined,
      month: url.searchParams.get("month") ?? undefined,
      store_id: url.searchParams.get("store_id") ?? undefined,
      trainer_id: url.searchParams.get("trainer_id") ?? undefined,
    });
    if (!parsed.success) return jsonResponse({ error: "invalid_query", detail: parsed.error.flatten() }, 400);
    const { date, month, store_id, trainer_id } = parsed.data;

    const supabase = createSupabaseServiceClient();

    let q = supabase
      .from("trainer_events")
      .select("id, store_id, trainer_id, event_date, start_local, end_local, title, notes, block_booking, created_at, updated_at")
      .order("event_date", { ascending: true })
      .order("start_local", { ascending: true });

    if (store_id) q = q.eq("store_id", store_id);
    if (trainer_id) q = q.eq("trainer_id", trainer_id);

    if (date) {
      q = q.eq("event_date", date);
    } else if (month) {
      const start = DateTime.fromISO(`${month}-01`, { zone: "Asia/Tokyo" }).startOf("month");
      if (!start.isValid) return jsonResponse({ error: "invalid_month" }, 400);
      const end = start.plus({ months: 1 });
      q = q.gte("event_date", start.toISODate()!).lt("event_date", end.toISODate()!);
    }

    const { data, error } = await q;
    if (error) return jsonResponse({ error: "fetch_failed", detail: error.message }, 500);
    return jsonResponse({ events: data ?? [] }, 200);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return jsonResponse({ error: "unexpected_error", detail: message }, 500);
  }
}

export async function POST(req: Request) {
  try {
    const raw = await req.json().catch(() => null);
    const parsed = postBodySchema.safeParse(raw);
    if (!parsed.success) return jsonResponse({ error: "invalid_body", detail: parsed.error.flatten() }, 400);
    const { store_id, trainer_id, date, start_at, end_at, title, notes, block_booking } = parsed.data;

    const supabase = createSupabaseServiceClient();
    const insertRow = {
      store_id,
      trainer_id,
      event_date: date,
      start_local: normalizeLocalTime(start_at),
      end_local: normalizeLocalTime(end_at),
      title: title.trim(),
      notes: notes ?? null,
      block_booking,
    } as any;

    const { data, error } = await supabase.from("trainer_events").insert(insertRow).select("*").single();
    if (error) return jsonResponse({ error: "insert_failed", detail: error.message }, 500);
    return jsonResponse({ event: data }, 200);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return jsonResponse({ error: "unexpected_error", detail: message }, 500);
  }
}

export async function PATCH(req: Request) {
  try {
    const raw = await req.json().catch(() => null);
    const parsed = patchBodySchema.safeParse(raw);
    if (!parsed.success) return jsonResponse({ error: "invalid_body", detail: parsed.error.flatten() }, 400);
    const { id, date, start_at, end_at, title, notes, block_booking } = parsed.data;

    const update: Record<string, unknown> = {};
    if (date !== undefined) update.event_date = date;
    if (start_at !== undefined) update.start_local = normalizeLocalTime(start_at);
    if (end_at !== undefined) update.end_local = normalizeLocalTime(end_at);
    if (title !== undefined) update.title = title.trim();
    if (notes !== undefined) update.notes = notes ?? null;
    if (block_booking !== undefined) update.block_booking = block_booking;
    if (Object.keys(update).length === 0) return jsonResponse({ error: "invalid_body", detail: "No fields to update" }, 400);

    const supabase = createSupabaseServiceClient();
    const { data, error } = await supabase.from("trainer_events").update(update as any).eq("id", id).select("*").single();
    if (error) return jsonResponse({ error: "update_failed", detail: error.message }, 500);
    return jsonResponse({ event: data }, 200);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return jsonResponse({ error: "unexpected_error", detail: message }, 500);
  }
}

export async function DELETE(req: Request) {
  try {
    const raw = await req.json().catch(() => null);
    const parsed = deleteBodySchema.safeParse(raw);
    if (!parsed.success) return jsonResponse({ error: "invalid_body", detail: parsed.error.flatten() }, 400);
    const { id } = parsed.data;

    const supabase = createSupabaseServiceClient();
    const { error } = await supabase.from("trainer_events").delete().eq("id", id);
    if (error) return jsonResponse({ error: "delete_failed", detail: error.message }, 500);
    return jsonResponse({ ok: true }, 200);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return jsonResponse({ error: "unexpected_error", detail: message }, 500);
  }
}

