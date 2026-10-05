import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { applyTicketDelta } from "@/lib/booking/memberBookingRulesDb";
import { campaignNeedsReferrer } from "@/lib/memberEnrollment";
import { parseMembershipPlan, type MembershipPlan } from "@/lib/memberPlans";

/** 店舗名 → 会員番号プレフィックス */
export const STORE_MEMBER_CODE_PREFIX: Record<string, string> = {
  恵比寿: "EBI",
  上野: "UEN",
  桜木町: "SAK",
  新宿: "SHI",
  福岡: "FUK",
};

export function memberCodePrefixForStoreName(storeName: string): string | null {
  return STORE_MEMBER_CODE_PREFIX[storeName] ?? null;
}

function parseMemberCodeNumber(code: string, prefix: string): number | null {
  const upper = String(code ?? "").trim().toUpperCase();
  if (!upper.startsWith(prefix)) return null;
  const numPart = upper.slice(prefix.length);
  if (!/^\d+$/.test(numPart)) return null;
  const n = Number(numPart);
  return Number.isFinite(n) ? n : null;
}

export async function nextMemberCodeForStore(
  supabase: SupabaseClient<Database>,
  storeName: string
): Promise<string> {
  const prefix = memberCodePrefixForStoreName(storeName);
  if (!prefix) throw new Error(`未対応の店舗です: ${storeName}`);

  const { data, error } = await supabase.from("members").select("member_code").ilike("member_code", `${prefix}%`);
  if (error) throw error;

  let max = 0;
  for (const row of data ?? []) {
    const n = parseMemberCodeNumber(String(row.member_code ?? ""), prefix);
    if (n !== null && n > max) max = n;
  }

  const next = max + 1;
  if (next > 999) throw new Error("会員番号の上限（999）に達しました");
  return `${prefix}${String(next).padStart(3, "0")}`;
}

export function buildInitialKarteContent(params: {
  counselingContent?: string | null;
  trialSessionContent?: string | null;
}): string {
  const counseling = String(params.counselingContent ?? "").trim();
  const trial = String(params.trialSessionContent ?? "").trim();
  const lines: string[] = ["【入会時カルテ】"];
  if (counseling) {
    lines.push("");
    lines.push("【カウンセリング内容】");
    lines.push(counseling);
  }
  if (trial) {
    lines.push("");
    lines.push("【体験時のセッション内容】");
    lines.push(trial);
  }
  if (!counseling && !trial) {
    lines.push("");
    lines.push("（内容未入力）");
  }
  return lines.join("\n");
}

export async function ensureInitialClientNote(
  supabase: SupabaseClient<Database>,
  memberId: string,
  storeId: string,
  content: string
): Promise<{ created: boolean; skipped?: boolean; reason?: string }> {
  const { data: existing } = await supabase.from("client_notes").select("id").eq("member_id", memberId).limit(1);
  if (existing?.length) return { created: false, skipped: true };

  const { data: trainers, error: tErr } = await supabase
    .from("trainers")
    .select("id")
    .eq("store_id", storeId)
    .eq("is_active", true)
    .limit(1);
  if (tErr) throw tErr;

  let trainerId = trainers?.[0]?.id ?? null;
  if (!trainerId) {
    const { data: anyTrainer, error: anyErr } = await supabase
      .from("trainers")
      .select("id")
      .eq("is_active", true)
      .limit(1);
    if (anyErr) throw anyErr;
    trainerId = anyTrainer?.[0]?.id ?? null;
  }
  if (!trainerId) return { created: false, skipped: true, reason: "no_active_trainer" };

  const today = new Date().toISOString().slice(0, 10);
  const { error } = await supabase.from("client_notes").insert({
    member_id: memberId,
    store_id: storeId,
    trainer_id: trainerId,
    date: today,
    content,
  });
  if (error) throw error;
  return { created: true };
}

export type RegisterMemberInput = {
  store_id: string;
  name: string;
  email: string;
  joined_at: string;
  min_commitment_months: number | null;
  has_enrollment_fee: boolean;
  enrollment_campaign: string;
  membership_plan: MembershipPlan;
  enrollment_bonus_koma?: number | null;
  referrer_member_id?: string | null;
  has_changing_clothes_plan: boolean;
  has_meal_personal: boolean;
};

export type RegisterMemberResult = {
  id: string;
  member_code: string;
  name: string;
  email: string | null;
  store_id: string;
  store_name: string;
  bonus_ticket_koma: number;
};

export async function registerMember(
  supabase: SupabaseClient<Database>,
  input: RegisterMemberInput
): Promise<RegisterMemberResult> {
  const name = input.name.trim();
  if (!name) throw new Error("氏名を入力してください");

  const email = String(input.email ?? "").trim();
  if (!email) throw new Error("メールアドレスを入力してください");

  const { data: store, error: storeErr } = await supabase
    .from("stores")
    .select("id, name")
    .eq("id", input.store_id)
    .maybeSingle();
  if (storeErr) throw storeErr;
  if (!store) throw new Error("店舗が見つかりません");

  const member_code = await nextMemberCodeForStore(supabase, store.name);

  const membershipPlan = parseMembershipPlan(input.membership_plan);
  if (!membershipPlan) throw new Error("コースを選択してください");

  const campaign = input.enrollment_campaign.trim();
  let referrerMemberId: string | null = null;
  if (campaignNeedsReferrer(campaign)) {
    referrerMemberId = String(input.referrer_member_id ?? "").trim() || null;
    if (!referrerMemberId) throw new Error("紹介者を選択してください");
    const { data: referrer, error: referrerErr } = await supabase
      .from("members")
      .select("id")
      .eq("id", referrerMemberId)
      .maybeSingle();
    if (referrerErr) throw referrerErr;
    if (!referrer) throw new Error("紹介者が見つかりません");
  }

  const enrollment = {
    joined_at: input.joined_at,
    min_commitment_months: input.min_commitment_months,
    has_enrollment_fee: input.has_enrollment_fee,
    enrollment_campaign: campaign,
    membership_plan: membershipPlan,
    referrer_member_id: referrerMemberId,
    has_changing_clothes_plan: input.has_changing_clothes_plan,
    has_meal_personal: input.has_meal_personal,
  };

  const baseRow = {
    member_code,
    name,
    display_name: name,
    email,
    store_id: store.id,
    is_active: true,
    membership_status: "active" as const,
    line_user_id: null,
  };

  const first = await supabase
    .from("members")
    .insert({ ...baseRow, ...enrollment })
    .select("id, member_code, name, email, store_id")
    .single();
  let member = first.data;
  let insertErr = first.error;
  if (
    insertErr &&
    /joined_at|min_commitment_months|has_enrollment_fee|enrollment_campaign|referrer_member_id|has_changing_clothes_plan|has_meal_personal|membership_plan_check|monthly_4|monthly_8/i.test(
      insertErr.message ?? ""
    )
  ) {
    throw new Error("入会情報の保存準備ができていません（DBマイグレーション未適用の可能性）");
  }
  if (insertErr && /membership_plan/i.test(insertErr.message ?? "")) {
    const withoutPlan = { ...baseRow, ...enrollment } as Record<string, unknown>;
    delete withoutPlan.membership_plan;
    const retry = await supabase
      .from("members")
      .insert(withoutPlan as typeof baseRow)
      .select("id, member_code, name, email, store_id")
      .single();
    member = retry.data;
    insertErr = retry.error;
  }
  if (insertErr) throw insertErr;
  if (!member) throw new Error("会員の登録に失敗しました");

  const bonus = Math.max(0, Math.floor(Number(input.enrollment_bonus_koma ?? 0) || 0));
  let bonusTicketKoma = 0;
  if (bonus > 0) {
    const granted = await applyTicketDelta(supabase, {
      memberId: member.id,
      delta: bonus,
      reason: "enrollment_bonus",
      note: "入会特典",
    });
    if (!granted.ok) throw new Error(granted.error ?? "入会特典の付与に失敗しました");
    bonusTicketKoma = granted.ticketKoma;
  }

  return {
    id: member.id,
    member_code: member.member_code,
    name: member.name ?? name,
    email: member.email ?? null,
    store_id: store.id,
    store_name: store.name,
    bonus_ticket_koma: bonusTicketKoma,
  };
}
