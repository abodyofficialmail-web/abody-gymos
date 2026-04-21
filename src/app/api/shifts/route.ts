import { NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseServiceClient } from "@/lib/supabase/admin";

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status });
}

const monthQuerySchema = z.object({
  store_id: z.string().uuid(),
  month: z.string().regex(/^\d{4}-\d{2}$/u),
  trainer_id: z.string().uuid().optional(),
});

const bodySchema = z.object({
  trainer_id: z.string().uuid(),
  store_id: z.string().uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u),
  start_at: z.string().min(1),
  end_at: z.string().min(1),
});

function normalizeLocalTime(t: string): string {
  const s = t.trim();
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

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const parsed = monthQuerySchema.safeParse({
      store_id: url.searchParams.get("store_id"),
      month: url.searchParams.get("month"),
      trainer_id: url.searchParams.get("trainer_id") ?? undefined,
    });
    if (!parsed.success) {
      return json({ error: "invalid_query", detail: parsed.error.flatten() }, 400);
    }
    const { store_id, month, trainer_id } = parsed.data;
    const start = `${month}-01`;
    const y = Number(month.slice(0, 4));
    const m = Number(month.slice(5, 7));
    const end = new Date(Date.UTC(y, m, 0));
    const endYmd = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo" }).format(end);

    const supabase = createSupabaseServiceClient();
    let q = supabase
      .from("trainer_shifts")
      .select("id, trainer_id, store_id, shift_date, start_local, end_local, status")
      .eq("store_id", store_id)
      .gte("shift_date", start)
      .lte("shift_date", endYmd)
      .neq("status", "draft");
    if (trainer_id) q = q.eq("trainer_id", trainer_id);
    const { data, error } = await q.order("shift_date", { ascending: true }).order("start_local", { ascending: true });
    if (error) return json({ error: "fetch_failed", detail: error.message }, 500);
    return json({ shifts: data ?? [] }, 200);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return json({ error: "unexpected_error", detail: message }, 500);
  }
}

export async function POST(req: Request) {
  try {
    const raw = await req.json().catch(() => null);
    const parsed = bodySchema.safeParse(raw);
    if (!parsed.success) {
      return json({ error: "invalid_body", detail: parsed.error.flatten() }, 400);
    }
    const { trainer_id, store_id, date, start_at, end_at } = parsed.data;

    const supabase = createSupabaseServiceClient();
    const insertRow = {
      trainer_id,
      store_id,
      shift_date: date,
      start_local: normalizeLocalTime(start_at),
      end_local: normalizeLocalTime(end_at),
      status: "confirmed",
    } as any;

    const { data, error } = await supabase
      .from("trainer_shifts")
      .insert(insertRow)
      .select("id, trainer_id, store_id, shift_date, start_local, end_local, status")
      .single();
    if (error) return json({ error: "insert_failed", detail: error.message }, 500);
    return json({ shift: data }, 200);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return json({ error: "unexpected_error", detail: message }, 500);
  }
}

