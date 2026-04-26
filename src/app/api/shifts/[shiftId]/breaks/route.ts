import { NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseServiceClient } from "@/lib/supabase/admin";

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status });
}

const postSchema = z.object({
  start_time: z.string().min(1), // "HH:MM"
  end_time: z.string().min(1), // "HH:MM"
});

export async function GET(_req: Request, { params }: { params: { shiftId: string } }) {
  try {
    const supabase = createSupabaseServiceClient();
    const { data, error } = await supabase
      .from("trainer_shift_breaks")
      .select("id, shift_id, start_time, end_time, created_at")
      .eq("shift_id", params.shiftId)
      .order("start_time", { ascending: true });
    if (error) return json({ error: error.message }, 500);
    return json({ breaks: data ?? [] }, 200);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return json({ error: message }, 500);
  }
}

export async function POST(req: Request, { params }: { params: { shiftId: string } }) {
  try {
    const raw = await req.json().catch(() => null);
    const parsed = postSchema.safeParse(raw);
    if (!parsed.success) return json({ error: "invalid_body", detail: parsed.error.flatten() }, 400);

    const supabase = createSupabaseServiceClient();
    const { data, error } = await supabase
      .from("trainer_shift_breaks")
      .insert({
        shift_id: params.shiftId,
        start_time: parsed.data.start_time,
        end_time: parsed.data.end_time,
      })
      .select("id, shift_id, start_time, end_time, created_at")
      .single();
    if (error) return json({ error: error.message }, 500);
    return json({ break: data }, 200);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return json({ error: message }, 500);
  }
}

