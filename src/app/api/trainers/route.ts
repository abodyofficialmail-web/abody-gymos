import { NextResponse } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/admin";
import { DEFAULT_ALL_STORE_VIEWERS, DEFAULT_STORE_MANAGERS } from "@/lib/trainerOpsScope";

export async function GET() {
  try {
    const supabase = createSupabaseServiceClient();
    let { data, error } = await supabase
      .from("trainers")
      .select("id, display_name, store_id, stores ( name ), is_active, line_user_id")
      .eq("is_active", true)
      .order("created_at", { ascending: true });
    if (error && /line_user_id/i.test(error.message)) {
      const retry = await supabase
        .from("trainers")
        .select("id, display_name, store_id, stores ( name ), is_active")
        .eq("is_active", true)
        .order("created_at", { ascending: true });
      data = retry.data as typeof data;
      error = retry.error;
    }
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const trainers = (data ?? []).map((t: any) => {
      const name = String(t.display_name ?? "");
      return {
        id: t.id as string,
        name,
        store_id: String(t.store_id ?? ""),
        store_name:
          t.stores && typeof t.stores === "object" && "name" in t.stores ? String((t.stores as { name: string }).name) : "",
        line_linked: Boolean(t.line_user_id),
        managed_stores: DEFAULT_STORE_MANAGERS[name] ?? [],
        views_all_stores: DEFAULT_ALL_STORE_VIEWERS.has(name),
      };
    });

    return NextResponse.json({ trainers });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

