import { isMemberMealPersonalPilot } from "@/lib/memberMealPersonalRollout";
import type { SupabaseClient } from "@supabase/supabase-js";

const ACTIVE_STATUSES = new Set(["active", "trialing", "past_due"]);
const PASS_SELECT = "id, member_code, is_active, meal_personal_pass_status, meal_personal_pass_current_period_end";
const PASS_SELECT_LEGACY = "id, member_code, is_active";

export type MealPersonalPassRow = {
  meal_personal_pass_status?: string | null;
  meal_personal_pass_current_period_end?: string | null;
};

export type MemberMealPersonalGate = {
  id: string;
  member_code: string;
  is_active: boolean | null;
  full: boolean;
  pass: MealPersonalPassRow | null;
};

export function mealPersonalPassPriceLabel(): string {
  return process.env.NEXT_PUBLIC_MEAL_PERSONAL_PASS_PRICE_LABEL?.trim() || "食事パーソナル（月額）";
}

export function isMissingMealPersonalPassColumn(err: unknown): boolean {
  const msg =
    typeof err === "object" && err && "message" in err ? String((err as { message?: string }).message) : String(err ?? "");
  return /meal_personal_pass_|meal_personal_stripe_/i.test(msg) && /does not exist|schema cache|column/i.test(msg);
}

export function isMealPersonalPassActive(row: MealPersonalPassRow | null | undefined, now = new Date()): boolean {
  if (!row) return false;
  const status = String(row.meal_personal_pass_status ?? "inactive").trim().toLowerCase();
  const endRaw = row.meal_personal_pass_current_period_end;
  const endMs = endRaw ? Date.parse(endRaw) : NaN;
  const endOk = !Number.isFinite(endMs) || endMs > now.getTime();
  if (ACTIVE_STATUSES.has(status)) return endOk;
  if (status === "canceled" && Number.isFinite(endMs)) return endMs > now.getTime();
  return false;
}

export function isMemberMealPersonalFullEnabled(params: {
  memberCode?: string | null;
  pass?: MealPersonalPassRow | null;
}): boolean {
  if (isMemberMealPersonalPilot(params.memberCode)) return true;
  return isMealPersonalPassActive(params.pass);
}

export function mealPersonalCheckoutPath(): string {
  return "/api/member/meal-personal/checkout";
}

export function mealPersonalCheckoutAvailable(): boolean {
  return Boolean(process.env.STRIPE_MEAL_PERSONAL_PRICE_ID?.trim() && process.env.STRIPE_SECRET_KEY?.trim());
}

export function mealPersonalSubscribeUrl(): string | null {
  if (mealPersonalCheckoutAvailable()) return mealPersonalCheckoutPath();
  return process.env.STRIPE_MEAL_PERSONAL_PAYMENT_LINK_URL?.trim() || null;
}

export async function loadMemberMealPersonalGate(
  supabase: SupabaseClient,
  memberId: string
): Promise<MemberMealPersonalGate | null> {
  let { data, error } = await (supabase as any).from("members").select(PASS_SELECT).eq("id", memberId).maybeSingle();
  if (error && isMissingMealPersonalPassColumn(error)) {
    const second = await (supabase as any).from("members").select(PASS_SELECT_LEGACY).eq("id", memberId).maybeSingle();
    data = second.data;
    error = second.error;
  }
  if (error) throw new Error(error.message);
  if (!data) return null;
  const pass: MealPersonalPassRow = {
    meal_personal_pass_status: data.meal_personal_pass_status ?? null,
    meal_personal_pass_current_period_end: data.meal_personal_pass_current_period_end ?? null,
  };
  return {
    id: String(data.id),
    member_code: String(data.member_code ?? ""),
    is_active: data.is_active ?? null,
    full: isMemberMealPersonalFullEnabled({ memberCode: data.member_code, pass }),
    pass,
  };
}

export type MealPersonalPassView = {
  active: boolean;
  status: string;
  current_period_end: string | null;
  subscribe_url: string | null;
};

function toPassView(gate: MemberMealPersonalGate): MealPersonalPassView {
  if (gate.full) {
    const paid = isMealPersonalPassActive(gate.pass);
    return {
      active: true,
      status: paid ? String(gate.pass?.meal_personal_pass_status ?? "active") : "pilot",
      current_period_end: gate.pass?.meal_personal_pass_current_period_end ?? null,
      subscribe_url: null,
    };
  }
  return {
    active: false,
    status: String(gate.pass?.meal_personal_pass_status ?? "inactive"),
    current_period_end: gate.pass?.meal_personal_pass_current_period_end ?? null,
    subscribe_url: mealPersonalSubscribeUrl(),
  };
}

export async function fetchMealPersonalPassForMemberId(
  supabase: SupabaseClient,
  memberId: string,
  memberCode = ""
): Promise<MealPersonalPassView> {
  try {
    const gate = await loadMemberMealPersonalGate(supabase, memberId);
    if (gate) return toPassView(gate);
  } catch (e) {
    console.error("fetch meal personal pass failed", e);
  }
  if (isMemberMealPersonalPilot(memberCode)) {
    return { active: true, status: "pilot", current_period_end: null, subscribe_url: null };
  }
  return {
    active: false,
    status: "inactive",
    current_period_end: null,
    subscribe_url: mealPersonalSubscribeUrl(),
  };
}
