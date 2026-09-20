/**
 * 店舗別アクティブ会員数（休会・退会除外）
 * node scripts/count-active-members-by-store.mjs
 */
import { createClient } from "@supabase/supabase-js";
import { fetchAllChecked } from "./lib/supabaseFetchAll.mjs";

const TARGET_STORE_NAMES = ["恵比寿", "上野", "桜木町", "新宿"];

function isActiveMember(m) {
  const ms = String(m.membership_status ?? "").toLowerCase();
  if (ms === "active") return true;
  if (ms === "hiatus" || ms === "withdrawn") return false;
  return m.is_active === true;
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("DB未接続");
    process.exit(1);
  }

  const supabase = createClient(url, key, { auth: { persistSession: false } });

  const [membersResult, storesResult] = await Promise.all([
    fetchAllChecked(
      supabase,
      "members",
      "id, member_code, store_id, is_active, membership_status",
      undefined,
      "members",
    ),
    fetchAllChecked(supabase, "stores", "id, name", undefined, "stores"),
  ]);

  const storeNameById = Object.fromEntries(storesResult.rows.map((s) => [s.id, s.name]));
  const counts = Object.fromEntries(TARGET_STORE_NAMES.map((n) => [n, 0]));
  const unknownStore = [];

  for (const m of membersResult.rows) {
    if (!isActiveMember(m)) continue;
    const storeName = storeNameById[m.store_id] ?? null;
    if (storeName && counts[storeName] !== undefined) {
      counts[storeName] += 1;
    } else if (storeName) {
      unknownStore.push(storeName);
    }
  }

  const otherActive = {};
  for (const m of membersResult.rows) {
    if (!isActiveMember(m)) continue;
    const storeName = storeNameById[m.store_id] ?? "不明";
    if (TARGET_STORE_NAMES.includes(storeName)) continue;
    otherActive[storeName] = (otherActive[storeName] ?? 0) + 1;
  }

  const totalTarget = TARGET_STORE_NAMES.reduce((s, n) => s + counts[n], 0);
  const totalActive = membersResult.rows.filter(isActiveMember).length;

  console.log(
    JSON.stringify(
      {
        criteria: {
          active: "membership_status=active、または未設定時 is_active=true（休会・退会除外）",
          stores: TARGET_STORE_NAMES,
        },
        countsByStore: counts,
        totalFourStores: totalTarget,
        totalActiveAllStores: totalActive,
        otherStoresActive: otherActive,
      },
      null,
      2,
    ),
  );

  console.log("\n--- 店舗別アクティブ会員数 ---");
  for (const name of TARGET_STORE_NAMES) {
    console.log(`${name}: ${counts[name]}名`);
  }
  console.log(`\n4店合計: ${totalTarget}名 / 全店アクティブ: ${totalActive}名`);
  if (Object.keys(otherActive).length) {
    console.log(`その他店舗: ${JSON.stringify(otherActive)}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
