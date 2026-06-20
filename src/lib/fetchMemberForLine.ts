import type { LineChannelKey } from "@/lib/lineChannel";
import type { SupabaseClient } from "@supabase/supabase-js";

export type MemberLineFields = {
  id: string;
  member_code: string | null;
  line_user_id: string | null;
  line_channel_key: LineChannelKey | null;
  is_active: boolean | null;
  name?: string | null;
  email?: string | null;
};

function normalizeChannelKey(raw: unknown): LineChannelKey | null {
  const k = String(raw ?? "");
  if (k === "default" || k === "ueno" || k === "sakuragicho" || k === "shinjuku") return k;
  return null;
}

/** line_channel_key 未マイグレーション時はカラムなしで再取得 */
export async function fetchMemberForLine(
  supabase: SupabaseClient,
  memberId: string,
  extraColumns = ""
): Promise<{ member: MemberLineFields | null; error: { message: string } | null }> {
  const base = `id, member_code, line_user_id, line_channel_key, is_active${extraColumns ? `, ${extraColumns}` : ""}`;
  const full = await (supabase as any).from("members").select(base).eq("id", memberId).maybeSingle();
  if (!full.error && full.data) {
    const m = full.data as Record<string, unknown>;
    return {
      member: {
        id: String(m.id),
        member_code: (m.member_code as string) ?? null,
        line_user_id: (m.line_user_id as string) ?? null,
        line_channel_key: normalizeChannelKey(m.line_channel_key),
        is_active: (m.is_active as boolean) ?? null,
        name: (m.name as string) ?? null,
        email: (m.email as string) ?? null,
      },
      error: null,
    };
  }
  if (full.error && /line_channel_key/i.test(String(full.error.message))) {
    const slimCols = `id, member_code, line_user_id, is_active${extraColumns ? `, ${extraColumns}` : ""}`;
    const slim = await (supabase as any).from("members").select(slimCols).eq("id", memberId).maybeSingle();
    if (slim.error) return { member: null, error: slim.error };
    if (!slim.data) return { member: null, error: null };
    const m = slim.data as Record<string, unknown>;
    return {
      member: {
        id: String(m.id),
        member_code: (m.member_code as string) ?? null,
        line_user_id: (m.line_user_id as string) ?? null,
        line_channel_key: null,
        is_active: (m.is_active as boolean) ?? null,
        name: (m.name as string) ?? null,
        email: (m.email as string) ?? null,
      },
      error: null,
    };
  }
  return { member: null, error: full.error };
}
