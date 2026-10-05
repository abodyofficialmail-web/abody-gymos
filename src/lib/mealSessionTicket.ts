import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { getAppUrl } from "@/lib/constants";
import { stripePost } from "@/lib/stripeTrainerPass";

type Db = SupabaseClient<Database>;

export const MEAL_SESSION_TICKET_PRODUCT = "meal_session_ticket";

function mealSessionTicketPriceId(): string {
  return process.env.STRIPE_MEAL_SESSION_TICKET_PRICE_ID?.trim() ?? "";
}

function mealSessionTicketUnitAmountYen(): number {
  const n = Number(process.env.STRIPE_MEAL_SESSION_TICKET_UNIT_AMOUNT ?? "");
  return Number.isInteger(n) && n > 0 ? n : 0;
}

export function mealSessionTicketCheckoutReady(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY?.trim()) && Boolean(mealSessionTicketPriceId() || mealSessionTicketUnitAmountYen());
}

export async function createMealSessionTicketCheckoutUrl(params: {
  memberId: string;
  memberCode?: string | null;
  email?: string | null;
}): Promise<string | null> {
  if (!mealSessionTicketCheckoutReady()) return null;
  const app = getAppUrl();
  const memberId = params.memberId.trim();
  const email = String(params.email ?? "").trim();
  const memberCode = String(params.memberCode ?? "").trim();
  const priceId = mealSessionTicketPriceId();
  const unitAmount = mealSessionTicketUnitAmountYen();
  const body: Record<string, string> = {
    mode: "payment",
    locale: "ja",
    client_reference_id: memberId,
    success_url: `${app}/meal-log?ticket=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${app}/meal-log`,
    "metadata[product]": MEAL_SESSION_TICKET_PRODUCT,
    "metadata[member_id]": memberId,
    "payment_intent_data[metadata][product]": MEAL_SESSION_TICKET_PRODUCT,
    "payment_intent_data[metadata][member_id]": memberId,
  };
  if (priceId) {
    body["line_items[0][price]"] = priceId;
    body["line_items[0][quantity]"] = "1";
  } else {
    body["line_items[0][quantity]"] = "1";
    body["line_items[0][price_data][currency]"] = "jpy";
    body["line_items[0][price_data][unit_amount]"] = String(unitAmount);
    body["line_items[0][price_data][product_data][name]"] = "パーソナルチケット（1回）";
  }
  if (email) body.customer_email = email;
  if (memberCode) body["metadata[member_code]"] = memberCode;
  const session = await stripePost("/checkout/sessions", body);
  const url = String(session?.url ?? "").trim();
  return url || null;
}

export async function readMealSessionTickets(supabase: Db, memberId: string): Promise<number> {
  const { data, error } = await (supabase as any)
    .from("members")
    .select("meal_session_tickets")
    .eq("id", memberId)
    .maybeSingle();
  if (error) return 0;
  return Math.max(0, Number(data?.meal_session_tickets ?? 0) || 0);
}

async function setTickets(supabase: Db, memberId: string, next: number, expected: number): Promise<boolean> {
  const { data, error } = await (supabase as any)
    .from("members")
    .update({ meal_session_tickets: next })
    .eq("id", memberId)
    .eq("meal_session_tickets", expected)
    .select("id")
    .maybeSingle();
  if (error) return false;
  return Boolean(data?.id);
}

export async function consumeMealSessionTicket(supabase: Db, memberId: string): Promise<boolean> {
  for (let i = 0; i < 3; i += 1) {
    const current = await readMealSessionTickets(supabase, memberId);
    if (current < 1) return false;
    if (await setTickets(supabase, memberId, current - 1, current)) return true;
  }
  return false;
}

export async function restoreMealSessionTicket(supabase: Db, memberId: string): Promise<void> {
  for (let i = 0; i < 3; i += 1) {
    const { data, error } = await (supabase as any)
      .from("members")
      .select("meal_session_tickets")
      .eq("id", memberId)
      .maybeSingle();
    if (error || !data) return;
    const current = Math.max(0, Number(data.meal_session_tickets ?? 0) || 0);
    if (await setTickets(supabase, memberId, current + 1, current)) return;
  }
}

export async function grantMealSessionTicket(params: {
  supabase: Db;
  memberId: string;
  stripeSessionId: string;
}): Promise<{ ok: true; tickets: number; already?: boolean } | { ok: false; error: string }> {
  const sessionId = params.stripeSessionId.trim();
  const memberId = params.memberId.trim();
  if (!sessionId || !memberId) return { ok: false, error: "決済情報不足" };
  const inserted = await (params.supabase as any).from("meal_session_ticket_grants").insert({
    stripe_session_id: sessionId,
    member_id: memberId,
  });
  if (inserted.error && /duplicate|unique/i.test(String(inserted.error.message ?? ""))) {
    return { ok: true, tickets: await readMealSessionTickets(params.supabase, memberId), already: true };
  }
  if (inserted.error) return { ok: false, error: inserted.error.message };
  for (let i = 0; i < 3; i += 1) {
    const current = await readMealSessionTickets(params.supabase, memberId);
    if (await setTickets(params.supabase, memberId, current + 1, current)) {
      return { ok: true, tickets: current + 1 };
    }
  }
  return { ok: false, error: "チケットを追加できませんでした" };
}
