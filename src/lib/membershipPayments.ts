import type { SupabaseClient } from "@supabase/supabase-js";
import { DateTime } from "luxon";
import type { Database } from "@/types/database";
import { pushPaymentLinkNotice } from "@/lib/paymentLinkNotify";
import { allPaymentLinks, formatYen, type PaymentLinkItem } from "@/lib/paymentLinks";
import { stripePost } from "@/lib/stripeTrainerPass";

export type MembershipPaymentStatus = "guided" | "paid" | "failed";

export type MembershipPaymentRecord = {
  id: string;
  member_code: string | null;
  member_name: string | null;
  email: string | null;
  store_name: string | null;
  plan_id: string | null;
  plan_name: string;
  price_yen: number | null;
  amount_yen: number | null;
  card_kind: string | null;
  status: MembershipPaymentStatus;
  reason: string | null;
  occurred_at: string;
  period_start: string | null;
  period_end: string | null;
  stripe_subscription_id: string | null;
  stopped_at: string | null;
};

export type MembershipPaymentSnapshot = {
  monthLabel: string;
  salesYen: number;
  monthCounts: Record<MembershipPaymentStatus, number>;
  records: MembershipPaymentRecord[];
};

type LedgerError = { message?: string; code?: string };

export class MembershipLedgerError extends Error {
  constructor(
    message: string,
    readonly unavailable: boolean
  ) {
    super(message);
  }
}

type LedgerRow = {
  id: string;
  member_id?: string | null;
  member_code: string | null;
  member_name: string | null;
  email: string | null;
  store_name: string | null;
  plan_id: string | null;
  plan_name: string;
  price_yen: number | null;
  amount_yen: number | null;
  card_kind: string | null;
  status: string;
  reason: string | null;
  occurred_at: string;
  period_start?: string | null;
  period_end?: string | null;
  stripe_subscription_id?: string | null;
  stopped_at?: string | null;
};

type MemberMatch = {
  id: string;
  member_code: string | null;
  name: string | null;
  store_id: string | null;
};

function ledger(supabase: SupabaseClient<Database>) {
  return supabase as unknown as SupabaseClient;
}

function asLedgerError(error: LedgerError): MembershipLedgerError {
  const message = String(error.message ?? "決済記録に失敗しました");
  const unavailable =
    error.code === "PGRST205" ||
    error.code === "42P01" ||
    /membership_payment_records|schema cache/i.test(message);
  return new MembershipLedgerError(message, unavailable);
}

const PERIOD_COLUMNS = ["period_start", "period_end", "stripe_subscription_id", "stopped_at"] as const;

function missingPeriodColumn(message: string): boolean {
  return PERIOD_COLUMNS.some((column) => message.includes(column));
}

function withoutPeriodColumns<T extends Record<string, unknown>>(row: T): T {
  const next = { ...row };
  for (const column of PERIOD_COLUMNS) delete next[column];
  return next;
}

function escapeIlike(value: string): string {
  return value.replace(/[%_\\]/g, "\\$&");
}

export function tokyoMonthRange(now = DateTime.now().setZone("Asia/Tokyo")) {
  const start = now.startOf("month");
  const end = start.plus({ months: 1 });
  return {
    startIso: start.toUTC().toISO() ?? "",
    endIso: end.toUTC().toISO() ?? "",
    label: start.toFormat("yyyy年M月"),
  };
}

export function sumPaidYen(
  rows: Array<{ status: string; amount_yen: number | null; price_yen: number | null }>
): number {
  return rows.reduce((sum, row) => {
    if (row.status !== "paid") return sum;
    return sum + (row.amount_yen ?? row.price_yen ?? 0);
  }, 0);
}

export function countPaymentStatuses(
  rows: Array<{ status: string }>
): Record<MembershipPaymentStatus, number> {
  const counts = { guided: 0, paid: 0, failed: 0 };
  for (const row of rows) {
    if (row.status === "guided" || row.status === "paid" || row.status === "failed") {
      counts[row.status] += 1;
    }
  }
  return counts;
}

export function identifyPlanByAmount(
  amountYen: number
): { planId: string | null; planName: string; priceYen: number } | null {
  if (!Number.isFinite(amountYen) || amountYen <= 0) return null;
  const links = allPaymentLinks();
  const exact = links.filter((item) => item.priceYen === amountYen);
  if (exact.length === 1) {
    return { planId: exact[0]!.id, planName: exact[0]!.name, priceYen: exact[0]!.priceYen };
  }
  if (exact.length > 1) {
    return { planId: null, planName: exact.map((item) => item.name).join(" / "), priceYen: amountYen };
  }
  const half = links.filter((item) => item.priceYen / 2 === amountYen);
  if (half.length === 1) {
    return { planId: half[0]!.id, planName: `${half[0]!.name}（半額）`, priceYen: half[0]!.priceYen };
  }
  if (half.length > 1) {
    return {
      planId: null,
      planName: `${half.map((item) => item.name).join(" / ")}（半額）`,
      priceYen: amountYen * 2,
    };
  }
  return null;
}

export function buildPaymentFailureReport(input: {
  planName: string;
  amountYen: number | null;
  email: string;
  memberLabel: string;
  storeName: string | null;
}): string {
  const lines = ["【決済失敗】", `プラン: ${input.planName}`];
  if (input.amountYen != null) lines.push(`金額: ${formatYen(input.amountYen)}`);
  if (input.email) lines.push(`メール: ${input.email}`);
  lines.push(`会員: ${input.memberLabel}`);
  if (input.storeName) lines.push(`店舗: ${input.storeName}`);
  lines.push("", "管理画面の決済リンクから、決済案内を送れます。");
  return lines.join("\n");
}

function toRecord(row: LedgerRow): MembershipPaymentRecord {
  const status: MembershipPaymentStatus =
    row.status === "paid" || row.status === "failed" || row.status === "guided" ? row.status : "guided";
  return {
    id: row.id,
    member_code: row.member_code,
    member_name: row.member_name,
    email: row.email,
    store_name: row.store_name,
    plan_id: row.plan_id,
    plan_name: row.plan_name,
    price_yen: row.price_yen,
    amount_yen: row.amount_yen,
    card_kind: row.card_kind,
    status,
    reason: row.reason,
    occurred_at: row.occurred_at,
    period_start: row.period_start ?? null,
    period_end: row.period_end ?? null,
    stripe_subscription_id: row.stripe_subscription_id ?? null,
    stopped_at: row.stopped_at ?? null,
  };
}

async function findMembersByEmail(supabase: SupabaseClient<Database>, email: string): Promise<MemberMatch[]> {
  if (!email) return [];
  const { data, error } = await supabase
    .from("members")
    .select("id, member_code, name, store_id")
    .ilike("email", escapeIlike(email))
    .limit(5);
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => ({
    id: row.id,
    member_code: row.member_code,
    name: row.name,
    store_id: row.store_id ?? null,
  }));
}

async function storeNameOf(supabase: SupabaseClient<Database>, storeId: string | null): Promise<string | null> {
  if (!storeId) return null;
  const { data } = await supabase.from("stores").select("name").eq("id", storeId).maybeSingle();
  return data?.name ?? null;
}

function memberLabelOf(members: MemberMatch[], payerName: string): string {
  if (members.length === 1) {
    const member = members[0]!;
    const name = String(member.name ?? "").trim() || payerName || "会員";
    return `${name}（${member.member_code}）`;
  }
  if (members.length > 1) {
    return `${members.map((row) => row.member_code).join("、")}（同じメールが複数あります）`;
  }
  return "メールアドレスでは見つかりませんでした";
}

export async function listMembershipPayments(
  supabase: SupabaseClient<Database>
): Promise<MembershipPaymentSnapshot> {
  const range = tokyoMonthRange();
  const db = ledger(supabase);
  const month = await db
    .from("membership_payment_records")
    .select("status, amount_yen, price_yen")
    .gte("occurred_at", range.startIso)
    .lt("occurred_at", range.endIso)
    .limit(1000);
  if (month.error) throw asLedgerError(month.error);

  const baseColumns =
    "id, member_code, member_name, email, store_name, plan_id, plan_name, price_yen, amount_yen, card_kind, status, reason, occurred_at";
  const withPeriod = await db
    .from("membership_payment_records")
    .select(`${baseColumns}, period_start, period_end, stripe_subscription_id, stopped_at`)
    .order("occurred_at", { ascending: false })
    .limit(100);
  const recent =
    withPeriod.error && missingPeriodColumn(String(withPeriod.error.message ?? ""))
      ? await db.from("membership_payment_records").select(baseColumns).order("occurred_at", { ascending: false }).limit(100)
      : withPeriod;
  if (recent.error) throw asLedgerError(recent.error);

  const monthRows = (month.data ?? []) as Array<{ status: string; amount_yen: number | null; price_yen: number | null }>;
  return {
    monthLabel: range.label,
    salesYen: sumPaidYen(monthRows),
    monthCounts: countPaymentStatuses(monthRows),
    records: ((recent.data ?? []) as LedgerRow[]).map(toRecord),
  };
}

export async function recordMembershipGuidance(
  supabase: SupabaseClient<Database>,
  input: {
    memberId: string;
    memberCode: string;
    memberName: string | null;
    email: string | null;
    storeName: string | null;
    planId: string;
    planName: string;
    priceYen: number;
    cardKind: "standard" | "amex";
    reason: string;
  }
): Promise<boolean> {
  const { error } = await ledger(supabase).from("membership_payment_records").insert({
    member_id: input.memberId,
    member_code: input.memberCode,
    member_name: input.memberName,
    email: input.email,
    store_name: input.storeName,
    plan_id: input.planId,
    plan_name: input.planName,
    price_yen: input.priceYen,
    amount_yen: null,
    card_kind: input.cardKind,
    status: "guided",
    reason: input.reason,
    occurred_at: new Date().toISOString(),
  });
  if (error) {
    console.error("membership guidance record", error.message);
    return false;
  }
  return true;
}

export async function recordMembershipPaymentPaid(
  supabase: SupabaseClient<Database>,
  input: {
    sessionId: string;
    memberId: string | null;
    memberCode: string | null;
    memberName: string | null;
    email: string;
    storeName: string | null;
    item: PaymentLinkItem;
    card: "standard" | "amex";
    amountYen: number | null;
    occurredAt?: string | null;
    periodStart?: string | null;
    periodEnd?: string | null;
    subscriptionId?: string | null;
    stopped?: boolean;
  }
): Promise<boolean> {
  if (!input.sessionId) return false;
  const row: Record<string, unknown> = {
    member_id: input.memberId,
    member_code: input.memberCode,
    member_name: input.memberName,
    email: input.email || null,
    store_name: input.storeName,
    plan_id: input.item.id,
    plan_name: input.item.name,
    price_yen: input.item.priceYen,
    amount_yen: input.amountYen,
    card_kind: input.card,
    status: "paid",
    stripe_session_id: input.sessionId,
    stripe_subscription_id: input.subscriptionId || null,
    period_start: input.periodStart ?? null,
    period_end: input.periodEnd ?? null,
    occurred_at: input.occurredAt || new Date().toISOString(),
  };
  if (input.stopped) {
    row.reason = "stopped";
    row.stopped_at = new Date().toISOString();
  }
  return upsertLedger(supabase, row, "stripe_session_id");
}

export async function stopMembershipRenewal(
  supabase: SupabaseClient<Database>,
  recordId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const id = recordId.trim();
  if (!id) return { ok: false, error: "決済が指定されていません" };
  const db = ledger(supabase);
  const found = await db
    .from("membership_payment_records")
    .select("id, status, stripe_subscription_id, reason, stopped_at")
    .eq("id", id)
    .maybeSingle();
  if (found.error) {
    if (missingPeriodColumn(String(found.error.message ?? ""))) {
      return { ok: false, error: "継続の番号をまだ保存できないため、ここから止められません" };
    }
    return { ok: false, error: "決済を読み取れませんでした" };
  }
  const row = found.data as {
    status?: string;
    stripe_subscription_id?: string | null;
    reason?: string | null;
    stopped_at?: string | null;
  } | null;
  if (!row) return { ok: false, error: "決済が見つかりません" };
  if (row.status !== "paid") return { ok: false, error: "成功した決済だけ止められます" };
  if (row.reason === "stopped" || row.stopped_at) return { ok: true };
  const subscriptionId = String(row.stripe_subscription_id ?? "").trim();
  if (!subscriptionId) return { ok: false, error: "この決済の継続番号が無いため、ここから止められません" };
  try {
    await stripePost(`/subscriptions/${encodeURIComponent(subscriptionId)}`, { cancel_at_period_end: "true" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    return { ok: false, error: message ? `決済を止められませんでした。${message}` : "決済を止められませんでした" };
  }
  const stoppedAt = new Date().toISOString();
  const updated = await db
    .from("membership_payment_records")
    .update({ reason: "stopped", stopped_at: stoppedAt })
    .eq("id", id);
  if (updated.error && missingPeriodColumn(String(updated.error.message ?? ""))) {
    await db.from("membership_payment_records").update({ reason: "stopped" }).eq("id", id);
  }
  return { ok: true };
}

async function upsertLedger(
  supabase: SupabaseClient<Database>,
  row: Record<string, unknown>,
  onConflict: string
): Promise<boolean> {
  const db = ledger(supabase);
  const first = await db.from("membership_payment_records").upsert(row, { onConflict });
  if (!first.error) return true;
  if (!missingPeriodColumn(String(first.error.message ?? ""))) {
    console.error("membership paid record", first.error.message);
    return false;
  }
  const second = await db.from("membership_payment_records").upsert(withoutPeriodColumns(row), { onConflict });
  if (second.error) {
    console.error("membership paid record", second.error.message);
    return false;
  }
  return true;
}

function tokyoDay(iso: string | null | undefined): string {
  if (!iso) return "";
  const day = DateTime.fromISO(iso).setZone("Asia/Tokyo");
  return day.isValid ? day.toFormat("yyyy-LL-dd") : "";
}

export async function recordMembershipRenewal(
  supabase: SupabaseClient<Database>,
  input: {
    invoiceId: string;
    subscriptionId: string;
    amountYen: number | null;
    periodStart: string | null;
    periodEnd: string | null;
    occurredAt: string | null;
  }
): Promise<"recorded" | "not_ours" | "unavailable"> {
  if (!input.invoiceId || !input.subscriptionId || !input.periodStart) return "not_ours";
  const db = ledger(supabase);
  const existing = await db
    .from("membership_payment_records")
    .select("id, member_id, member_code, member_name, email, store_name, plan_id, plan_name, price_yen, card_kind, period_start")
    .eq("status", "paid")
    .eq("stripe_subscription_id", input.subscriptionId)
    .order("occurred_at", { ascending: false })
    .limit(1);
  if (existing.error) {
    if (missingPeriodColumn(String(existing.error.message ?? ""))) return "not_ours";
    const wrapped = asLedgerError(existing.error);
    return wrapped.unavailable ? "unavailable" : "not_ours";
  }
  const row = ((existing.data ?? []) as Array<Record<string, unknown>>)[0];
  if (!row) return "not_ours";

  const samePeriod = tokyoDay(String(row.period_start ?? "")) === tokyoDay(input.periodStart);
  if (!row.period_start || samePeriod) {
    const updated = await db
      .from("membership_payment_records")
      .update({
        period_start: input.periodStart,
        period_end: input.periodEnd,
        stripe_subscription_id: input.subscriptionId,
      })
      .eq("id", row.id);
    if (updated.error) {
      if (missingPeriodColumn(String(updated.error.message ?? ""))) return "not_ours";
      console.error("membership renewal update", updated.error.message);
      return "unavailable";
    }
    return "recorded";
  }

  const inserted = await db.from("membership_payment_records").upsert(
    {
      member_id: row.member_id ?? null,
      member_code: row.member_code ?? null,
      member_name: row.member_name ?? null,
      email: row.email ?? null,
      store_name: row.store_name ?? null,
      plan_id: row.plan_id ?? null,
      plan_name: row.plan_name,
      price_yen: row.price_yen ?? null,
      amount_yen: input.amountYen,
      card_kind: row.card_kind ?? null,
      status: "paid",
      stripe_invoice_id: input.invoiceId,
      stripe_subscription_id: input.subscriptionId,
      period_start: input.periodStart,
      period_end: input.periodEnd,
      occurred_at: input.occurredAt || input.periodStart,
    },
    { onConflict: "stripe_invoice_id" }
  );
  if (inserted.error) {
    console.error("membership renewal record", inserted.error.message);
    const wrapped = asLedgerError(inserted.error);
    return wrapped.unavailable ? "unavailable" : "not_ours";
  }
  return "recorded";
}

async function latestGuidance(supabase: SupabaseClient<Database>, email: string) {
  const since = DateTime.now().setZone("Asia/Tokyo").minus({ days: 14 }).toUTC().toISO() ?? "";
  const { data, error } = await ledger(supabase)
    .from("membership_payment_records")
    .select("plan_id, plan_name, price_yen, member_id, member_code, member_name, store_name")
    .eq("status", "guided")
    .ilike("email", escapeIlike(email))
    .gte("occurred_at", since)
    .order("occurred_at", { ascending: false })
    .limit(1);
  if (error) throw asLedgerError(error);
  return ((data ?? []) as Array<{
    plan_id: string | null;
    plan_name: string;
    price_yen: number | null;
    member_id: string | null;
    member_code: string | null;
    member_name: string | null;
    store_name: string | null;
  }>)[0] ?? null;
}

async function saveFailure(
  supabase: SupabaseClient<Database>,
  input: {
    sessionId?: string | null;
    invoiceId?: string | null;
    memberId: string | null;
    memberCode: string | null;
    memberName: string | null;
    email: string;
    storeName: string | null;
    planId: string | null;
    planName: string;
    priceYen: number | null;
    amountYen: number | null;
    cardKind: string | null;
    memberLabel: string;
  }
): Promise<"recorded" | "unavailable"> {
  const row = {
    member_id: input.memberId,
    member_code: input.memberCode,
    member_name: input.memberName,
    email: input.email || null,
    store_name: input.storeName,
    plan_id: input.planId,
    plan_name: input.planName,
    price_yen: input.priceYen,
    amount_yen: input.amountYen,
    card_kind: input.cardKind,
    status: "failed",
    stripe_session_id: input.sessionId || null,
    stripe_invoice_id: input.invoiceId || null,
    occurred_at: new Date().toISOString(),
  };
  const db = ledger(supabase);
  const saved = input.sessionId
    ? await db.from("membership_payment_records").upsert(row, { onConflict: "stripe_session_id" })
    : input.invoiceId
      ? await db.from("membership_payment_records").upsert(row, { onConflict: "stripe_invoice_id" })
      : await db.from("membership_payment_records").insert(row);
  if (saved.error) {
    const ledgerError = asLedgerError(saved.error);
    if (ledgerError.unavailable) return "unavailable";
    throw ledgerError;
  }

  try {
    await pushPaymentLinkNotice(
      supabase,
      buildPaymentFailureReport({
        planName: input.planName,
        amountYen: input.amountYen,
        email: input.email,
        memberLabel: input.memberLabel,
        storeName: input.storeName,
      })
    );
  } catch (error) {
    console.error("membership payment failure notice", error);
  }
  return "recorded";
}

export async function recordMembershipCheckoutFailure(
  supabase: SupabaseClient<Database>,
  input: {
    sessionId: string;
    email: string;
    payerName: string;
    amountYen: number | null;
    item: PaymentLinkItem;
    card: "standard" | "amex";
  }
): Promise<"recorded" | "unavailable"> {
  const members = await findMembersByEmail(supabase, input.email);
  const member = members.length === 1 ? members[0]! : null;
  const storeName = await storeNameOf(supabase, member?.store_id ?? null);
  return saveFailure(supabase, {
    sessionId: input.sessionId,
    memberId: member?.id ?? null,
    memberCode: member?.member_code ?? null,
    memberName: members.length === 1 ? (member?.name ?? input.payerName) || null : input.payerName || null,
    email: input.email,
    storeName,
    planId: input.item.id,
    planName: input.item.name,
    priceYen: input.item.priceYen,
    amountYen: input.amountYen,
    cardKind: input.card,
    memberLabel: memberLabelOf(members, input.payerName),
  });
}

export async function recordMembershipInvoiceFailure(
  supabase: SupabaseClient<Database>,
  input: {
    invoiceId: string;
    amountYen: number | null;
    email: string;
    payerName: string;
  }
): Promise<"recorded" | "not_ours" | "unavailable"> {
  if (!input.invoiceId || input.amountYen == null) return "not_ours";
  let plan = identifyPlanByAmount(input.amountYen);
  let guided: Awaited<ReturnType<typeof latestGuidance>> | null = null;
  if (!plan && input.email) {
    try {
      guided = await latestGuidance(supabase, input.email);
    } catch (error) {
      if (error instanceof MembershipLedgerError && error.unavailable) return "not_ours";
      throw error;
    }
    if (guided) {
      plan = { planId: guided.plan_id, planName: guided.plan_name, priceYen: guided.price_yen ?? input.amountYen };
    }
  }
  if (!plan) return "not_ours";

  const members = await findMembersByEmail(supabase, input.email);
  const member = members.length === 1 ? members[0]! : null;
  const storeName = (await storeNameOf(supabase, member?.store_id ?? null)) ?? guided?.store_name ?? null;
  const memberLabel = members.length
    ? memberLabelOf(members, input.payerName)
    : guided?.member_code
      ? `${guided.member_name ?? "会員"}（${guided.member_code}）`
      : memberLabelOf(members, input.payerName);
  return saveFailure(supabase, {
    invoiceId: input.invoiceId,
    memberId: member?.id ?? guided?.member_id ?? null,
    memberCode: member?.member_code ?? guided?.member_code ?? null,
    memberName:
      members.length === 1
        ? (member?.name ?? input.payerName) || null
        : (guided?.member_name ?? input.payerName) || null,
    email: input.email,
    storeName,
    planId: plan.planId,
    planName: plan.planName,
    priceYen: plan.priceYen,
    amountYen: input.amountYen,
    cardKind: null,
    memberLabel,
  });
}
