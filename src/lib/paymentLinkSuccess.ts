import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { recordMembershipPaymentPaid } from "@/lib/membershipPayments";
import { pushPaymentLinkNotice } from "@/lib/paymentLinkNotify";
import { formatYen, matchPaymentLinkUrl, type PaymentLinkItem } from "@/lib/paymentLinks";
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
  subscription?: string | { id?: string; current_period_start?: number; current_period_end?: number } | null;
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
}> {
  const embedded = session.subscription;
  const subscriptionId = subscriptionIdOf(session);
  let start = embedded && typeof embedded === "object" ? embedded.current_period_start : undefined;
  let end = embedded && typeof embedded === "object" ? embedded.current_period_end : undefined;
  if (subscriptionId && (start == null || end == null)) {
    const loaded = await loadSubscription(subscriptionId);
    const item = loaded?.items?.data?.[0];
    start = start ?? loaded?.current_period_start ?? item?.current_period_start;
    end = end ?? loaded?.current_period_end ?? item?.current_period_end;
  }
  return {
    subscriptionId,
    periodStart: unixSecondsToIso(start),
    periodEnd: unixSecondsToIso(end),
  };
}

export async function importRecentMembershipCheckouts(supabase: SupabaseClient<Database>): Promise<number> {
  const since = Math.floor(Date.now() / 1000) - 45 * 24 * 60 * 60;
  const query = new URLSearchParams({
    limit: "100",
    status: "complete",
    "created[gte]": String(since),
  });
  query.append("expand[]", "data.payment_link");
  let sessions: CheckoutSession[] = [];
  try {
    const list = await stripeGet(`/checkout/sessions?${query.toString()}`);
    sessions = (list?.data ?? []) as CheckoutSession[];
  } catch (error) {
    console.error("membership checkout import", error instanceof Error ? error.message : error);
    return 0;
  }

  const linkUrls = new Map<string, string>();
  let saved = 0;
  for (const session of sessions) {
    try {
      const matched = matchPaymentLinkUrl(await paymentLinkUrlFor(session, linkUrls));
      if (!matched || !checkoutPaid(session) || !session.id) continue;
      const email = String(session.customer_details?.email ?? session.customer_email ?? "").trim();
      const payerName = String(session.customer_details?.name ?? "").trim();
      const members = await findMembersByEmail(supabase, email);
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
      });
      if (ok) saved += 1;
    } catch (error) {
      console.error("membership checkout import row", error instanceof Error ? error.message : error);
    }
  }
  return saved;
}
