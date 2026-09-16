import type { Database } from "@/types/database";
import type { SupabaseClient } from "@supabase/supabase-js";

export type TrainerVisibilityPassView = {
  active: boolean;
  status: string;
  current_period_end: string | null;
  subscribe_url: string | null;
};

type MemberPassRow = {
  id: string;
  member_code: string;
  name: string | null;
  email?: string | null;
  is_active: boolean | null;
  store_id?: string | null;
  trainer_visibility_pass_status?: string | null;
  trainer_visibility_pass_current_period_end?: string | null;
};

const PASS_SELECT =
  "id, member_code, name, email, is_active, store_id, trainer_visibility_pass_status, trainer_visibility_pass_current_period_end";
const PASS_SELECT_LEGACY = "id, member_code, name, email, is_active, store_id";

const ACTIVE_STATUSES = new Set(["active", "trialing", "past_due"]);

/** 決済なしで出勤名を確認できるテスト会員 */
const TEST_PASS_EMAILS = new Set(["abodyofficial.mail@gmail.com"]);
const TEST_PASS_MEMBER_CODES = new Set(["ebi020"]);

export function isTrainerVisibilityTestAccount(email?: string | null, memberCode?: string | null): boolean {
  const e = String(email ?? "").trim().toLowerCase();
  const c = String(memberCode ?? "").trim().toLowerCase();
  return (e.length > 0 && TEST_PASS_EMAILS.has(e)) || (c.length > 0 && TEST_PASS_MEMBER_CODES.has(c));
}

export function resolveTrainerVisibilityPassActive(
  passActive: boolean | undefined,
  email?: string | null,
  memberCode?: string | null
): boolean {
  return Boolean(passActive) || isTrainerVisibilityTestAccount(email, memberCode);
}

export function memberCodesMatch(a?: string | null, b?: string | null): boolean {
  const left = String(a ?? "").trim().toLowerCase();
  const right = String(b ?? "").trim().toLowerCase();
  return left.length > 0 && left === right;
}

export function isMissingTrainerVisibilityColumn(err: unknown): boolean {
  const msg =
    typeof err === "object" && err && "message" in err ? String((err as { message?: string }).message) : String(err ?? "");
  return /trainer_visibility_/i.test(msg) && /does not exist|schema cache|column/i.test(msg);
}

export function isTrainerVisibilityPassActive(
  row: {
    trainer_visibility_pass_status?: string | null;
    trainer_visibility_pass_current_period_end?: string | null;
  } | null
  | undefined,
  now = new Date()
): boolean {
  if (!row) return false;
  const status = String(row.trainer_visibility_pass_status ?? "inactive").trim().toLowerCase();
  const endRaw = row.trainer_visibility_pass_current_period_end;
  const endMs = endRaw ? Date.parse(endRaw) : NaN;
  const endOk = !Number.isFinite(endMs) || endMs > now.getTime();

  if (ACTIVE_STATUSES.has(status)) return endOk;
  // 解約済みでも期間末までは表示する
  if (status === "canceled" && Number.isFinite(endMs)) return endMs > now.getTime();
  return false;
}

export function buildTrainerVisibilitySubscribeUrl(_memberId: string, _email: string): string | null {
  if (process.env.STRIPE_TRAINER_VISIBILITY_PRICE_ID?.trim() && process.env.STRIPE_SECRET_KEY?.trim()) {
    return "/api/booking-v2/trainer-pass/checkout";
  }
  return process.env.STRIPE_TRAINER_VISIBILITY_PAYMENT_LINK_URL?.trim() || null;
}

export function trainerVisibilityPassPriceLabel(): string {
  return process.env.NEXT_PUBLIC_TRAINER_VISIBILITY_PASS_PRICE_LABEL?.trim() || "月額パス";
}

export function pickActiveMember<T extends { is_active: boolean | null; store_id?: string | null }>(
  rows: T[],
  storeId?: string
): T | null {
  if (storeId) {
    const home = rows.find((m) => m?.is_active && String(m?.store_id ?? "") === storeId);
    if (home) return home;
  }
  return rows.find((m) => m?.is_active) ?? null;
}

function toPassView(row: MemberPassRow, email: string): TrainerVisibilityPassView {
  if (isTrainerVisibilityTestAccount(email, row.member_code) || isTrainerVisibilityTestAccount(row.email, row.member_code)) {
    return {
      active: true,
      status: "test",
      current_period_end: null,
      subscribe_url: null,
    };
  }
  const active = isTrainerVisibilityPassActive(row);
  return {
    active,
    status: String(row.trainer_visibility_pass_status ?? "inactive"),
    current_period_end: row.trainer_visibility_pass_current_period_end ?? null,
    subscribe_url: active ? null : buildTrainerVisibilitySubscribeUrl(row.id, email),
  };
}

export async function fetchTrainerVisibilityPassForEmail(
  supabase: SupabaseClient<Database>,
  email: string,
  storeId?: string
): Promise<{ memberId: string; memberCode: string; name: string; pass: TrainerVisibilityPassView } | null> {
  const normalized = email.trim();
  if (!normalized) return null;

  let { data: rows, error } = await (supabase as any)
    .from("members")
    .select(PASS_SELECT)
    .ilike("email", normalized)
    .limit(10);

  if (error && isMissingTrainerVisibilityColumn(error)) {
    const second = await (supabase as any).from("members").select(PASS_SELECT_LEGACY).ilike("email", normalized).limit(10);
    rows = second.data;
    error = second.error;
  }
  if (error) {
    throw new Error(error.message ?? "会員の取得に失敗しました");
  }

  const member =
    pickActiveMember((rows ?? []) as MemberPassRow[], storeId) ??
    ((rows ?? []) as MemberPassRow[]).find(
      (m) => isTrainerVisibilityTestAccount(normalized, m.member_code) || isTrainerVisibilityTestAccount(m.email, m.member_code)
    ) ??
    null;
  if (!member) return null;

  return {
    memberId: member.id,
    memberCode: member.member_code,
    name: member.name ?? "",
    pass: toPassView(member, normalized),
  };
}

export async function fetchTrainerVisibilityPassForMemberId(
  supabase: SupabaseClient<Database>,
  memberId: string,
  email = ""
): Promise<TrainerVisibilityPassView> {
  let { data, error } = await (supabase as any)
    .from("members")
    .select(PASS_SELECT)
    .eq("id", memberId)
    .maybeSingle();

  if (error && isMissingTrainerVisibilityColumn(error)) {
    if (isTrainerVisibilityTestAccount(email)) {
      return { active: true, status: "test", current_period_end: null, subscribe_url: null };
    }
    return {
      active: false,
      status: "inactive",
      current_period_end: null,
      subscribe_url: buildTrainerVisibilitySubscribeUrl(memberId, email),
    };
  }
  if (error || !data) {
    if (isTrainerVisibilityTestAccount(email)) {
      return { active: true, status: "test", current_period_end: null, subscribe_url: null };
    }
    return {
      active: false,
      status: "inactive",
      current_period_end: null,
      subscribe_url: buildTrainerVisibilitySubscribeUrl(memberId, email),
    };
  }
  return toPassView(data as MemberPassRow, email || String((data as MemberPassRow).email ?? ""));
}
