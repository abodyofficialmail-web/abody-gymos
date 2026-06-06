import { createSupabaseServiceClient } from "@/lib/supabase/admin";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

export async function GET(_request: Request, ctx: { params: Promise<{ trainerId: string }> }) {
  try {
    const { trainerId } = await ctx.params;
    const supabase = createSupabaseServiceClient();

    const { data: rows, error } = await supabase
      .from("session_survey_responses")
      .select("rating, intensity_feedback, highlights, created_at")
      .eq("trainer_id", trainerId)
      .order("created_at", { ascending: false })
      .limit(500);

    if (error) return json({ error: error.message }, 500);

    const list = rows ?? [];
    const count = list.length;
    const avgRating =
      count > 0 ? Math.round((list.reduce((s, r) => s + Number(r.rating), 0) / count) * 10) / 10 : null;
    const lowCount = list.filter((r) => Number(r.rating) <= 2).length;

    const intensityCounts: Record<string, number> = {};
    const highlightCounts: Record<string, number> = {};
    for (const r of list) {
      const i = String(r.intensity_feedback ?? "");
      intensityCounts[i] = (intensityCounts[i] ?? 0) + 1;
      for (const h of (r.highlights as string[]) ?? []) {
        highlightCounts[h] = (highlightCounts[h] ?? 0) + 1;
      }
    }

    return json({
      summary: { count, avg_rating: avgRating, low_rating_count: lowCount, intensity_counts: intensityCounts, highlight_counts: highlightCounts },
      recent: list.slice(0, 20),
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return json({ error: message }, 500);
  }
}
