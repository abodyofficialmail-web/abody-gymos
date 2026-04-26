import { NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseServiceClient } from "@/lib/supabase/admin";
import type { Database } from "@/types/database";

const patchSchema = z.object({
  hourly_rate: z.number().int().min(0).optional(),
  monthly_pass_cost: z.number().int().min(0).optional(),
});

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  try {
    const supabase = createSupabaseServiceClient();
    const { data, error } = await supabase
      .from("trainers")
      .select(
        "id, display_name, store_id, hourly_rate, monthly_pass_cost, hourly_rate_yen, is_active"
      )
      .eq("id", params.id)
      .maybeSingle();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!data) return NextResponse.json({ error: "not_found" }, { status: 404 });
    return NextResponse.json({ trainer: data });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  try {
    const raw = await req.json().catch(() => ({}));
    const parsed = patchSchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json({ error: "invalid_body", detail: parsed.error.flatten() }, { status: 400 });
    }
    const body = parsed.data;
    if (Object.keys(body).length === 0) {
      return NextResponse.json({ error: "no_fields" }, { status: 400 });
    }
    const supabase = createSupabaseServiceClient();
    const patch: Database["public"]["Tables"]["trainers"]["Update"] = {};
    if (body.hourly_rate !== undefined) patch.hourly_rate = body.hourly_rate;
    if (body.monthly_pass_cost !== undefined) patch.monthly_pass_cost = body.monthly_pass_cost;

    const { data, error } = await supabase
      .from("trainers")
      .update(patch)
      .eq("id", params.id)
      .select(
        "id, display_name, store_id, hourly_rate, monthly_pass_cost, hourly_rate_yen, is_active"
      )
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ trainer: data });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
