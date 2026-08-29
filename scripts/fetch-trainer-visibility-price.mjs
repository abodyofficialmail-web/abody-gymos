/** 担当トレーナー表示パスの課金金額を Stripe から取得（GH Actions） */
import { createClient } from "@supabase/supabase-js";

async function fetchStripeSubscription(subscriptionId, stripeKey) {
  const res = await fetch(`https://api.stripe.com/v1/subscriptions/${subscriptionId}`, {
    headers: { Authorization: `Bearer ${stripeKey}` },
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error?.message ?? `Stripe ${res.status}`);
  return body;
}

async function fetchStripePrice(priceId, stripeKey) {
  const res = await fetch(`https://api.stripe.com/v1/prices/${priceId}`, {
    headers: { Authorization: `Bearer ${stripeKey}` },
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error?.message ?? `Stripe ${res.status}`);
  return body;
}

async function fetchStripeProduct(productId, stripeKey) {
  const res = await fetch(`https://api.stripe.com/v1/products/${productId}`, {
    headers: { Authorization: `Bearer ${stripeKey}` },
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error?.message ?? `Stripe ${res.status}`);
  return body;
}

function formatYen(amount, currency) {
  if (currency === "jpy") return `¥${amount.toLocaleString("ja-JP")}`;
  return `${amount} ${currency.toUpperCase()}`;
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const stripeKey = process.env.STRIPE_SECRET_KEY?.trim();
  if (!url || !key) throw new Error("Supabase env missing");

  const supabase = createClient(url, key, { auth: { persistSession: false } });

  const { data: activeMembers } = await supabase
    .from("members")
    .select("*")
    .eq("trainer_visibility_pass_status", "active");

  const out = {
    activeCount: activeMembers?.length ?? 0,
    activeMemberRecords: (activeMembers ?? []).map(({ line_user_id, ...rest }) => rest),
    stripeConfigured: Boolean(stripeKey),
    priceFromEnv: {
      TRAINER_VISIBILITY_PASS_PRICE_ID: process.env.TRAINER_VISIBILITY_PASS_PRICE_ID ?? null,
      TRAINER_VISIBILITY_PASS_AMOUNT: process.env.TRAINER_VISIBILITY_PASS_AMOUNT ?? null,
      NEXT_PUBLIC_TRAINER_VISIBILITY_PASS_PRICE_YEN: process.env.NEXT_PUBLIC_TRAINER_VISIBILITY_PASS_PRICE_YEN ?? null,
    },
    subscriptions: [],
    catalog: null,
  };

  if (!stripeKey) {
    console.log(JSON.stringify({ ...out, note: "STRIPE_SECRET_KEY 未設定のため Stripe API から金額取得不可" }, null, 2));
    return;
  }

  const seenPriceIds = new Set();
  for (const m of activeMembers ?? []) {
    const subId = m.trainer_visibility_stripe_subscription_id;
    if (!subId) continue;
    try {
      const sub = await fetchStripeSubscription(subId, stripeKey);
      const item = sub.items?.data?.[0];
      const price = item?.price;
      const entry = {
        memberCode: m.member_code,
        name: m.display_name || m.name,
        subscriptionId: subId,
        status: sub.status,
        interval: price?.recurring?.interval ?? null,
        intervalCount: price?.recurring?.interval_count ?? null,
        unitAmount: price?.unit_amount ?? null,
        currency: price?.currency ?? null,
        formatted: price ? formatYen(price.unit_amount, price.currency) : null,
        priceId: price?.id ?? null,
        productId: typeof price?.product === "string" ? price.product : price?.product?.id ?? null,
      };
      out.subscriptions.push(entry);
      if (entry.priceId) seenPriceIds.add(entry.priceId);
    } catch (e) {
      out.subscriptions.push({
        memberCode: m.member_code,
        subscriptionId: subId,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  // env の Price ID があればカタログ価格も取得
  const envPriceId = process.env.TRAINER_VISIBILITY_PASS_PRICE_ID?.trim();
  if (envPriceId) seenPriceIds.add(envPriceId);

  const catalog = [];
  for (const priceId of seenPriceIds) {
    try {
      const price = await fetchStripePrice(priceId, stripeKey);
      let productName = null;
      const productId = typeof price.product === "string" ? price.product : price.product?.id;
      if (productId) {
        try {
          const product = await fetchStripeProduct(productId, stripeKey);
          productName = product.name ?? null;
        } catch {
          /* ignore */
        }
      }
      catalog.push({
        priceId,
        productId,
        productName,
        unitAmount: price.unit_amount,
        currency: price.currency,
        formatted: formatYen(price.unit_amount, price.currency),
        interval: price.recurring?.interval ?? null,
        intervalCount: price.recurring?.interval_count ?? null,
      });
    } catch (e) {
      catalog.push({ priceId, error: e instanceof Error ? e.message : String(e) });
    }
  }
  out.catalog = catalog;

  console.log(JSON.stringify(out, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
