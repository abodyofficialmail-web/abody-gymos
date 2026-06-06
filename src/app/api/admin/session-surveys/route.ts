import { z } from "zod";
import { createSupabaseServiceClient } from "@/lib/supabase/admin";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const querySchema = z.object({
  followup: z.enum(["pending", "done", "all"]).optional(),
  store_id: z.string().uuid().optional(),
  trainer_id: z.string().uuid().optional(),
  highlight: z.string().trim().optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
});

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const parsed = querySchema.safeParse({
      followup: url.searchParams.get("followup") ?? "pending",
      store_id: url.searchParams.get("store_id") ?? undefined,
      trainer_id: url.searchParams.get("trainer_id") ?? undefined,
      highlight: url.searchParams.get("highlight") ?? undefined,
      limit: url.searchParams.get("limit") ?? 200,
    });
    if (!parsed.success) return json({ error: "invalid_query" }, 400);

    const supabase = createSupabaseServiceClient();
    let q = supabase
      .from("session_survey_responses")
      .select(
        `
        id,
        session_date,
        rating,
        highlights,
        intensity_feedback,
        comment_general,
        comment_improve,
        comment_questions,
        needs_followup,
        followup_status,
        followup_note,
        followup_handled_at,
        created_at,
        trainers ( id, display_name ),
        members ( id, member_code, name, line_user_id ),
        stores ( id, name )
      `
      )
      .order("created_at", { ascending: false })
      .limit(parsed.data.limit ?? 50);

    if (parsed.data.store_id) q = q.eq("store_id", parsed.data.store_id);
    if (parsed.data.trainer_id) q = q.eq("trainer_id", parsed.data.trainer_id);
    if (parsed.data.highlight) q = q.contains("highlights", [parsed.data.highlight]);
    if (parsed.data.followup === "pending") {
      q = q.eq("needs_followup", true).eq("followup_status", "pending");
    } else if (parsed.data.followup === "done") {
      q = q.eq("needs_followup", true).eq("followup_status", "done");
    }

    const { data, error } = await q;
    if (error) {
      const msg = String(error.message ?? "");
      if (msg.includes("session_survey")) {
        return json({ error: "テーブル未作成", detail: msg }, 503);
      }
      return json({ error: "取得に失敗しました", detail: msg }, 500);
    }

    const rows = data ?? [];
    const trainerStats = trainerStatsFromRows(rows as Array<any>);
    const filterOptions = await loadFilterOptions(supabase);

    return json({ responses: rows, trainer_stats: trainerStats, filter_options: filterOptions }, 200);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return json({ error: message }, 500);
  }
}

function trainerStatsFromRows(rows: Array<any>) {
  const map = new Map<string, { trainer_id: string; trainer_name: string; count: number; rating_total: number; average_rating: number }>();
  for (const r of rows) {
    const trainer = Array.isArray(r.trainers) ? r.trainers[0] : r.trainers;
    const id = String(trainer?.id ?? r.trainer_id ?? "unknown");
    const cur = map.get(id) ?? {
      trainer_id: id,
      trainer_name: String(trainer?.display_name ?? "未設定"),
      count: 0,
      rating_total: 0,
      average_rating: 0,
    };
    cur.count += 1;
    cur.rating_total += Number(r.rating ?? 0);
    cur.average_rating = Math.round((cur.rating_total / cur.count) * 10) / 10;
    map.set(id, cur);
  }
  return [...map.values()].sort((a, b) => b.count - a.count || b.average_rating - a.average_rating);
}

async function loadFilterOptions(supabase: ReturnType<typeof createSupabaseServiceClient>) {
  const [{ data: stores }, { data: trainers }] = await Promise.all([
    supabase.from("stores").select("id, name").order("name", { ascending: true }),
    supabase.from("trainers").select("id, display_name").order("display_name", { ascending: true }),
  ]);
  return {
    stores: stores ?? [],
    trainers: trainers ?? [],
  };
}
