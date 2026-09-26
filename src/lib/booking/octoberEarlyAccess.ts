import type { SupabaseClient } from "@supabase/supabase-js";

/** 10月先行。下書きシフトをこの会員だけに見せる。公開状態にはしない。 */
export const OCTOBER_EARLY_ACCESS_MONTH = "2026-10";

export const OCTOBER_EARLY_ACCESS_CODES = [
  "EBI035",
  "EBI027",
  "EBI026",
  "EBI010",
  "EBI009",
  "SHI001",
  "SHI003",
  "SHI033",
  "SHI019",
  "SHI024",
  "SHI028",
  "UEN050",
  "UEN039",
  "UEN053",
  "UEN048",
  "UEN045",
  "UEN031",
  "UEN052",
  "UEN033",
  "UEN054",
  "SAK044",
  "SAK052",
  "SAK017",
  "SAK060",
  "SAK025",
  "SAK027",
  "SAK057",
  "SAK018",
  "SAK049",
  "EBI008",
  "EBI031",
  "EBI021",
  "EBI024",
  "EBI012",
  "EBI002",
  "SAK002",
  "EBI034",
] as const;

const CODE_SET = new Set<string>(OCTOBER_EARLY_ACCESS_CODES);

export function isOctoberEarlyAccessDate(ymd: string): boolean {
  return ymd.startsWith(`${OCTOBER_EARLY_ACCESS_MONTH}-`);
}

export function isOctoberEarlyAccessCode(memberCode: string | null | undefined): boolean {
  return CODE_SET.has(String(memberCode ?? "").trim());
}

export async function memberHasOctoberEarlyAccess(
  supabase: SupabaseClient,
  memberId: string | null | undefined
): Promise<boolean> {
  if (!memberId) return false;
  const { data, error } = await supabase
    .from("members")
    .select("member_code")
    .eq("id", memberId)
    .maybeSingle();
  if (error || !data) return false;
  return isOctoberEarlyAccessCode((data as { member_code?: string | null }).member_code);
}
