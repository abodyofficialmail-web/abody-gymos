/** Supabase内の trainer_visibility 関連テーブル・設定を探索（GH Actions） */
import { createClient } from "@supabase/supabase-js";

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase env missing");
  const supabase = createClient(url, key, { auth: { persistSession: false } });

  const tables = [
    "trainer_visibility_settings",
    "trainer_visibility_products",
    "stripe_products",
    "stripe_prices",
    "billing_products",
    "member_subscriptions",
  ];

  const results = {};
  for (const table of tables) {
    const { data, error } = await supabase.from(table).select("*").limit(5);
    results[table] = error ? { error: error.message } : { count: data?.length ?? 0, sample: data };
  }

  const { data: subMember } = await supabase
    .from("members")
    .select("trainer_visibility_stripe_subscription_id, trainer_visibility_stripe_customer_id")
    .eq("member_code", "SAK041")
    .maybeSingle();

  console.log(JSON.stringify({ tables: results, sak041: subMember }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
