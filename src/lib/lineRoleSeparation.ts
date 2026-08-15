import type { SupabaseClient } from "@supabase/supabase-js";

/** 同じLINEを会員とトレーナーの両方にしない */
export async function findConflictingLineRole(
  supabase: SupabaseClient,
  userId: string
): Promise<{ role: "member"; member_code: string } | { role: "trainer"; display_name: string } | null> {
  const [memberQ, trainerQ] = await Promise.all([
    supabase
      .from("members")
      .select("member_code, is_active")
      .eq("line_user_id", userId)
      .maybeSingle(),
    supabase.from("trainers").select("display_name, is_active").eq("line_user_id", userId).maybeSingle(),
  ]);
  if (trainerQ.data?.is_active) {
    return { role: "trainer", display_name: String(trainerQ.data.display_name ?? "") };
  }
  if (memberQ.data?.is_active) {
    return { role: "member", member_code: String(memberQ.data.member_code ?? "") };
  }
  return null;
}

export async function isTrainerLineUserId(supabase: SupabaseClient, userId: string): Promise<boolean> {
  if (!userId) return false;
  const { data, error } = await supabase
    .from("trainers")
    .select("id")
    .eq("line_user_id", userId)
    .eq("is_active", true)
    .maybeSingle();
  if (error) return false;
  return Boolean(data?.id);
}
