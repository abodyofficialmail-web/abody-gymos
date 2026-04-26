import { NextResponse } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/admin";

export async function GET() {
  try {
    const supabase = createSupabaseServiceClient();
    const { data, error } = await supabase
      .from("trainers")
      .select("id, display_name, store_id, stores ( name ), is_active")
      .eq("is_active", true)
      .order("created_at", { ascending: true });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const trainers = (data ?? []).map((t: any) => ({
      id: t.id as string,
      name: String(t.display_name ?? ""),
      store_id: String(t.store_id ?? ""),
      store_name:
        t.stores && typeof t.stores === "object" && "name" in t.stores ? String((t.stores as { name: string }).name) : "",
    }));

    return NextResponse.json({ trainers });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

