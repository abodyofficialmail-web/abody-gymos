import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * members.weight_reminder_line_enabled が無い本番でも OFF を残す印。
 * 朝配信の「その日は送った」行とは日付が重ならない。
 */
export const WEIGHT_REMINDER_OPT_OUT_DATE = "9999-12-31";

export function isWeightReminderEnabled(
  columnValue: boolean | null | undefined,
  optedOut: boolean
): boolean {
  if (optedOut) return false;
  if (columnValue === false) return false;
  return true;
}

export function isMissingWeightReminderColumn(err: { message?: string } | null | undefined): boolean {
  const msg = String(err?.message ?? "");
  return (
    /weight_reminder_line_enabled/i.test(msg) &&
    (/does not exist|column/i.test(msg) || /PGRST/i.test(msg) || /Could not find/i.test(msg))
  );
}

function isDuplicate(err: { message?: string; code?: string } | null | undefined): boolean {
  const msg = String(err?.message ?? "");
  return err?.code === "23505" || /duplicate|unique/i.test(msg);
}

export async function memberIdsWithWeightReminderOptOut(supabase: SupabaseClient): Promise<Set<string>> {
  const ids = new Set<string>();
  const pageSize = 1000;
  let from = 0;
  for (;;) {
    const { data, error } = await supabase
      .from("morning_weight_reminder_dispatches")
      .select("member_id")
      .eq("log_date", WEIGHT_REMINDER_OPT_OUT_DATE)
      .range(from, from + pageSize - 1);
    if (error) return ids;
    for (const row of data ?? []) {
      const id = String((row as { member_id?: string }).member_id ?? "");
      if (id) ids.add(id);
    }
    if (!data || data.length < pageSize) break;
    from += pageSize;
  }
  return ids;
}

export async function isWeightReminderOptedOut(supabase: SupabaseClient, memberId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from("morning_weight_reminder_dispatches")
    .select("id")
    .eq("member_id", memberId)
    .eq("log_date", WEIGHT_REMINDER_OPT_OUT_DATE)
    .maybeSingle();
  if (error || !data) return false;
  return true;
}

async function insertOptOut(supabase: SupabaseClient, memberId: string): Promise<{ ok: true } | { ok: false; message: string }> {
  const { error } = await supabase.from("morning_weight_reminder_dispatches").insert({
    member_id: memberId,
    log_date: WEIGHT_REMINDER_OPT_OUT_DATE,
  });
  if (error && !isDuplicate(error)) return { ok: false, message: error.message };
  return { ok: true };
}

async function deleteOptOut(supabase: SupabaseClient, memberId: string): Promise<{ ok: true } | { ok: false; message: string }> {
  const { error } = await supabase
    .from("morning_weight_reminder_dispatches")
    .delete()
    .eq("member_id", memberId)
    .eq("log_date", WEIGHT_REMINDER_OPT_OUT_DATE);
  if (error) return { ok: false, message: error.message };
  return { ok: true };
}

/** 列があれば列へ、無ければ配信テーブルの印へ保存する。OFF は印が残れば配信対象から外れる。 */
export async function saveWeightReminderEnabled(
  supabase: SupabaseClient,
  memberId: string,
  enabled: boolean
): Promise<{ ok: true; enabled: boolean } | { ok: false; message: string }> {
  const { error: columnErr } = await supabase
    .from("members")
    .update({ weight_reminder_line_enabled: enabled })
    .eq("id", memberId);

  const columnMissing = Boolean(columnErr && isMissingWeightReminderColumn(columnErr));
  if (columnErr && !columnMissing) {
    return { ok: false, message: columnErr.message };
  }

  const mark = enabled ? await deleteOptOut(supabase, memberId) : await insertOptOut(supabase, memberId);
  if (!mark.ok) {
    // ON は印が残っていると配信が止まる。列の更新に成功しても失敗として返す。
    if (enabled) return { ok: false, message: mark.message };
    if (!columnErr) return { ok: true, enabled };
    return { ok: false, message: mark.message };
  }
  return { ok: true, enabled };
}
