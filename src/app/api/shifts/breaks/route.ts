import { NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseServiceClient } from "@/lib/supabase/admin";

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status });
}

const querySchema = z.object({
  trainer_id: z.string().uuid(),
  month: z.string().regex(/^\d{4}-\d{2}$/u),
});

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const parsed = querySchema.safeParse({
      trainer_id: url.searchParams.get("trainer_id"),
      month: url.searchParams.get("month"),
    });
    if (!parsed.success) return json({ error: "invalid_query", detail: parsed.error.flatten() }, 400);
    const { trainer_id, month } = parsed.data;

    const y = Number(month.slice(0, 4));
    const m = Number(month.slice(5, 7));
    const start = `${month}-01`;
    const end = new Date(Date.UTC(y, m, 0));
    const endYmd = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo" }).format(end);

    const supabase = createSupabaseServiceClient();
    // その月のシフト一覧（idのみ）を取って breaks をまとめて返す
    const { data: shifts, error: shiftsErr } = await supabase
      .from("trainer_shifts")
      .select("id")
      .eq("trainer_id", trainer_id)
      .gte("shift_date", start)
      .lte("shift_date", endYmd)
      .neq("status", "draft");
    if (shiftsErr) return json({ error: shiftsErr.message }, 500);
    const ids = (shifts ?? []).map((s: any) => s.id as string).filter(Boolean);
    if (ids.length === 0) return json({ breaks: [] }, 200);

    const { data, error } = await supabase
      .from("trainer_shift_breaks")
      .select("id, shift_id, start_time, end_time, created_at")
      .in("shift_id", ids)
      .order("start_time", { ascending: true });
    if (error) return json({ error: error.message }, 500);
    return json({ breaks: data ?? [] }, 200);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return json({ error: message }, 500);
  }
}

