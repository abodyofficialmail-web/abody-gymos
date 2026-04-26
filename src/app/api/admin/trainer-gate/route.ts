import { NextResponse } from "next/server";
import { z } from "zod";
import { cookies } from "next/headers";
import { createSupabaseServiceClient } from "@/lib/supabase/admin";
import {
  issueTrainerGateToken,
  trainerGateCookieName,
  verifyTrainerPassword,
} from "@/lib/trainerGate";

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status });
}

const bodySchema = z.object({
  trainer_id: z.string().uuid(),
  password: z.string().min(1),
});

export async function POST(req: Request) {
  try {
    const raw = await req.json().catch(() => null);
    const parsed = bodySchema.safeParse(raw);
    if (!parsed.success) {
      return json({ error: "invalid_body", detail: parsed.error.flatten() }, 400);
    }

    const { trainer_id, password } = parsed.data;
    const supabase = createSupabaseServiceClient();
    const { data: t, error } = await supabase.from("trainers").select("id, display_name").eq("id", trainer_id).maybeSingle();
    if (error) return json({ error: "trainer_fetch_failed", detail: error.message }, 500);
    if (!t) return json({ error: "trainer_not_found" }, 404);

    const ok = verifyTrainerPassword(t.display_name, password);
    if (!ok) return json({ error: "invalid_password" }, 401);

    const token = issueTrainerGateToken(trainer_id);
    const store = await cookies();
    store.set(trainerGateCookieName(), token, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 12, // 12h
    });

    return json({ ok: true }, 200);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return json({ error: "unexpected_error", detail: message }, 500);
  }
}

