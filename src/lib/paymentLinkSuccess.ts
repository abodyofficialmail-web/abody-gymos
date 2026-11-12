import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { identifyPlanByAmount, recordMembershipPaymentPaid } from "@/lib/membershipPayments";
import { pushPaymentLinkNotice } from "@/lib/paymentLinkNotify";
import { allPaymentLinks, formatYen, matchPaymentLinkUrl, type PaymentLinkItem } from "@/lib/paymentLinks";
import { loadSubscription, stripeGet } from "@/lib/stripeTrainerPass";
import { unixSecondsToIso } from "@/lib/stripeWebhook";

type CheckoutSession = {
  id?: string;
  payment_status?: string;
  status?: string;
  amount_total?: number | null;
  currency?: string | null;
  customer_email?: string | null;
  customer_details?: { email?: string | null; name?: string | null } | null;
  payment_link?: string | { id?: string; url?: string } | null;
  created?: number;
  payment_intent?: string | { id?: string } | null;
  subscription?:
    | string
    | {
        id?: string;
        status?: string;
        cancel_at_period_end?: boolean;
        current_period_start?: number;
        current_period_end?: number;
      }
    | null;
};

export type PaymentSuccessReportInput = {
  planName: string;
  priceYen: number;
  cardLabel: "通常" | "アメックス";
  amountPaidYen: number | null;
  payerName: string;
  email: string;
  memberLabel: string;
  storeName: string | null;
};

export function buildPaymentSuccessReport(input: PaymentSuccessReportInput): string {
  const lines = [
    "【決済成功】",
    `プラン: ${input.planName}`,
    `カード: ${input.cardLabel}`,
    `金額: ${formatYen(input.priceYen)}`,
  ];
  if (input.amountPaidYen != null && input.amountPaidYen !== input.priceYen) {
    lines.push(`支払額: ${formatYen(input.amountPaidYen)}`);
  }
  if (input.payerName) lines.push(`支払者: ${input.payerName}`);
  if (input.email) lines.push(`メール: ${input.email}`);
  lines.push(`会員: ${input.memberLabel}`);
  if (input.storeName) lines.push(`店舗: ${input.storeName}`);
  lines.push("", "前のカードでの支払いは止めてください。");
  return lines.join("\n");
}

function checkoutPaid(session: CheckoutSession): boolean {
  const paymentStatus = String(session.payment_status ?? "");
  return paymentStatus === "paid" || paymentStatus === "no_payment_required";
}

function paymentLinkIdOf(session: CheckoutSession): string {
  const link = session.payment_link;
  if (typeof link === "string") return link;
  return String(link?.id ?? "");
}

function paymentLinkUrlOf(session: CheckoutSession): string {
  const link = session.payment_link;
  if (link && typeof link === "object") return String(link.url ?? "");
  return "";
}

export async function resolveMembershipPaymentLink(
  session: CheckoutSession
): Promise<{ item: PaymentLinkItem; card: "standard" | "amex" } | null> {
  const direct = matchPaymentLinkUrl(paymentLinkUrlOf(session));
  if (direct) return direct;
  const id = paymentLinkIdOf(session);
  if (!id) return null;
  const link = await stripeGet(`/payment_links/${encodeURIComponent(id)}`);
  return matchPaymentLinkUrl(String(link?.url ?? ""));
}

function escapeIlike(value: string): string {
  return value.replace(/[%_\\]/g, "\\$&");
}

async function findMembersByEmail(supabase: SupabaseClient<Database>, email: string) {
  if (!email) return [];
  const { data, error } = await supabase
    .from("members")
    .select("id, member_code, name, store_id")
    .ilike("email", escapeIlike(email))
    .limit(5);
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function reportMembershipPaymentLinkCheckout(
  supabase: SupabaseClient<Database>,
  session: CheckoutSession
): Promise<"not_ours" | "unpaid" | "reported"> {
  const matched = await resolveMembershipPaymentLink(session);
  if (!matched) return "not_ours";
  if (!checkoutPaid(session)) return "unpaid";

  const email = String(session.customer_details?.email ?? session.customer_email ?? "").trim();
  const payerName = String(session.customer_details?.name ?? "").trim();
  const members = await findMembersByEmail(supabase, email);
  const member = members.length === 1 ? members[0] : null;
  let storeName: string | null = null;
  if (member?.store_id) {
    const { data: store } = await supabase.from("stores").select("name").eq("id", member.store_id).maybeSingle();
    storeName = store?.name ?? null;
  }

  const memberLabel =
    members.length === 1
      ? `${String(member?.name ?? "").trim() || "会員"}（${member?.member_code}）`
      : members.length > 1
        ? `${members.map((row) => row.member_code).join("、")}（同じメールが複数あります）`
        : "メールアドレスでは見つかりませんでした";

  const amount = typeof session.amount_total === "number" ? session.amount_total : null;
  const period = await subscriptionPeriod(session);
  await recordMembershipPaymentPaid(supabase, {
    sessionId: String(session.id ?? ""),
    memberId: member?.id ?? null,
    memberCode: member?.member_code ?? null,
    memberName: members.length === 1 ? (member?.name ?? payerName) || null : payerName || null,
    email,
    storeName,
    item: matched.item,
    card: matched.card,
    amountYen: amount,
    occurredAt: unixSecondsToIso(session.created),
    periodStart: period.periodStart,
    periodEnd: period.periodEnd,
    subscriptionId: period.subscriptionId,
    stopped: period.stopped,
  });
  const text = buildPaymentSuccessReport({
    planName: matched.item.name,
    priceYen: matched.item.priceYen,
    cardLabel: matched.card === "amex" ? "アメックス" : "通常",
    amountPaidYen: amount,
    payerName,
    email,
    memberLabel,
    storeName,
  });
  const notify = await pushPaymentLinkNotice(supabase, text);
  if (notify.sent.length === 0) {
    throw new Error("決済成功の通知を送れませんでした");
  }
  return "reported";
}

async function paymentLinkUrlFor(session: CheckoutSession, cache: Map<string, string>): Promise<string> {
  const direct = paymentLinkUrlOf(session);
  if (direct) return direct;
  const id = paymentLinkIdOf(session);
  if (!id) return "";
  const cached = cache.get(id);
  if (cached != null) return cached;
  const link = await stripeGet(`/payment_links/${encodeURIComponent(id)}`);
  const url = String(link?.url ?? "");
  cache.set(id, url);
  return url;
}

function subscriptionIdOf(session: CheckoutSession): string {
  const subscription = session.subscription;
  if (typeof subscription === "string") return subscription;
  return String(subscription?.id ?? "");
}

async function subscriptionPeriod(session: CheckoutSession): Promise<{
  subscriptionId: string;
  periodStart: string | null;
  periodEnd: string | null;
  stopped: boolean;
}> {
  const embedded = session.subscription;
  const subscriptionId = subscriptionIdOf(session);
  let start = embedded && typeof embedded === "object" ? embedded.current_period_start : undefined;
  let end = embedded && typeof embedded === "object" ? embedded.current_period_end : undefined;
  const knowsStop = Boolean(embedded && typeof embedded === "object" && "cancel_at_period_end" in embedded);
  let stopped = Boolean(
    embedded &&
      typeof embedded === "object" &&
      (embedded.cancel_at_period_end || embedded.status === "canceled")
  );
  if (subscriptionId && (start == null || end == null || !knowsStop)) {
    const loaded = await loadSubscription(subscriptionId);
    const item = loaded?.items?.data?.[0];
    start = start ?? loaded?.current_period_start ?? item?.current_period_start;
    end = end ?? loaded?.current_period_end ?? item?.current_period_end;
    stopped =
      stopped || Boolean(loaded?.cancel_at_period_end) || loaded?.status === "canceled" || loaded?.status === "incomplete_expired";
  }
  return {
    subscriptionId,
    periodStart: unixSecondsToIso(start),
    periodEnd: unixSecondsToIso(end),
    stopped,
  };
}

async function collectKnownPaymentSessions(since: number): Promise<CheckoutSession[]> {
  const found = new Map<string, CheckoutSession>();
  let startingAfter = "";
  for (let page = 0; page < 4; page += 1) {
    const query = new URLSearchParams({ limit: "100" });
    if (startingAfter) query.set("starting_after", startingAfter);
    const list = await stripeGet(`/payment_links?${query.toString()}`);
    const links = (list?.data ?? []) as Array<{ id?: string; url?: string }>;
    for (const link of links) {
      const url = String(link.url ?? "");
      const id = String(link.id ?? "");
      if (!id || !matchPaymentLinkUrl(url)) continue;
      try {
        const sessions = new URLSearchParams({
          limit: "100",
          payment_link: id,
          "created[gte]": String(since),
        });
        sessions.append("expand[]", "data.subscription");
        let pageSessions: { data?: CheckoutSession[] };
        try {
          pageSessions = await stripeGet(`/checkout/sessions?${sessions.toString()}`);
        } catch {
          sessions.delete("expand[]");
          pageSessions = await stripeGet(`/checkout/sessions?${sessions.toString()}`);
        }
        for (const session of (pageSessions?.data ?? []) as CheckoutSession[]) {
          if (!session.id) continue;
          if (typeof session.payment_link === "string" || !session.payment_link) {
            session.payment_link = { id, url };
          }
          found.set(session.id, session);
        }
      } catch (error) {
        console.error("membership payment link sessions", error instanceof Error ? error.message : error);
      }
    }
    if (!list?.has_more || links.length === 0) break;
    startingAfter = String(links[links.length - 1]?.id ?? "");
    if (!startingAfter) break;
  }
  return [...found.values()];
}

async function collectGuidedCustomerSessions(
  supabase: SupabaseClient<Database>,
  sinceIso: string
): Promise<CheckoutSession[]> {
  const db = supabase as unknown as SupabaseClient;
  const guided = await db
    .from("membership_payment_records")
    .select("email")
    .eq("status", "guided")
    .gte("occurred_at", sinceIso)
    .limit(40);
  if (guided.error) return [];
  const emails = [
    ...new Set(
      ((guided.data ?? []) as Array<{ email?: string | null }>)
        .map((row) => String(row.email ?? "").trim())
        .filter(Boolean)
    ),
  ];
  const found = new Map<string, CheckoutSession>();
  for (const email of emails) {
    const customers = await stripeGet(`/customers?email=${encodeURIComponent(email)}&limit=5`);
    for (const customer of (customers?.data ?? []) as Array<{ id?: string }>) {
      const customerId = String(customer.id ?? "");
      if (!customerId) continue;
      const sessions = await stripeGet(`/checkout/sessions?customer=${encodeURIComponent(customerId)}&limit=20`);
      for (const session of (sessions?.data ?? []) as CheckoutSession[]) {
        if (session.id) found.set(session.id, session);
      }
    }
  }
  return [...found.values()];
}

async function collectRecentCheckoutSessions(since: number): Promise<CheckoutSession[]> {
  const query = new URLSearchParams({
    limit: "100",
    status: "complete",
    "created[gte]": String(since),
  });
  query.append("expand[]", "data.payment_link");
  try {
    const list = await stripeGet(`/checkout/sessions?${query.toString()}`);
    return (list?.data ?? []) as CheckoutSession[];
  } catch (error) {
    console.error("membership recent sessions", error instanceof Error ? error.message : error);
    const plain = new URLSearchParams({
      limit: "100",
      status: "complete",
      "created[gte]": String(since),
    });
    const list = await stripeGet(`/checkout/sessions?${plain.toString()}`);
    return (list?.data ?? []) as CheckoutSession[];
  }
}

function stripeIdOf(value: unknown): string {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "id" in value) return String((value as { id?: string }).id ?? "");
  return "";
}

async function importRecentMembershipCharges(
  supabase: SupabaseClient<Database>,
  knownPaymentIntents: Set<string>
): Promise<{ saved: number; amounts: number[] }> {
  const since = Math.floor(Date.now() / 1000) - 5 * 24 * 60 * 60;
  const charges: Array<Record<string, unknown>> = [];
  let startingAfter = "";
  for (let page = 0; page < 3; page += 1) {
    const query = new URLSearchParams({ limit: "100", "created[gte]": String(since) });
    if (startingAfter) query.set("starting_after", startingAfter);
    query.append("expand[]", "data.customer");
    query.append("expand[]", "data.invoice");
    let list: { data?: Array<Record<string, unknown>>; has_more?: boolean };
    try {
      list = await stripeGet(`/charges?${query.toString()}`);
    } catch (error) {
      console.error("membership charge import", error instanceof Error ? error.message : error);
      if (page > 0) break;
      try {
        const plain = new URLSearchParams({ limit: "100", "created[gte]": String(since) });
        if (startingAfter) plain.set("starting_after", startingAfter);
        list = await stripeGet(`/charges?${plain.toString()}`);
      } catch (retryError) {
        console.error("membership charge import", retryError instanceof Error ? retryError.message : retryError);
        return { saved: 0, amounts: [] };
      }
    }
    const rows = list?.data ?? [];
    charges.push(...rows);
    if (!list?.has_more || rows.length === 0) break;
    startingAfter = String(rows[rows.length - 1]?.id ?? "");
    if (!startingAfter) break;
  }

  let saved = 0;
  const amounts = charges.map((charge) => (typeof charge.amount === "number" ? charge.amount : 0));
  for (const charge of charges) {
    try {
      const paid = charge.paid === true || charge.status === "succeeded";
      const amount = typeof charge.amount === "number" ? charge.amount : null;
      if (!paid || amount == null) continue;
      const paymentIntentId = stripeIdOf(charge.payment_intent);
      if (paymentIntentId && knownPaymentIntents.has(paymentIntentId)) continue;
      const plan = identifyPlanByAmount(amount);
      if (!plan?.planId) continue;
      const item = allPaymentLinks().find((row) => row.id === plan.planId);
      if (!item) continue;
      const billing = (charge.billing_details ?? {}) as { email?: string | null; name?: string | null };
      const customer = charge.customer;
      const customerObj = customer && typeof customer === "object" ? (customer as { email?: string | null; name?: string | null }) : null;
      let email = String(charge.receipt_email ?? billing.email ?? customerObj?.email ?? "").trim();
      const payerName = String(billing.name ?? customerObj?.name ?? "").trim();
      if (!email && typeof customer === "string") {
        const loaded = await stripeGet(`/customers/${encodeURIComponent(customer)}`);
        email = String(loaded?.email ?? "").trim();
      }
      const membersByEmail = await findMembersByEmail(supabase, email);
      const members =
        membersByEmail.length === 1
          ? membersByEmail
          : payerName
            ? await findMembersByName(supabase, payerName)
            : [];
      const member = members.length === 1 ? members[0] : null;
      if (!member && !email) continue;
      const invoice = charge.invoice;
      const invoiceObj = invoice && typeof invoice === "object" ? (invoice as Record<string, unknown>) : null;
      let periodStart: number | undefined;
      let periodEnd: number | undefined;
      let subscriptionId = stripeIdOf(invoiceObj?.subscription);
      const line = ((invoiceObj?.lines as { data?: Array<{ period?: { start?: number; end?: number } }> } | undefined)?.data ?? [])[0];
      periodStart = line?.period?.start;
      periodEnd = line?.period?.end;
      if ((!periodStart || !periodEnd || !subscriptionId) && typeof invoice === "string") {
        const loaded = await stripeGet(`/invoices/${encodeURIComponent(invoice)}`);
        subscriptionId = subscriptionId || stripeIdOf(loaded?.subscription);
        const loadedLine = loaded?.lines?.data?.[0];
        periodStart = periodStart ?? loadedLine?.period?.start;
        periodEnd = periodEnd ?? loadedLine?.period?.end;
      }
      let storeName: string | null = null;
      if (member?.store_id) {
        const { data: store } = await supabase.from("stores").select("name").eq("id", member.store_id).maybeSingle();
        storeName = store?.name ?? null;
      }
      const sessionId = paymentIntentId || `ch_${String(charge.id ?? "")}`;
      if (!sessionId || sessionId === "ch_") continue;
      const namedItem = plan.planName === item.name ? item : { ...item, name: plan.planName };
      const ok = await recordMembershipPaymentPaid(supabase, {
        sessionId,
        memberId: member?.id ?? null,
        memberCode: member?.member_code ?? null,
        memberName: member ? (member.name ?? payerName) || null : payerName || null,
        email,
        storeName,
        item: namedItem,
        card: "standard",
        amountYen: amount,
        occurredAt: unixSecondsToIso(charge.created),
        periodStart: unixSecondsToIso(periodStart),
        periodEnd: unixSecondsToIso(periodEnd),
        subscriptionId,
      });
      if (ok) saved += 1;
    } catch (error) {
      console.error("membership charge row", error instanceof Error ? error.message : error);
    }
  }
  return { saved, amounts };
}

async function findMembersByName(supabase: SupabaseClient<Database>, name: string) {
  const query = name.replace(/\s+/g, "").trim();
  if (query.length < 2) return [];
  const { data, error } = await supabase
    .from("members")
    .select("id, member_code, name, store_id")
    .ilike("name", `%${escapeIlike(query)}%`)
    .limit(5);
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function importRecentMembershipCheckouts(
  supabase: SupabaseClient<Database>
): Promise<{ saved: number; chargeAmounts: number[] }> {
  const since = Math.floor(Date.now() / 1000) - 45 * 24 * 60 * 60;
  const recentSince = Math.floor(Date.now() / 1000) - 7 * 24 * 60 * 60;
  const sinceIso = new Date(since * 1000).toISOString();
  const byId = new Map<string, CheckoutSession>();
  try {
    for (const session of await collectKnownPaymentSessions(since)) {
      if (session.id) byId.set(session.id, session);
    }
  } catch (error) {
    console.error("membership checkout import", error instanceof Error ? error.message : error);
  }
  try {
    for (const session of await collectRecentCheckoutSessions(recentSince)) {
      if (session.id) byId.set(session.id, session);
    }
  } catch (error) {
    console.error("membership recent checkout import", error instanceof Error ? error.message : error);
  }
  try {
    for (const session of await collectGuidedCustomerSessions(supabase, sinceIso)) {
      if (session.id) byId.set(session.id, session);
    }
  } catch (error) {
    console.error("membership customer import", error instanceof Error ? error.message : error);
  }
  const sessions = [...byId.values()];

  const linkUrls = new Map<string, string>();
  const paymentIntents = new Set<string>();
  let saved = 0;
  for (const session of sessions) {
    try {
      let matched = matchPaymentLinkUrl(await paymentLinkUrlFor(session, linkUrls));
      if (!matched && typeof session.amount_total === "number") {
        const plan = identifyPlanByAmount(session.amount_total);
        const item = plan?.planId ? allPaymentLinks().find((row) => row.id === plan.planId) : null;
        if (item && plan) {
          const payerEmail = String(session.customer_details?.email ?? session.customer_email ?? "").trim();
          const payer = String(session.customer_details?.name ?? "").trim();
          const byEmail = await findMembersByEmail(supabase, payerEmail);
          const byName = byEmail.length === 1 || !payer ? [] : await findMembersByName(supabase, payer);
          if ((byEmail.length === 1 || byName.length === 1) && checkoutPaid(session)) {
            matched = { item: plan.planName === item.name ? item : { ...item, name: plan.planName }, card: "standard" };
          }
        }
      }
      if (!matched || !checkoutPaid(session) || !session.id) continue;
      const paymentIntentId = stripeIdOf(session.payment_intent);
      if (paymentIntentId) paymentIntents.add(paymentIntentId);
      const email = String(session.customer_details?.email ?? session.customer_email ?? "").trim();
      const payerName = String(session.customer_details?.name ?? "").trim();
      const byEmail = await findMembersByEmail(supabase, email);
      const byName = byEmail.length === 1 || !payerName ? [] : await findMembersByName(supabase, payerName);
      const members = byEmail.length === 1 ? byEmail : byName;
      const member = members.length === 1 ? members[0] : null;
      let storeName: string | null = null;
      if (member?.store_id) {
        const { data: store } = await supabase.from("stores").select("name").eq("id", member.store_id).maybeSingle();
        storeName = store?.name ?? null;
      }
      const period = await subscriptionPeriod(session);
      const ok = await recordMembershipPaymentPaid(supabase, {
        sessionId: session.id,
        memberId: member?.id ?? null,
        memberCode: member?.member_code ?? null,
        memberName: members.length === 1 ? (member?.name ?? payerName) || null : payerName || null,
        email,
        storeName,
        item: matched.item,
        card: matched.card,
        amountYen: typeof session.amount_total === "number" ? session.amount_total : null,
        occurredAt: unixSecondsToIso(session.created),
        periodStart: period.periodStart,
        periodEnd: period.periodEnd,
        subscriptionId: period.subscriptionId,
        stopped: period.stopped,
      });
      if (ok) saved += 1;
    } catch (error) {
      console.error("membership checkout import row", error instanceof Error ? error.message : error);
    }
  }
  let chargeAmounts: number[] = [];
  try {
    const charges = await importRecentMembershipCharges(supabase, paymentIntents);
    saved += charges.saved;
    chargeAmounts = charges.amounts;
  } catch (error) {
    console.error("membership charge import", error instanceof Error ? error.message : error);
  }
  return { saved, chargeAmounts };
}
