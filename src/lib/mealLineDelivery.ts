import type { SupabaseClient } from "@supabase/supabase-js";
import {
  isMealPersonalPassActive,
  isMemberMealPersonalFullEnabled,
  mealPersonalSubscribeUrl,
  type MealPersonalPassRow,
} from "./memberMealPersonalPass";

const DEFAULT_REMINDER_TIMES = {
  breakfast_time: "08:00",
  lunch_time: "12:00",
  dinner_time: "19:00",
  snack_time: "15:00",
};

export const MEAL_LINE_DELIVERY_PRICE_LABEL = "月額1,100円";
export const MEAL_LINE_DELIVERY_TRIAL_BUTTON = "3日間無料お試し";
export const MEAL_LINE_DELIVERY_TRIAL_NOTE =
  "最初の課金はなしで、自動課金もございませんのでご安心ください。";
/** 配信する期間は3日。お試し終了後に自動課金はしない。 */
export const MEAL_LINE_DELIVERY_TRIAL_MS = 3 * 24 * 60 * 60 * 1000;

export type MealLineDeliveryStatus = "active" | "trial" | "expired" | "none";

export type MealLineDeliveryView = {
  entitled: boolean;
  status: MealLineDeliveryStatus;
  trial_used: boolean;
  trial_ends_at: string | null;
  price_label: string;
  trial_button_label: string;
  subscribe_url: string | null;
};

export type MealLineDeliveryTrialRow = {
  trialStartedAt: string | null;
  trialEndsAt: string | null;
};

export function mealLineDeliveryTrialEndsAt(startedAt: Date): Date {
  return new Date(startedAt.getTime() + MEAL_LINE_DELIVERY_TRIAL_MS);
}

export function isMealLineDeliveryTrialActive(endsAt: string | null | undefined, now = new Date()): boolean {
  if (!endsAt) return false;
  const ms = Date.parse(endsAt);
  return Number.isFinite(ms) && ms > now.getTime();
}

export function isMissingMealLineDeliveryColumn(err: unknown): boolean {
  const msg =
    typeof err === "object" && err && "message" in err ? String((err as { message?: string }).message) : String(err ?? "");
  return /line_delivery_trial_/i.test(msg) && /does not exist|schema cache|column/i.test(msg);
}

export function isMealLineDeliveryEntitled(params: {
  memberCode?: string | null;
  pass?: MealPersonalPassRow | null;
  trialEndsAt?: string | null;
  now?: Date;
}): boolean {
  if (isMemberMealPersonalFullEnabled({ memberCode: params.memberCode, pass: params.pass })) return true;
  return isMealLineDeliveryTrialActive(params.trialEndsAt, params.now);
}

export function mealLineDeliveryView(params: {
  memberCode?: string | null;
  pass?: MealPersonalPassRow | null;
  trialStartedAt?: string | null;
  trialEndsAt?: string | null;
  now?: Date;
}): MealLineDeliveryView {
  const now = params.now ?? new Date();
  const paidOrPilot = isMemberMealPersonalFullEnabled({ memberCode: params.memberCode, pass: params.pass });
  const trialActive = isMealLineDeliveryTrialActive(params.trialEndsAt, now);
  const trialUsed = Boolean(params.trialStartedAt);
  const entitled = paidOrPilot || trialActive;
  const status: MealLineDeliveryStatus = paidOrPilot ? "active" : trialActive ? "trial" : trialUsed ? "expired" : "none";
  return {
    entitled,
    status,
    trial_used: trialUsed,
    trial_ends_at: params.trialEndsAt ?? null,
    price_label: MEAL_LINE_DELIVERY_PRICE_LABEL,
    trial_button_label: MEAL_LINE_DELIVERY_TRIAL_BUTTON,
    subscribe_url: entitled || isMealPersonalPassActive(params.pass, now) ? null : mealPersonalSubscribeUrl(),
  };
}

export async function fetchMealLineDeliveryTrial(
  supabase: SupabaseClient,
  memberId: string
): Promise<{ ok: true; row: MealLineDeliveryTrialRow; missingColumn?: boolean } | { ok: false; error: string }> {
  const { data, error } = await (supabase as any)
    .from("member_meal_reminder_settings")
    .select("line_delivery_trial_started_at, line_delivery_trial_ends_at")
    .eq("member_id", memberId)
    .maybeSingle();
  if (error) {
    if (isMissingMealLineDeliveryColumn(error)) {
      return { ok: true, row: { trialStartedAt: null, trialEndsAt: null }, missingColumn: true };
    }
    const missingTable =
      error.code === "PGRST205" || /member_meal_reminder_settings|Could not find the table/i.test(String(error.message ?? ""));
    if (missingTable) return { ok: true, row: { trialStartedAt: null, trialEndsAt: null }, missingColumn: true };
    return { ok: false, error: String(error.message ?? error) };
  }
  return {
    ok: true,
    row: {
      trialStartedAt: data?.line_delivery_trial_started_at ?? null,
      trialEndsAt: data?.line_delivery_trial_ends_at ?? null,
    },
  };
}

export async function fetchActiveMealLineDeliveryTrials(
  supabase: SupabaseClient,
  now = new Date()
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const { data, error } = await (supabase as any)
    .from("member_meal_reminder_settings")
    .select("member_id, line_delivery_trial_ends_at")
    .gt("line_delivery_trial_ends_at", now.toISOString());
  if (error) return map;
  for (const row of (data ?? []) as Array<{ member_id?: string; line_delivery_trial_ends_at?: string | null }>) {
    const id = String(row.member_id ?? "");
    const ends = row.line_delivery_trial_ends_at ?? null;
    if (id && isMealLineDeliveryTrialActive(ends, now)) map.set(id, String(ends));
  }
  return map;
}

export async function startMealLineDeliveryTrial(
  supabase: SupabaseClient,
  memberId: string,
  now = new Date()
): Promise<{ ok: true; trialEndsAt: string } | { ok: false; error: string; missingColumn?: boolean; code?: string }> {
  const existing = await fetchMealLineDeliveryTrial(supabase, memberId);
  if (!existing.ok) return existing;
  if (existing.missingColumn) {
    return { ok: false, error: "配信お試しの保存準備ができていません", missingColumn: true, code: "missing_column" };
  }
  if (existing.row.trialStartedAt) {
    return { ok: false, error: "お試しはすでに利用済みです", code: "trial_used" };
  }

  const startedAt = now.toISOString();
  const trialEndsAt = mealLineDeliveryTrialEndsAt(now).toISOString();
  const payload = {
    line_delivery_trial_started_at: startedAt,
    line_delivery_trial_ends_at: trialEndsAt,
    updated_at: now.toISOString(),
  };

  const { data: current, error: readErr } = await (supabase as any)
    .from("member_meal_reminder_settings")
    .select("member_id")
    .eq("member_id", memberId)
    .maybeSingle();
  if (readErr) return { ok: false, error: String(readErr.message ?? readErr) };

  if (current) {
    const { data, error } = await (supabase as any)
      .from("member_meal_reminder_settings")
      .update(payload)
      .eq("member_id", memberId)
      .is("line_delivery_trial_started_at", null)
      .select("line_delivery_trial_ends_at")
      .maybeSingle();
    if (error) {
      if (isMissingMealLineDeliveryColumn(error)) {
        return { ok: false, error: "配信お試しの保存準備ができていません", missingColumn: true, code: "missing_column" };
      }
      return { ok: false, error: String(error.message ?? error) };
    }
    if (!data) return { ok: false, error: "お試しはすでに利用済みです", code: "trial_used" };
    return { ok: true, trialEndsAt: String(data.line_delivery_trial_ends_at ?? trialEndsAt) };
  }

  const { error } = await (supabase as any).from("member_meal_reminder_settings").insert({
    member_id: memberId,
    ...DEFAULT_REMINDER_TIMES,
    ...payload,
  });
  if (error) {
    if (isMissingMealLineDeliveryColumn(error)) {
      return { ok: false, error: "配信お試しの保存準備ができていません", missingColumn: true, code: "missing_column" };
    }
    if (/duplicate|unique/i.test(String(error.message ?? "")) || error.code === "23505") {
      return { ok: false, error: "お試しはすでに利用済みです", code: "trial_used" };
    }
    return { ok: false, error: String(error.message ?? error) };
  }
  return { ok: true, trialEndsAt };
}
