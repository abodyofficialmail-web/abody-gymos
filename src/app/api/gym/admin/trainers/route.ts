import { NextResponse } from "next/server";
import { z } from "zod";
import { getProfileRole } from "@/lib/gym/context";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const createTrainerSchema = z.object({
  display_name: z.string().trim().min(1, "display_name is required"),
  store_id: z.string().uuid(),
  hourly_rate_yen: z
    .number()
    .int()
    .nonnegative()
    .nullable()
    .optional()
    .transform((v) => (typeof v === "number" ? v : null)),
  is_active: z.boolean().optional().default(true),
});

export async function POST(request: Request) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const profile = await getProfileRole(supabase, user.id);
  if (profile?.role !== "admin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const json = await request.json().catch(() => null);
  const parsed = createTrainerSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const p = parsed.data;
  const { data: row, error } = await supabase
    .from("trainers")
    .insert({
      display_name: p.display_name,
      store_id: p.store_id,
      hourly_rate_yen: p.hourly_rate_yen ?? null,
      is_active: p.is_active ?? true,
      user_id: null,
    })
    .select("id, display_name, store_id, hourly_rate_yen, is_active, user_id, created_at")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ trainer: row });
}

export async function GET() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const profile = await getProfileRole(supabase, user.id);
  if (profile?.role !== "admin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const { data: rows, error } = await supabase
    .from("trainers")
    .select("id, display_name, email, hourly_rate_yen, is_active, user_id, store_id, stores ( name )")
    .order("created_at", { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  const trainers = (rows ?? []).map((t) => ({
    id: t.id,
    display_name: t.display_name,
    email: t.email,
    hourly_rate_yen: t.hourly_rate_yen,
    is_active: t.is_active,
    user_id: t.user_id,
    store_id: (t as any).store_id as string,
    store_name:
      (t as any).stores && typeof (t as any).stores === "object" && "name" in (t as any).stores
        ? String(((t as any).stores as { name: string }).name)
        : "",
  }));

  return NextResponse.json({ trainers });
}

