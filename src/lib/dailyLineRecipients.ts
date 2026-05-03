import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

export function splitEnvList(raw: string): string[] {
  return raw
    .split(/[,;\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export async function resolvePushRecipients(supabase: SupabaseClient<Database>): Promise<{
  ids: string[];
  member_codes_queried: string[];
  missing_line_for_codes: string[];
}> {
  const explicit: string[] = [];
  const rawUsers = process.env.LINE_DAILY_REPORT_USER_IDS?.trim();
  if (rawUsers) explicit.push(...splitEnvList(rawUsers));
  const legacy = process.env.LINE_EBI020_USER_ID?.trim();
  if (legacy) explicit.push(legacy);

  const codesEnv = process.env.LINE_DAILY_REPORT_MEMBER_CODES?.trim();
  let memberCodesToQuery: string[] = [];
  if (codesEnv !== undefined && codesEnv !== "") {
    memberCodesToQuery = splitEnvList(codesEnv);
  } else if (explicit.length === 0) {
    memberCodesToQuery = ["EBI020"];
  }

  const fromMembers: string[] = [];
  const missingLineForCodes: string[] = [];

  if (memberCodesToQuery.length > 0) {
    const { data, error } = await supabase
      .from("members")
      .select("member_code,line_user_id")
      .in("member_code", memberCodesToQuery)
      .eq("is_active", true);
    if (error) {
      throw new Error(`members_lookup_failed:${error.message}`);
    }
    for (const code of memberCodesToQuery) {
      const row = (data ?? []).find((r) => String(r.member_code) === code);
      if (!row) {
        missingLineForCodes.push(code);
        continue;
      }
      const uid = row.line_user_id ? String(row.line_user_id).trim() : "";
      if (uid) fromMembers.push(uid);
      else missingLineForCodes.push(code);
    }
  }

  const ids = Array.from(new Set([...explicit, ...fromMembers]));
  return {
    ids,
    member_codes_queried: memberCodesToQuery,
    missing_line_for_codes: missingLineForCodes,
  };
}

export function dailyReportChannelToken(): string | null {
  const explicit = process.env.LINE_DAILY_REPORT_CHANNEL_TOKEN?.trim();
  if (explicit) return explicit;
  return process.env.LINE_CHANNEL_ACCESS_TOKEN ?? null;
}
