import { createSupabaseServiceClient } from "@/lib/supabase/admin";
import { unixSecondsToIso, verifyStripeSignature } from "@/lib/stripeWebhook";
import {
  applyTrainerPassToMember,
  customerIdOf,
  findMemberIdForTrainerPass,
  loadSubscription,
  recordTrainerPassEvent,
  subscriptionMatchesProduct,
  type StripeSubscription,
} from "@/lib/stripeTrainerPass";
import {
  applyMealPersonalPassToMember,
  findMemberIdForMealPersonalPass,
  isMealPersonalStripeObject,
  recordMealPersonalPassEvent,
} from "@/lib/stripeMealPersonalPass";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function trainerPriceId(): string {
  return process.env.STRIPE_TRAINER_VISIBILITY_PRICE_ID?.trim() ?? "";
}

async function applyMealPass(params: {
  supabase: ReturnType<typeof createSupabaseServiceClient>;
  eventType: string;
  obj: any;
  sub: StripeSubscription | null;
  subscriptionId: string;
  customerId: string;
  email: string;
  memberIdHint: string;
  sessionId?: string;
  status: string;
  setActivatedAt?: boolean;
}) {
  const memberId = await findMemberIdForMealPersonalPass({
    supabase: params.supabase,
    email: params.email,
    memberId: params.memberIdHint,
    customerId: params.customerId,
    subscriptionId: params.subscriptionId,
  });
  if (!memberId) {
    await recordMealPersonalPassEvent({
      supabase: params.supabase,
      eventType: params.eventType === "checkout.session.completed" ? "unmatched_checkout" : params.eventType,
      stripeEmail: params.email,
      customerId: params.customerId,
      subscriptionId: params.subscriptionId,
      sessionId: params.sessionId,
      status: "unmatched",
      detail: { client_reference_id: params.memberIdHint },
    });
    return json({ received: true, product: "meal_personal", ignored: "member_not_found" });
  }
  await applyMealPersonalPassToMember({
    supabase: params.supabase,
    memberId,
    status: params.status,
    customerId: params.customerId,
    subscriptionId: params.subscriptionId,
    periodEndIso: unixSecondsToIso(params.sub?.current_period_end),
    stripeEmail: params.email || undefined,
    setActivatedAt: params.setActivatedAt,
  });
  const { data: member } = await params.supabase.from("members").select("member_code").eq("id", memberId).maybeSingle();
  await recordMealPersonalPassEvent({
    supabase: params.supabase,
    eventType: params.eventType === "checkout.session.completed" ? "checkout_completed" : params.eventType,
    memberId,
    memberCode: member?.member_code ?? params.obj?.metadata?.member_code ?? null,
    stripeEmail: params.email,
    customerId: params.customerId,
    subscriptionId: params.subscriptionId,
    sessionId: params.sessionId,
    status: params.status,
  });
  return json({ received: true, product: "meal_personal", member_id: memberId, member_code: member?.member_code ?? null });
}

export async function POST(request: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET?.trim();
  if (!secret) return json({ error: "STRIPE_WEBHOOK_SECRET が未設定です" }, 500);

  const raw = await request.text();
  const signature = request.headers.get("stripe-signature");
  if (!verifyStripeSignature(raw, signature, secret)) {
    return json({ error: "invalid signature" }, 400);
  }

  let event: { type?: string; data?: { object?: any } };
  try {
    event = JSON.parse(raw);
  } catch {
    return json({ error: "invalid json" }, 400);
  }

  const type = String(event.type ?? "");
  const obj = event.data?.object ?? {};

  try {
    const supabase = createSupabaseServiceClient();

    if (type === "checkout.session.completed") {
      if (String(obj.mode ?? "") !== "subscription") return json({ received: true, ignored: "not_subscription" });
      const subscriptionId = customerIdOf(obj.subscription);
      const customerId = customerIdOf(obj.customer);
      const email = String(obj.customer_details?.email ?? obj.customer_email ?? "");
      const sub = await loadSubscription(subscriptionId);
      if (isMealPersonalStripeObject(obj, sub)) {
        return applyMealPass({
          supabase,
          eventType: type,
          obj,
          sub,
          subscriptionId,
          customerId,
          email,
          memberIdHint: String(obj.client_reference_id ?? obj.metadata?.member_id ?? ""),
          sessionId: String(obj.id ?? ""),
          status: String(sub?.status ?? "active"),
          setActivatedAt: true,
        });
      }
      if (!subscriptionMatchesProduct(sub)) return json({ received: true, ignored: "other_product" });

      const intendedMemberId = String(obj.client_reference_id ?? obj.metadata?.member_id ?? "");
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
          sessionId: String(obj.id ?? ""),
          status: "unmatched",
          detail: { client_reference_id: intendedMemberId },
        });
        console.error("stripe checkout: member not found", { email, intendedMemberId });
        return json({ received: true, ignored: "member_not_found" });
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
      const { data: member } = await supabase.from("members").select("member_code").eq("id", memberId).maybeSingle();
      await recordTrainerPassEvent({
        supabase,
        eventType: "checkout_completed",
        memberId,
        memberCode: member?.member_code ?? obj.metadata?.member_code ?? null,
        stripeEmail: email,
        customerId,
        subscriptionId,
        sessionId: String(obj.id ?? ""),
        status: String(sub?.status ?? "active"),
      });
      return json({ received: true, member_id: memberId, member_code: member?.member_code ?? null });
    }

    if (type === "customer.subscription.updated" || type === "customer.subscription.deleted") {
      const sub = obj as StripeSubscription;
      const expanded = sub.items?.data?.length ? sub : await loadSubscription(String(sub.id ?? ""));
      const subscriptionId = String(sub.id ?? "");
      const customerId = customerIdOf(sub.customer);
      if (isMealPersonalStripeObject(obj, expanded)) {
        const status = type === "customer.subscription.deleted" ? "canceled" : String(sub.status ?? "inactive");
        return applyMealPass({
          supabase,
          eventType: type,
          obj,
          sub: expanded,
          subscriptionId,
          customerId,
          email: "",
          memberIdHint: String((sub as { metadata?: { member_id?: string } }).metadata?.member_id ?? ""),
          status,
        });
      }
      if (!subscriptionMatchesProduct(expanded) && trainerPriceId()) {
        return json({ received: true, ignored: "other_product" });
      }
      const memberId = await findMemberIdForTrainerPass({
        supabase,
        customerId,
        subscriptionId,
        memberId: String((sub as any)?.metadata?.member_id ?? ""),
      });
      if (!memberId) {
        await recordTrainerPassEvent({
          supabase,
          eventType: type,
          customerId,
          subscriptionId,
          status: "unmatched",
        });
        return json({ received: true, ignored: "member_not_found" });
      }
      const status = type === "customer.subscription.deleted" ? "canceled" : String(sub.status ?? "inactive");
      await applyTrainerPassToMember({
        supabase,
        memberId,
        status,
        customerId,
        subscriptionId,
        periodEndIso: unixSecondsToIso(sub.current_period_end),
      });
      const { data: member } = await supabase.from("members").select("member_code").eq("id", memberId).maybeSingle();
      await recordTrainerPassEvent({
        supabase,
        eventType: type,
        memberId,
        memberCode: member?.member_code ?? null,
        customerId,
        subscriptionId,
        status,
      });
      return json({ received: true, member_id: memberId });
    }

    if (type === "invoice.paid" || type === "invoice.payment_failed") {
      const subscriptionId = customerIdOf(obj.subscription);
      const customerId = customerIdOf(obj.customer);
      const email = String(obj.customer_email ?? obj.customer_details?.email ?? "");
      if (!subscriptionId) return json({ received: true, ignored: "no_subscription" });
      const sub = await loadSubscription(subscriptionId);
      if (isMealPersonalStripeObject(obj, sub)) {
        return applyMealPass({
          supabase,
          eventType: type,
          obj,
          sub,
          subscriptionId,
          customerId,
          email,
          memberIdHint: String(sub?.metadata?.member_id ?? obj.subscription_details?.metadata?.member_id ?? ""),
          status: String(sub?.status ?? (type === "invoice.paid" ? "active" : "past_due")),
          setActivatedAt: type === "invoice.paid",
        });
      }
      if (!subscriptionMatchesProduct(sub)) return json({ received: true, ignored: "other_product" });
      const memberId = await findMemberIdForTrainerPass({
        supabase,
        customerId,
        subscriptionId,
        email,
        memberId: String(sub?.metadata?.member_id ?? obj.subscription_details?.metadata?.member_id ?? ""),
      });
      if (!memberId) {
        await recordTrainerPassEvent({
          supabase,
          eventType: type,
          stripeEmail: email,
          customerId,
          subscriptionId,
          status: "unmatched",
        });
        return json({ received: true, ignored: "member_not_found" });
      }
      await applyTrainerPassToMember({
        supabase,
        memberId,
        status: String(sub?.status ?? (type === "invoice.paid" ? "active" : "past_due")),
        customerId,
        subscriptionId,
        periodEndIso: unixSecondsToIso(sub?.current_period_end),
        stripeEmail: email || undefined,
        setActivatedAt: type === "invoice.paid",
      });
      const { data: member } = await supabase.from("members").select("member_code").eq("id", memberId).maybeSingle();
      await recordTrainerPassEvent({
        supabase,
        eventType: type,
        memberId,
        memberCode: member?.member_code ?? null,
        stripeEmail: email,
        customerId,
        subscriptionId,
        status: String(sub?.status ?? ""),
      });
      return json({ received: true, member_id: memberId });
    }

    return json({ received: true, ignored: type });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("stripe webhook error", message);
    return json({ error: message }, 500);
  }
}
