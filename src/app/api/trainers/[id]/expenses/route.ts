import { NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseServiceClient } from "@/lib/supabase/admin";
import type { Database } from "@/types/database";

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status });
}

const expenseTypeSchema = z.enum(["monthly", "daily"]);

const postSchema = z.object({
  title: z.string().min(1),
  amount: z.number().int().min(0).optional().default(0),
  type: expenseTypeSchema,
});

const patchSchema = z.object({
  id: z.string().uuid(),
  title: z.string().min(1).optional(),
  amount: z.number().int().min(0).optional(),
  type: expenseTypeSchema.optional(),
});

const deleteSchema = z.object({
  id: z.string().uuid(),
});

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  try {
    const supabase = createSupabaseServiceClient();
    const { data, error } = await supabase
      .from("trainer_expenses")
      .select("id, trainer_id, title, amount, type")
      .eq("trainer_id", params.id)
      .order("title", { ascending: true });
    if (error) return json({ error: error.message }, 500);
    return json({ expenses: data ?? [] }, 200);
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
    const { data, error } = await supabase
      .from("trainer_expenses")
      .insert({ trainer_id: params.id, title: parsed.data.title, amount: parsed.data.amount, type: parsed.data.type })
      .select("id, trainer_id, title, amount, type")
      .single();
    if (error) return json({ error: error.message }, 500);
    return json({ expense: data }, 200);
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
    const body = parsed.data;
    const update: Database["public"]["Tables"]["trainer_expenses"]["Update"] = {};
    if (body.title !== undefined) update.title = body.title;
    if (body.amount !== undefined) update.amount = body.amount;
    if (body.type !== undefined) update.type = body.type;
    if (Object.keys(update).length === 0) return json({ error: "no_fields" }, 400);

    const supabase = createSupabaseServiceClient();
    const { data, error } = await supabase
      .from("trainer_expenses")
      .update(update)
      .eq("id", body.id)
      .eq("trainer_id", params.id)
      .select("id, trainer_id, title, amount, type")
      .single();
    if (error) return json({ error: error.message }, 500);
    return json({ expense: data }, 200);
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
    const { error } = await supabase.from("trainer_expenses").delete().eq("id", parsed.data.id).eq("trainer_id", params.id);
    if (error) return json({ error: error.message }, 500);
    return json({ ok: true }, 200);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return json({ error: message }, 500);
  }
}

