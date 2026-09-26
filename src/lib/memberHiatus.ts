import { DateTime } from "luxon";

const TZ = "Asia/Tokyo";

export const HIATUS_REACTIVATE_UPDATES = {
  membership_status: "active",
  is_active: true,
  hiatus_start_at: null,
  hiatus_end_at: null,
} as const;

export function tokyoTodayYmd(now = DateTime.now().setZone(TZ)): string {
  return now.toFormat("yyyy-MM-dd");
}

export async function reactivateExpiredHiatusMembers(
  supabase: { from: (table: string) => any },
  todayYmd: string
): Promise<{ reactivated: number; ids: string[]; error: string | null }> {
  const { data, error } = await supabase
    .from("members")
    .update({
      ...HIATUS_REACTIVATE_UPDATES,
      updated_at: new Date().toISOString(),
    })
    .eq("membership_status", "hiatus")
    .not("hiatus_end_at", "is", null)
    .lt("hiatus_end_at", todayYmd)
    .select("id");

  if (error) {
    return { reactivated: 0, ids: [], error: String(error.message ?? error) };
  }
  const ids = ((data ?? []) as Array<{ id: string }>).map((r) => r.id);
  return { reactivated: ids.length, ids, error: null };
}
