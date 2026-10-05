import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { isMealPersonalStandaloneAccount } from "@/lib/memberMealPersonalRollout";

type Db = SupabaseClient<Database>;

export const MEAL_PERSONAL_STORE_NAME = "食事パーソナル";
const ACCOUNT_PREFIX = "MPS";

type MemberHit = { id: string; member_code: string; email?: string | null };

export async function findMemberByEmail(
  supabase: Db,
  email: string
): Promise<MemberHit | "multiple" | "error" | null> {
  const normalized = email.trim().toLowerCase();
  const pattern = normalized.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
  const { data, error } = await supabase
    .from("members")
    .select("id, member_code, email")
    .ilike("email", pattern)
    .limit(5);
  if (error) return "error";
  const matches = ((data ?? []) as MemberHit[]).filter(
    (row) => String(row.email ?? "").trim().toLowerCase() === normalized
  );
  if (matches.length > 1) return "multiple";
  return matches[0] ?? null;
}

async function ensureMealPersonalStore(supabase: Db): Promise<string> {
  const { data: existing, error: findErr } = await supabase
    .from("stores")
    .select("id")
    .eq("name", MEAL_PERSONAL_STORE_NAME)
    .limit(1)
    .maybeSingle();
  if (findErr) throw new Error(findErr.message);
  if (existing?.id) return existing.id;

  const { data: created, error: createErr } = await supabase
    .from("stores")
    .insert({
      name: MEAL_PERSONAL_STORE_NAME,
      timezone: "Asia/Tokyo",
      is_active: false,
      booking_cutoff_prev_day_time: "22:00",
    })
    .select("id")
    .single();
  if (createErr || !created?.id) throw new Error(createErr?.message || "店舗を用意できませんでした");
  return created.id;
}

async function nextMealPersonalCode(supabase: Db): Promise<string> {
  const { data, error } = await supabase.from("members").select("member_code").ilike("member_code", `${ACCOUNT_PREFIX}%`);
  if (error) throw new Error(error.message);
  let max = 0;
  for (const row of data ?? []) {
    const code = String(row.member_code ?? "").toUpperCase();
    const n = Number(code.slice(ACCOUNT_PREFIX.length));
    if (code.startsWith(ACCOUNT_PREFIX) && Number.isFinite(n) && n > max) max = n;
  }
  const next = max + 1;
  if (next > 999) throw new Error("アカウント番号の上限に達しました");
  return `${ACCOUNT_PREFIX}${String(next).padStart(3, "0")}`;
}

export async function createMealPersonalAccount(
  supabase: Db,
  params: { displayName: string; email: string }
): Promise<{ id: string; member_code: string; created: boolean }> {
  const displayName = params.displayName.trim();
  const email = params.email.trim().toLowerCase();
  const existing = await findMemberByEmail(supabase, email);
  if (existing === "error") throw new Error("メールアドレスの確認に失敗しました");
  if (existing === "multiple") throw new Error("このメールアドレスは使えません。別のアドレスにしてください");
  if (existing) {
    if (!isMealPersonalStandaloneAccount(existing.member_code)) {
      throw new Error("このメールアドレスはジムの会員に使われています。食事パーソナル用には別のアドレスを入れてください");
    }
    const { error } = await supabase.from("members").update({ display_name: displayName, name: displayName }).eq("id", existing.id);
    if (error) throw new Error("アカウントの更新に失敗しました");
    return { id: existing.id, member_code: existing.member_code, created: false };
  }

  const storeId = await ensureMealPersonalStore(supabase);
  let lastError = "アカウントを作成できませんでした";
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const member_code = await nextMealPersonalCode(supabase);
    const { data, error } = await supabase
      .from("members")
      .insert({
        member_code,
        name: displayName,
        display_name: displayName,
        email,
        store_id: storeId,
        is_active: true,
        membership_status: "active",
        line_user_id: null,
        has_meal_personal: true,
      })
      .select("id, member_code")
      .single();
    if (!error && data?.id) return { id: data.id, member_code: data.member_code, created: true };
    const message = error?.message ?? lastError;
    if (/has_meal_personal/i.test(message)) {
      const retry = await supabase
        .from("members")
        .insert({
          member_code,
          name: displayName,
          display_name: displayName,
          email,
          store_id: storeId,
          is_active: true,
          membership_status: "active",
          line_user_id: null,
        })
        .select("id, member_code")
        .single();
      if (!retry.error && retry.data?.id) return { id: retry.data.id, member_code: retry.data.member_code, created: true };
      lastError = retry.error?.message ?? message;
      if (/duplicate|unique/i.test(lastError)) continue;
      throw new Error(lastError);
    }
    lastError = message;
    if (/duplicate|unique/i.test(message)) continue;
    throw new Error(message);
  }
  throw new Error(lastError);
}
