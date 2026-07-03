import { DateTime } from "luxon";
import { z } from "zod";
import { createSupabaseServiceClient } from "@/lib/supabase/admin";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const querySchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/u).optional(),
  store_id: z.string().uuid().optional(),
  include_previous: z.enum(["1", "true"]).optional(),
});

function aggregateCounts(rows: Array<{ member_id: string | null; start_at: string }>, monthKey: string) {
  const counts: Record<string, number> = {};
  const start = DateTime.fromISO(`${monthKey}-01`, { zone: "Asia/Tokyo" }).startOf("month");
  const end = start.plus({ months: 1 });
  for (const row of rows) {
    const memberId = String(row.member_id ?? "");
    if (!memberId) continue;
    const at = DateTime.fromISO(row.start_at).setZone("Asia/Tokyo");
    if (at < start || at >= end) continue;
    counts[memberId] = (counts[memberId] ?? 0) + 1;
  }
  return counts;
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const parsed = querySchema.safeParse({
      month: url.searchParams.get("month") ?? undefined,
      store_id: url.searchParams.get("store_id") ?? undefined,
      include_previous: url.searchParams.get("include_previous") ?? undefined,
    });
    if (!parsed.success) return json({ error: "invalid_query" }, 400);

    const tz = "Asia/Tokyo";
    const thisMonthKey = parsed.data.month ?? DateTime.now().setZone(tz).toFormat("yyyy-MM");
    const lastMonthKey = DateTime.fromISO(`${thisMonthKey}-01`, { zone: tz }).minus({ months: 1 }).toFormat("yyyy-MM");
    const includePrevious = parsed.data.include_previous === "1" || parsed.data.include_previous === "true";

    const thisStart = DateTime.fromISO(`${thisMonthKey}-01`, { zone: tz }).startOf("month");
    const rangeStart = includePrevious ? thisStart.minus({ months: 1 }) : thisStart;
    const rangeEnd = thisStart.plus({ months: 1 });

    const supabase = createSupabaseServiceClient();
    let q = supabase
      .from("reservations")
      .select("member_id, start_at")
      .neq("status", "cancelled")
      .not("member_id", "is", null)
      .gte("start_at", rangeStart.toUTC().toISO()!)
      .lt("start_at", rangeEnd.toUTC().toISO()!);

    if (parsed.data.store_id) q = q.eq("store_id", parsed.data.store_id);

    const { data, error } = await q;
    if (error) return json({ error: error.message }, 400);

    const rows = (data ?? []) as Array<{ member_id: string | null; start_at: string }>;
    const counts = aggregateCounts(rows, thisMonthKey);

    if (!includePrevious) {
      return json({ month: thisMonthKey, counts });
    }

    return json({
      month: thisMonthKey,
      counts,
      last_month: lastMonthKey,
      last_month_counts: aggregateCounts(rows, lastMonthKey),
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return json({ error: message }, 500);
  }
}
