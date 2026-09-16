import { DateTime } from "luxon";
import type { SupabaseClient } from "@supabase/supabase-js";
import { MEAL_LOG_TZ, MEAL_SLOTS, type MealSlot } from "@/lib/memberMealLogs";

export type MealReminderSettings = {
  breakfast_time: string;
  lunch_time: string;
  dinner_time: string;
  snack_time: string;
};

export const DEFAULT_MEAL_REMINDER_SETTINGS: MealReminderSettings = {
  breakfast_time: "08:00",
  lunch_time: "12:00",
  dinner_time: "19:00",
  snack_time: "15:00",
};

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function normalizeHm(raw: unknown): string | null {
  const s = String(raw ?? "").trim();
  const m = s.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (!m) return null;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

export function parseMealReminderSettings(raw: Partial<Record<keyof MealReminderSettings, unknown>>): MealReminderSettings | null {
  const breakfast_time = normalizeHm(raw.breakfast_time);
  const lunch_time = normalizeHm(raw.lunch_time);
  const dinner_time = normalizeHm(raw.dinner_time);
  const snack_time = normalizeHm(raw.snack_time);
  if (!breakfast_time || !lunch_time || !dinner_time || !snack_time) return null;
  void TIME_RE;
  return { breakfast_time, lunch_time, dinner_time, snack_time };
}

function minutesOf(hm: string): number {
  const [h, m] = hm.split(":").map(Number);
  return h * 60 + m;
}

const MATCH_WINDOW_MIN = 15;

export function dueMealSlots(
  settings: MealReminderSettings,
  now = DateTime.now().setZone(MEAL_LOG_TZ)
): MealSlot[] {
  const nowMin = now.hour * 60 + now.minute;
  const due: MealSlot[] = [];
  for (const slot of MEAL_SLOTS) {
    const hm = settings[`${slot}_time`];
    const start = minutesOf(hm);
    const end = start + MATCH_WINDOW_MIN;
    if (nowMin >= start && nowMin < end) due.push(slot);
  }
  return due;
}

export async function fetchMealReminderSettings(
  supabase: SupabaseClient,
  memberId: string
): Promise<{ ok: true; settings: MealReminderSettings; missingTable?: boolean } | { ok: false; error: string; missingTable?: boolean }> {
  const { data, error } = await supabase
    .from("member_meal_reminder_settings")
    .select("breakfast_time, lunch_time, dinner_time, snack_time")
    .eq("member_id", memberId)
    .maybeSingle();
  if (error) {
    const missing =
      error.code === "PGRST205" ||
      /member_meal_reminder_settings|Could not find the table/i.test(error.message);
    if (missing) return { ok: true, settings: DEFAULT_MEAL_REMINDER_SETTINGS, missingTable: true };
    return { ok: false, error: error.message };
  }
  if (!data) return { ok: true, settings: DEFAULT_MEAL_REMINDER_SETTINGS };
  return {
    ok: true,
    settings: parseMealReminderSettings(data as Partial<MealReminderSettings>) ?? DEFAULT_MEAL_REMINDER_SETTINGS,
  };
}

export async function fetchMealReminderSettingsByMemberIds(
  supabase: SupabaseClient,
  memberIds: string[]
): Promise<Map<string, MealReminderSettings>> {
  const map = new Map<string, MealReminderSettings>();
  if (memberIds.length === 0) return map;
  const { data, error } = await supabase
    .from("member_meal_reminder_settings")
    .select("member_id, breakfast_time, lunch_time, dinner_time, snack_time")
    .in("member_id", memberIds);
  if (error) return map;
  for (const row of (data ?? []) as Array<Record<string, unknown>>) {
    const parsed = parseMealReminderSettings(row);
    if (parsed) map.set(String(row.member_id), parsed);
  }
  return map;
}

export async function upsertMealReminderSettings(
  supabase: SupabaseClient,
  memberId: string,
  settings: MealReminderSettings
): Promise<{ ok: true; settings: MealReminderSettings } | { ok: false; error: string; missingTable?: boolean }> {
  const { data, error } = await supabase
    .from("member_meal_reminder_settings")
    .upsert(
      {
        member_id: memberId,
        breakfast_time: settings.breakfast_time,
        lunch_time: settings.lunch_time,
        dinner_time: settings.dinner_time,
        snack_time: settings.snack_time,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "member_id" }
    )
    .select("breakfast_time, lunch_time, dinner_time, snack_time")
    .maybeSingle();
  if (error) {
    const missing =
      error.code === "PGRST205" ||
      /member_meal_reminder_settings|Could not find the table/i.test(error.message);
    return { ok: false, error: error.message, missingTable: missing };
  }
  const parsed = parseMealReminderSettings((data ?? settings) as Partial<MealReminderSettings>);
  return { ok: true, settings: parsed ?? settings };
}
