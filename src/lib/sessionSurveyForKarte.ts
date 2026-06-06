import type { SessionSurveyForKarte } from "@/lib/sessionSurveyDisplay";
import type { SupabaseClient } from "@supabase/supabase-js";

type SurveyRow = {
  id: string;
  session_date: string;
  rating: number;
  highlights: string[];
  intensity_feedback: string;
  comment_general: string | null;
  comment_improve: string | null;
  comment_questions: string | null;
  needs_followup: boolean;
  created_at: string;
  trainers: { display_name: string | null } | { display_name: string | null }[] | null;
  stores: { name: string | null } | { name: string | null }[] | null;
};

function pickName(
  rel: { display_name?: string | null; name?: string | null } | { display_name?: string | null; name?: string | null }[] | null,
  field: "display_name" | "name"
): string {
  if (!rel) return "";
  const row = Array.isArray(rel) ? rel[0] : rel;
  const v = row?.[field];
  return typeof v === "string" ? v.trim() : "";
}

export async function fetchSessionSurveysForMember(
  supabase: SupabaseClient,
  memberId: string
): Promise<{ survey_by_date: Record<string, SessionSurveyForKarte>; latest_survey: SessionSurveyForKarte | null }> {
  const empty = { survey_by_date: {}, latest_survey: null };

  const { data, error } = await supabase
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
      created_at,
      trainers ( display_name ),
      stores ( name )
    `
    )
    .eq("member_id", memberId)
    .order("session_date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) {
    const msg = String(error.message ?? "");
    if (msg.includes("session_survey") || error.code === "PGRST205") {
      return empty;
    }
    console.error("session_survey_responses fetch failed", error);
    return empty;
  }

  const survey_by_date: Record<string, SessionSurveyForKarte> = {};
  for (const row of (data ?? []) as unknown as SurveyRow[]) {
    const date = row.session_date;
    if (survey_by_date[date]) continue;
    survey_by_date[date] = mapRow(row);
  }

  const latest_survey = Object.values(survey_by_date).sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  )[0] ?? null;

  return { survey_by_date, latest_survey };
}

function mapRow(row: SurveyRow): SessionSurveyForKarte {
  return {
    id: row.id,
    session_date: row.session_date,
    rating: row.rating,
    highlights: row.highlights ?? [],
    intensity_feedback: row.intensity_feedback,
    comment_general: row.comment_general,
    comment_improve: row.comment_improve,
    comment_questions: row.comment_questions,
    needs_followup: row.needs_followup,
    trainer_name: pickName(row.trainers, "display_name"),
    store_name: pickName(row.stores, "name"),
    created_at: row.created_at,
  };
}
