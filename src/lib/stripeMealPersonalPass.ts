import { getAppUrl } from "@/lib/constants";
import { createSupabaseServiceClient } from "@/lib/supabase/admin";
import { isMissingMealPersonalPassColumn } from "@/lib/memberMealPersonalPass";
import { customerIdOf, loadSubscription, stripePost, type StripeSubscription } from "@/lib/stripeTrainerPass";
import { pickActiveMember } from "@/lib/trainerVisibilityPass";
import { unixSecondsToIso } from "@/lib/stripeWebhook";

export function mealPersonalPriceId(): string {
  return process.env.STRIPE_MEAL_PERSONAL_PRICE_ID?.trim() ?? "";
}

export function mealPersonalSubscriptionMatches(sub: StripeSubscription | null | undefined): boolean {
  const priceId = mealPersonalPriceId();
  if (!priceId || !sub) return false;
  return (sub.items?.data ?? []).some((it) => it?.price?.id === priceId);
}

export function isMealPersonalStripeObject(obj: unknown, sub?: StripeSubscription | null): boolean {
  const o = obj as {
    metadata?: { product?: string };
    subscription_details?: { metadata?: { product?: string } };
  } | null;
  const subProduct = (sub?.metadata as { product?: string } | undefined)?.product;
  const product = String(o?.metadata?.product ?? subProduct ?? o?.subscription_details?.metadata?.product ?? "");
  if (product === "meal_personal") return true;
  return mealPersonalSubscriptionMatches(sub ?? (obj as StripeSubscription));
}

export async function createMealPersonalCheckoutUrl(params: {
  email?: string;
  memberId: string;
  memberCode?: string;
}): Promise<string | null> {
  const priceId = mealPersonalPriceId();
  if (!priceId || !process.env.STRIPE_SECRET_KEY?.trim()) return null;
  const app = getAppUrl();
  const email = String(params.email ?? "").trim();
  const memberId = String(params.memberId ?? "").trim();
  const memberCode = String(params.memberCode ?? "").trim();
  const body: Record<string, string> = {
    mode: "subscription",
    locale: "ja",
    "line_items[0][price]": priceId,
    "line_items[0][quantity]": "1",
    success_url: `${app}/meal-log?meal_pass=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${app}/meal-log`,
    client_reference_id: memberId,
    "metadata[product]": "meal_personal",
    "metadata[member_id]": memberId,
    "subscription_data[metadata][product]": "meal_personal",
    "subscription_data[metadata][member_id]": memberId,
  };
  if (email) {
    body.customer_email = email;
    body["metadata[member_email]"] = email;
    body["subscription_data[metadata][member_email]"] = email;
  }
  if (memberCode) {
    body["metadata[member_code]"] = memberCode;
    body["subscription_data[metadata][member_code]"] = memberCode;
    body["custom_fields[0][key]"] = "member_code";
    body["custom_fields[0][label][type]"] = "custom";
    body["custom_fields[0][label][custom]"] = "会員番号";
    body["custom_fields[0][type]"] = "text";
    body["custom_fields[0][text][default_value]"] = memberCode;
  }
  const session = await stripePost("/checkout/sessions", body);
  const url = String(session?.url ?? "").trim();
  return url || null;
}

export async function recordMealPersonalPassEvent(params: {
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
    const { error } = await (params.supabase as any).from("meal_personal_pass_events").insert({
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
    if (error) console.error("meal personal pass event insert failed", error.message);
  } catch (e) {
    console.error("meal personal pass event insert failed", e);
  }
}

export async function applyMealPersonalPassToMember(params: {
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
    meal_personal_pass_status: params.status || "inactive",
    meal_personal_pass_current_period_end: params.periodEndIso,
  };
  if (params.customerId) patch.meal_personal_stripe_customer_id = params.customerId;
  if (params.subscriptionId) patch.meal_personal_stripe_subscription_id = params.subscriptionId;
  if (params.stripeEmail) patch.meal_personal_pass_email = params.stripeEmail;
  if (params.setActivatedAt) patch.meal_personal_pass_activated_at = new Date().toISOString();

  const run = async (body: Record<string, unknown>) =>
    (params.supabase as any).from("members").update(body).eq("id", params.memberId);

  let { error } = await run(patch);
  if (error && /meal_personal_pass_email|meal_personal_pass_activated_at/i.test(String(error.message ?? ""))) {
    const fallback = { ...patch };
    delete fallback.meal_personal_pass_email;
    delete fallback.meal_personal_pass_activated_at;
    const second = await run(fallback);
    error = second.error;
  }
  if (error) {
    if (isMissingMealPersonalPassColumn(error)) {
      console.error("meal personal pass columns missing; skip update");
      return;
    }
    throw new Error(error.message);
  }
}

export async function findMemberIdForMealPersonalPass(params: {
  supabase: ReturnType<typeof createSupabaseServiceClient>;
  email?: string;
  memberId?: string;
  customerId?: string;
  subscriptionId?: string;
}): Promise<string | null> {
  const memberId = String(params.memberId ?? "");
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(memberId)) {
    const { data } = await params.supabase.from("members").select("id").eq("id", memberId).maybeSingle();
    if (data?.id) return String(data.id);
  }
  const tryCol = async (column: string, value: string) => {
    if (!value) return null;
    const q = await (params.supabase as any).from("members").select("id").eq(column, value).limit(1).maybeSingle();
    if (q.error && isMissingMealPersonalPassColumn(q.error)) return null;
    return q.data?.id ? String(q.data.id) : null;
  };
  const byCustomer = await tryCol("meal_personal_stripe_customer_id", params.customerId ?? "");
  if (byCustomer) return byCustomer;
  const bySub = await tryCol("meal_personal_stripe_subscription_id", params.subscriptionId ?? "");
  if (bySub) return bySub;
  const email = String(params.email ?? "").trim();
  if (email) {
    const { data: rows } = await params.supabase.from("members").select("id, is_active, store_id").ilike("email", email).limit(10);
    const member = pickActiveMember((rows ?? []) as Array<{ id: string; is_active: boolean | null; store_id?: string | null }>);
    if (member?.id) return String(member.id);
  }
  return null;
}

export async function activateMealPersonalPassFromCheckoutSession(session: {
  id?: string;
  mode?: string;
  payment_status?: string;
  status?: string;
  client_reference_id?: string;
  customer?: unknown;
  subscription?: unknown;
  customer_details?: { email?: string };
  customer_email?: string;
  metadata?: { member_id?: string; member_code?: string; product?: string };
}): Promise<{ memberId: string; email: string }> {
  if (String(session.mode ?? "") !== "subscription") {
    throw Object.assign(new Error("サブスク決済ではありません"), { status: 400 });
  }
  const paid = String(session.payment_status ?? "") === "paid" || String(session.status ?? "") === "complete";
  if (!paid) {
    throw Object.assign(new Error("決済が完了していません"), { status: 400 });
  }
  const subscriptionId = customerIdOf(session.subscription);
  const customerId = customerIdOf(session.customer);
  const email = String(session.customer_details?.email ?? session.customer_email ?? "").trim();
  const sub = await loadSubscription(subscriptionId);
  if (!isMealPersonalStripeObject(session, sub)) {
    throw Object.assign(new Error("対象外の決済です"), { status: 400 });
  }
  const supabase = createSupabaseServiceClient();
  const intendedMemberId = String(session.client_reference_id ?? session.metadata?.member_id ?? "");
  const memberId = await findMemberIdForMealPersonalPass({
    supabase,
    email,
    memberId: intendedMemberId,
    customerId,
    subscriptionId,
  });
  if (!memberId) {
    await recordMealPersonalPassEvent({
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
  await applyMealPersonalPassToMember({
    supabase,
    memberId,
    status: String(sub?.status ?? "active"),
    customerId,
    subscriptionId,
    periodEndIso: unixSecondsToIso(sub?.current_period_end),
    stripeEmail: email || undefined,
    setActivatedAt: true,
  });
  const { data: member } = await supabase.from("members").select("member_code").eq("id", memberId).maybeSingle();
  await recordMealPersonalPassEvent({
    supabase,
    eventType: "checkout_completed",
    memberId,
    memberCode: member?.member_code ?? session.metadata?.member_code ?? null,
    stripeEmail: email,
    customerId,
    subscriptionId,
    sessionId: String(session.id ?? ""),
    status: String(sub?.status ?? "active"),
  });
  return { memberId, email };
}
