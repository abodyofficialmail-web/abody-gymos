import { DateTime } from "luxon";
import { z } from "zod";
import { createSupabaseServiceClient } from "@/lib/supabase/admin";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const querySchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/u).optional(),
  store_id: z.string().uuid().optional(),
});

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const parsed = querySchema.safeParse({
      month: url.searchParams.get("month") ?? undefined,
      store_id: url.searchParams.get("store_id") ?? undefined,
    });
    if (!parsed.success) return json({ error: "invalid_query" }, 400);

    const monthKey = parsed.data.month ?? DateTime.now().setZone("Asia/Tokyo").toFormat("yyyy-MM");
    const start = DateTime.fromISO(`${monthKey}-01`, { zone: "Asia/Tokyo" }).startOf("month");
    const end = start.plus({ months: 1 });

    const supabase = createSupabaseServiceClient();
    let q = supabase
      .from("reservations")
      .select("member_id")
      .neq("status", "cancelled")
      .not("member_id", "is", null)
      .gte("start_at", start.toUTC().toISO()!)
      .lt("start_at", end.toUTC().toISO()!);

    if (parsed.data.store_id) q = q.eq("store_id", parsed.data.store_id);

    const { data, error } = await q;
    if (error) return json({ error: error.message }, 400);

    const counts: Record<string, number> = {};
    for (const row of data ?? []) {
      const memberId = String(row.member_id ?? "");
      if (!memberId) continue;
      counts[memberId] = (counts[memberId] ?? 0) + 1;
    }

    return json({ month: monthKey, counts });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return json({ error: message }, 500);
  }
}
