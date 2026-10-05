import { createSupabaseServiceClient } from "@/lib/supabase/admin";
import { jsonResponse } from "@/app/api/booking-v2/_cors";

export async function OPTIONS() {
  return jsonResponse({}, 200);
}

export async function GET(request: Request) {
  try {
    const q = new URL(request.url).searchParams.get("q")?.trim() ?? "";
    const excludeId = new URL(request.url).searchParams.get("exclude_id")?.trim() ?? "";
    if (q.length < 1) return jsonResponse({ members: [] });

    const safe = q.replace(/[%_,().]/g, "").slice(0, 40);
    if (!safe) return jsonResponse({ members: [] });

    const supabase = createSupabaseServiceClient();
    let query = supabase
      .from("members")
      .select("id, member_code, name")
      .or(`member_code.ilike.%${safe}%,name.ilike.%${safe}%,display_name.ilike.%${safe}%`)
      .order("member_code", { ascending: true })
      .limit(20);
    if (excludeId) query = query.neq("id", excludeId);

    const { data, error } = await query;
    if (error) return jsonResponse({ error: error.message }, 400);

    return jsonResponse({
      members: (data ?? []).map((row) => ({
        id: row.id,
        member_code: row.member_code,
        name: row.name ?? "",
      })),
    });
  } catch (e) {
    return jsonResponse({ error: String((e as Error)?.message ?? e) }, 400);
  }
}
