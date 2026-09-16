import { getAppUrl } from "@/lib/constants";
import { createSupabaseServiceClient } from "@/lib/supabase/admin";
import { isMissingTrainerVisibilityColumn, pickActiveMember } from "@/lib/trainerVisibilityPass";
import { unixSecondsToIso } from "@/lib/stripeWebhook";

export type StripeSubscription = {
  id?: string;
  status?: string;
  customer?: string | { id?: string };
  current_period_end?: number;
  metadata?: { member_id?: string; member_code?: string };
  items?: { data?: Array<{ price?: { id?: string } }> };
};

export function customerIdOf(value: unknown): string {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "id" in value) return String((value as { id?: string }).id ?? "");
  return "";
}

export function trainerVisibilityCheckoutUrl(): string | null {
  const base = process.env.STRIPE_TRAINER_VISIBILITY_PAYMENT_LINK_URL?.trim();
  return base || null;
}

export async function stripePost(path: string, body: Record<string, string>): Promise<any> {
  const key = process.env.STRIPE_SECRET_KEY?.trim();
  if (!key) throw new Error("STRIPE_SECRET_KEY が未設定です");
  const res = await fetch(`https://api.stripe.com/v1${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(body).toString(),
  });
  const jsonBody = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = String((jsonBody as any)?.error?.message ?? `Stripe ${res.status}`);
    throw new Error(msg);
  }
  return jsonBody;
}

/** 無効化した決済リンクに頼らず、都度 Checkout Session を作る */
export async function createTrainerVisibilityCheckoutUrl(params?: {
  email?: string;
  memberId?: string;
  memberCode?: string;
}): Promise<string | null> {
  const priceId = targetPriceId();
  if (priceId && process.env.STRIPE_SECRET_KEY?.trim()) {
    const app = getAppUrl();
    const email = String(params?.email ?? "").trim();
    const memberId = String(params?.memberId ?? "").trim();
    const memberCode = String(params?.memberCode ?? "").trim();
    const body: Record<string, string> = {
      mode: "subscription",
      locale: "ja",
      "line_items[0][price]": priceId,
      "line_items[0][quantity]": "1",
      success_url: `${app}/booking?trainer_pass=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${app}/booking`,
    };
    if (email) body.customer_email = email;
    if (memberId) {
      body.client_reference_id = memberId;
      body["metadata[member_id]"] = memberId;
      body["subscription_data[metadata][member_id]"] = memberId;
    }
    if (memberCode) {
      body["metadata[member_code]"] = memberCode;
      body["subscription_data[metadata][member_code]"] = memberCode;
    }
    if (email) {
      body["metadata[member_email]"] = email;
      body["subscription_data[metadata][member_email]"] = email;
    }
    if (memberCode) {
      body["custom_fields[0][key]"] = "member_code";
      body["custom_fields[0][label][type]"] = "custom";
      body["custom_fields[0][label][custom]"] = "会員番号";
      body["custom_fields[0][type]"] = "text";
      body["custom_fields[0][text][default_value]"] = memberCode;
    }
    const session = await stripePost("/checkout/sessions", body);
    const url = String(session?.url ?? "").trim();
    if (url) return url;
  }
  return null;
}

function targetPriceId(): string {
  return process.env.STRIPE_TRAINER_VISIBILITY_PRICE_ID?.trim() ?? "";
}

export function subscriptionMatchesProduct(sub: StripeSubscription | null | undefined): boolean {
  const priceId = targetPriceId();
  if (!priceId) return true;
  if (!sub) return false;
  const items = sub.items?.data ?? [];
  return items.some((it) => it?.price?.id === priceId);
}

export async function stripeGet(path: string): Promise<any> {
  const key = process.env.STRIPE_SECRET_KEY?.trim();
  if (!key) throw new Error("STRIPE_SECRET_KEY が未設定です");
  const res = await fetch(`https://api.stripe.com/v1${path}`, {
    headers: { Authorization: `Bearer ${key}` },
  });
  const jsonBody = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = String((jsonBody as any)?.error?.message ?? `Stripe ${res.status}`);
    throw new Error(msg);
  }
  return jsonBody;
}

export async function loadSubscription(subscriptionId: string): Promise<StripeSubscription | null> {
  if (!subscriptionId) return null;
  try {
    return (await stripeGet(`/subscriptions/${encodeURIComponent(subscriptionId)}`)) as StripeSubscription;
  } catch (e) {
    console.error("stripe subscription fetch failed", e);
    return null;
  }
}

export async function findMemberIdForTrainerPass(params: {
  supabase: ReturnType<typeof createSupabaseServiceClient>;
  email?: string;
  memberId?: string;
  customerId?: string;
  subscriptionId?: string;
}): Promise<string | null> {
  const { supabase } = params;

  const memberId = String(params.memberId ?? "");
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(memberId)) {
    const { data } = await supabase.from("members").select("id").eq("id", memberId).maybeSingle();
    if (data?.id) return String(data.id);
  }

  const trySelect = async (column: string, value: string) => {
    if (!value) return null;
    const q = await (supabase as any).from("members").select("id").eq(column, value).limit(1).maybeSingle();
    if (q.error && isMissingTrainerVisibilityColumn(q.error)) return null;
    return q.data?.id ? String(q.data.id) : null;
  };

  const byCustomer = await trySelect("trainer_visibility_stripe_customer_id", params.customerId ?? "");
  if (byCustomer) return byCustomer;
  const bySub = await trySelect("trainer_visibility_stripe_subscription_id", params.subscriptionId ?? "");
  if (bySub) return bySub;

  const email = String(params.email ?? "").trim();
  if (email) {
    const { data: rows } = await supabase.from("members").select("id, is_active, store_id").ilike("email", email).limit(10);
    const member = pickActiveMember((rows ?? []) as Array<{ id: string; is_active: boolean | null; store_id?: string | null }>);
    if (member?.id) return String(member.id);
  }
  return null;
}

export async function recordTrainerPassEvent(params: {
  supabase: ReturnType<typeof createSupabaseServiceClient>;
  eventType: string;
  memberId?: string | null;
  memberCode?: string | null;
  stripeEmail?: string | null;
  customerId?: string | null;
  subscriptionId?: string | null;
  sessionId?: string | null;
  status?: string | null;
  detail?: Record<string, unknown> | null;
}) {
  try {
    const { error } = await (params.supabase as any).from("trainer_visibility_pass_events").insert({
      event_type: params.eventType,
      member_id: params.memberId || null,
      member_code: params.memberCode || null,
      stripe_email: params.stripeEmail || null,
      stripe_customer_id: params.customerId || null,
      stripe_subscription_id: params.subscriptionId || null,
      stripe_session_id: params.sessionId || null,
      status: params.status || null,
      detail: params.detail ?? null,
    });
    if (error) console.error("trainer pass event insert failed", error.message);
  } catch (e) {
    console.error("trainer pass event insert failed", e);
  }
}

export async function applyTrainerPassToMember(params: {
  supabase: ReturnType<typeof createSupabaseServiceClient>;
  memberId: string;
  status: string;
  customerId: string;
  subscriptionId: string;
  periodEndIso: string | null;
  stripeEmail?: string | null;
  setActivatedAt?: boolean;
}) {
  const patch: Record<string, unknown> = {
    trainer_visibility_pass_status: params.status || "inactive",
    trainer_visibility_pass_current_period_end: params.periodEndIso,
  };
  if (params.customerId) patch.trainer_visibility_stripe_customer_id = params.customerId;
  if (params.subscriptionId) patch.trainer_visibility_stripe_subscription_id = params.subscriptionId;
  if (params.stripeEmail) patch.trainer_visibility_pass_email = params.stripeEmail;
  if (params.setActivatedAt) patch.trainer_visibility_pass_activated_at = new Date().toISOString();

  const run = async (body: Record<string, unknown>) =>
    (params.supabase as any).from("members").update(body).eq("id", params.memberId);

  let { error } = await run(patch);
  if (error && /trainer_visibility_pass_email|trainer_visibility_pass_activated_at/i.test(String(error.message ?? ""))) {
    const fallback = { ...patch };
    delete fallback.trainer_visibility_pass_email;
    delete fallback.trainer_visibility_pass_activated_at;
    const second = await run(fallback);
    error = second.error;
  }
  if (error) {
    if (isMissingTrainerVisibilityColumn(error)) {
      console.error("trainer visibility columns missing; skip pass update");
      return;
    }
    throw new Error(error.message);
  }
}

export async function activateTrainerPassFromCheckoutSession(session: {
  id?: string;
  mode?: string;
  payment_status?: string;
  status?: string;
  client_reference_id?: string;
  customer?: unknown;
  subscription?: unknown;
  customer_email?: string;
  customer_details?: { email?: string };
  metadata?: { member_id?: string; member_code?: string };
}): Promise<{ email: string; memberId: string; memberName: string; memberCode: string }> {
  if (String(session.mode ?? "") !== "subscription") {
    throw Object.assign(new Error("サブスク決済ではありません"), { status: 400 });
  }
  const paid = String(session.payment_status ?? "") === "paid" || String(session.status ?? "") === "complete";
  if (!paid) {
    throw Object.assign(new Error("決済が完了していません"), { status: 400 });
  }

  const email = String(session.customer_details?.email ?? session.customer_email ?? "").trim();
  if (!email) {
    throw Object.assign(new Error("決済メールアドレスが取得できませんでした"), { status: 400 });
  }

  const subscriptionId = customerIdOf(session.subscription);
  const customerId = customerIdOf(session.customer);
  const sub = await loadSubscription(subscriptionId);
  if (!subscriptionMatchesProduct(sub)) {
    throw Object.assign(new Error("対象外の決済です"), { status: 400 });
  }

  const supabase = createSupabaseServiceClient();
  const intendedMemberId = String(session.client_reference_id ?? session.metadata?.member_id ?? "");
  const memberId = await findMemberIdForTrainerPass({
    supabase,
    email,
    memberId: intendedMemberId,
    customerId,
    subscriptionId,
  });
  if (!memberId) {
    await recordTrainerPassEvent({
      supabase,
      eventType: "unmatched_checkout",
      stripeEmail: email,
      customerId,
      subscriptionId,
      sessionId: String(session.id ?? ""),
      status: "unmatched",
      detail: { client_reference_id: intendedMemberId },
    });
    throw Object.assign(new Error("会員登録と同じメールアドレスで決済してください"), { status: 404 });
  }

  await applyTrainerPassToMember({
    supabase,
    memberId,
    status: String(sub?.status ?? "active"),
    customerId,
    subscriptionId,
    periodEndIso: unixSecondsToIso(sub?.current_period_end),
    stripeEmail: email,
    setActivatedAt: true,
  });

  const { data: member } = await supabase
    .from("members")
    .select("name, member_code")
    .eq("id", memberId)
    .maybeSingle();
  const memberCode = String(member?.member_code ?? session.metadata?.member_code ?? "");
  await recordTrainerPassEvent({
    supabase,
    eventType: "checkout_completed",
    memberId,
    memberCode,
    stripeEmail: email,
    customerId,
    subscriptionId,
    sessionId: String(session.id ?? ""),
    status: String(sub?.status ?? "active"),
  });
  return { email, memberId, memberName: String(member?.name ?? ""), memberCode };
}
