import { NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseServiceClient } from "@/lib/supabase/admin";

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status });
}

const postSchema = z.object({
  store_id: z.string().uuid(),
  cost: z.number().int().min(0).optional().default(0),
});

const patchSchema = z.object({
  id: z.string().uuid(),
  cost: z.number().int().min(0),
});

const deleteSchema = z.object({
  id: z.string().uuid(),
});

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  try {
    const supabase = createSupabaseServiceClient();
    const { data, error } = await supabase
      .from("trainer_transport_costs")
      .select("id, trainer_id, store_id, cost")
      .eq("trainer_id", params.id)
      .order("store_id", { ascending: true });
    if (error) return json({ error: error.message }, 500);
    return json({ transport_costs: data ?? [] }, 200);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return json({ error: message }, 500);
  }
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    const raw = await req.json().catch(() => null);
    const parsed = postSchema.safeParse(raw);
    if (!parsed.success) return json({ error: "invalid_body", detail: parsed.error.flatten() }, 400);

    const supabase = createSupabaseServiceClient();
    // upsert 相当（trainer_id×store_id を一意に）
    const { data, error } = await supabase
      .from("trainer_transport_costs")
      .upsert(
        { trainer_id: params.id, store_id: parsed.data.store_id, cost: parsed.data.cost },
        { onConflict: "trainer_id,store_id" }
      )
      .select("id, trainer_id, store_id, cost")
      .single();
    if (error) return json({ error: error.message }, 500);
    return json({ transport_cost: data }, 200);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return json({ error: message }, 500);
  }
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  try {
    const raw = await req.json().catch(() => null);
    const parsed = patchSchema.safeParse(raw);
    if (!parsed.success) return json({ error: "invalid_body", detail: parsed.error.flatten() }, 400);

    const supabase = createSupabaseServiceClient();
    const { data, error } = await supabase
      .from("trainer_transport_costs")
      .update({ cost: parsed.data.cost })
      .eq("id", parsed.data.id)
      .eq("trainer_id", params.id)
      .select("id, trainer_id, store_id, cost")
      .single();
    if (error) return json({ error: error.message }, 500);
    return json({ transport_cost: data }, 200);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return json({ error: message }, 500);
  }
}

export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  try {
    const raw = await req.json().catch(() => null);
    const parsed = deleteSchema.safeParse(raw);
    if (!parsed.success) return json({ error: "invalid_body", detail: parsed.error.flatten() }, 400);

    const supabase = createSupabaseServiceClient();
    const { error } = await supabase
      .from("trainer_transport_costs")
      .delete()
      .eq("id", parsed.data.id)
      .eq("trainer_id", params.id);
    if (error) return json({ error: error.message }, 500);
    return json({ ok: true }, 200);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return json({ error: message }, 500);
  }
}

