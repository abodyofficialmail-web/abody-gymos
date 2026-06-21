import { z } from "zod";
import { buildOnboardingKarteContent, type CounselingFormState } from "@/lib/memberCounseling";
import { createEmptyKarteSessionState, type KarteSessionState } from "@/lib/karteSession";
import { createSupabaseServiceClient } from "@/lib/supabase/admin";
import { jsonResponse } from "@/app/api/booking-v2/_cors";

const counselingSchema = z.object({
  trainingGoals2026: z.string(),
  bodyMakePriority1: z.string(),
  bodyMakePriority2: z.string(),
  bodyMakePriority3: z.string(),
  heightCm: z.string(),
  weightKg: z.string(),
  bodyFatPct: z.string(),
  numericGoals: z.string(),
  painAndRestrictions: z.string(),
  bodyMakeChallenges: z.array(z.string()),
  futureEvents2026: z.string(),
  hobbies: z.array(z.string()),
  occupations: z.array(z.string()),
  daysOff: z.array(z.string()),
  trainerNotes: z.string(),
});

const karteSessionSchema = z.object({
  bodyWeightKg: z.string(),
  bodyFatPct: z.string(),
  condition: z.string(),
  trainingParts: z.array(z.string()),
  menuItems: z.array(
    z.object({
      id: z.string(),
      exercise: z.string(),
      sets: z.array(z.object({ reps: z.string(), weight: z.string() })),
    })
  ),
  stretch: z.string(),
  stretchDetail: z.string(),
  trainingConcept: z.string(),
  goodPoint: z.string(),
  improvePoint: z.string(),
  painLevel: z.string(),
  communication: z.string(),
});

const postBodySchema = z.object({
  store_id: z.string().uuid(),
  trainer_id: z.string().uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u),
  counseling: counselingSchema,
  trial_session: karteSessionSchema,
});

export async function OPTIONS() {
  return jsonResponse({}, 200);
}

export async function GET(_request: Request, { params }: { params: { memberId: string } }) {
  try {
    const supabase = createSupabaseServiceClient();
    const { data: member, error } = await supabase
      .from("members")
      .select("id, member_code, name, email, store_id, is_active")
      .eq("id", params.memberId)
      .maybeSingle();
    if (error) return jsonResponse({ error: error.message }, 400);
    if (!member || !member.is_active) return jsonResponse({ error: "member_not_found" }, 404);

    const { data: note } = await supabase
      .from("client_notes")
      .select("id, date, content, created_at")
      .eq("member_id", params.memberId)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    return jsonResponse({
      member,
      onboarding_saved: Boolean(note?.content?.includes("【入会時カルテ】")),
      note_id: note?.id ?? null,
    });
  } catch (e) {
    return jsonResponse({ error: String((e as Error)?.message ?? e) }, 400);
  }
}

export async function POST(request: Request, { params }: { params: { memberId: string } }) {
  try {
    const raw = await request.json().catch(() => null);
    const parsed = postBodySchema.safeParse(raw);
    if (!parsed.success) {
      return jsonResponse({ error: parsed.error.flatten() }, 400);
    }

    const supabase = createSupabaseServiceClient();
    const { data: member, error: memberErr } = await supabase
      .from("members")
      .select("id, member_code, name, email, store_id, is_active")
      .eq("id", params.memberId)
      .maybeSingle();
    if (memberErr) return jsonResponse({ error: memberErr.message }, 400);
    if (!member || !member.is_active) return jsonResponse({ error: "member_not_found" }, 404);

    const content = buildOnboardingKarteContent({
      counseling: parsed.data.counseling as CounselingFormState,
      trialSession: parsed.data.trial_session as KarteSessionState,
      member,
    });

    const { store_id, trainer_id, date } = parsed.data;
    const { data: existing } = await supabase
      .from("client_notes")
      .select("id")
      .eq("member_id", params.memberId)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    let noteId: string | null = null;
    if (existing?.id) {
      const { data: updated, error: upErr } = await supabase
        .from("client_notes")
        .update({ store_id, trainer_id, date, content })
        .eq("id", existing.id)
        .select("id")
        .single();
      if (upErr) return jsonResponse({ error: upErr.message }, 400);
      noteId = updated.id;
    } else {
      const { data: inserted, error: insErr } = await supabase
        .from("client_notes")
        .insert({ member_id: params.memberId, store_id, trainer_id, date, content })
        .select("id")
        .single();
      if (insErr) return jsonResponse({ error: insErr.message }, 400);
      noteId = inserted.id;
    }

    return jsonResponse({ ok: true, note_id: noteId, member_id: member.id });
  } catch (e) {
    return jsonResponse({ error: String((e as Error)?.message ?? e) }, 400);
  }
}
