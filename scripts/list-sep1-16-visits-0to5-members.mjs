/**
 * 9月1〜16日の来店回数（予約件数・キャンセル除外）が 0〜5回 の会員一覧
 * node scripts/list-sep1-16-visits-0to5-members.mjs
 */
import { createClient } from "@supabase/supabase-js";
import { fetchAllChecked } from "./lib/supabaseFetchAll.mjs";

const MAX_VISITS = 5;
const RANGE_START = "2026-09-01T00:00:00+09:00";
const RANGE_END = "2026-09-17T00:00:00+09:00";

function countByStore(results) {
  const breakdown = {};
  for (const r of results) {
    const store = r.homeStore ?? "不明";
    breakdown[store] = (breakdown[store] ?? 0) + 1;
  }
  return breakdown;
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("DB未接続");
    process.exit(1);
  }

  const supabase = createClient(url, key, { auth: { persistSession: false } });

  const [resResult, membersResult, storesResult] = await Promise.all([
    fetchAllChecked(
      supabase,
      "reservations",
      "id, member_id, start_at, end_at, status",
      (q) =>
        q
          .gte("start_at", RANGE_START)
          .lt("start_at", RANGE_END)
          .neq("status", "cancelled")
          .not("member_id", "is", null),
      "reservations.sep1-16",
    ),
    fetchAllChecked(
      supabase,
      "members",
      "id, member_code, display_name, name, store_id, is_active, membership_status",
      undefined,
      "members",
    ),
    fetchAllChecked(supabase, "stores", "id, name", undefined, "stores"),
  ]);

  const byMember = new Map();
  for (const r of resResult.rows) {
    const list = byMember.get(r.member_id) ?? [];
    list.push(r);
    byMember.set(r.member_id, list);
  }

  const storeNameById = Object.fromEntries(storesResult.rows.map((s) => [s.id, s.name]));

  const results = [];
  for (const m of membersResult.rows) {
    const visits = (byMember.get(m.id) ?? []).length;
    if (visits > MAX_VISITS) continue;

    results.push({
      memberCode: String(m.member_code ?? "").toUpperCase(),
      displayName: m.display_name ?? m.name ?? "—",
      homeStore: storeNameById[m.store_id] ?? null,
      membershipStatus: m.membership_status ?? null,
      isActive: m.is_active ?? null,
      visitCountSep1to16: visits,
    });
  }

  results.sort(
    (a, b) =>
      a.visitCountSep1to16 - b.visitCountSep1to16 ||
      String(a.memberCode).localeCompare(String(b.memberCode)),
  );

  const byVisits = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  for (const r of results) {
    byVisits[r.visitCountSep1to16] = (byVisits[r.visitCountSep1to16] ?? 0) + 1;
  }

  console.log(
    JSON.stringify(
      {
        criteria: {
          period: "2026-09-01〜16（start_at基準・キャンセル除外）",
          metric: "来店回数 = 予約レコード件数",
          visitRange: "0〜5回",
        },
        memberCount: results.length,
        breakdownByVisits: byVisits,
        storeBreakdown: countByStore(results),
        members: results,
      },
      null,
      2,
    ),
  );

  console.log("\n--- サマリー ---");
  console.log(`9/1〜16 来店0〜5回: ${results.length}名`);
  console.log(
    `内訳: 0=${byVisits[0]} / 1=${byVisits[1]} / 2=${byVisits[2]} / 3=${byVisits[3]} / 4=${byVisits[4]} / 5=${byVisits[5]}`,
  );

  console.log("\n--- 一覧 ---");
  console.log("| # | 会員コード | 氏名 | 所属店 | 来店(9/1〜16) | 在籍状態 |");
  console.log("|---:|---|---|---|---:|---|");
  results.forEach((r, i) => {
    const status = r.membershipStatus ?? (r.isActive ? "active" : "inactive");
    console.log(
      `| ${i + 1} | ${r.memberCode} | ${r.displayName} | ${r.homeStore ?? "—"} | ${r.visitCountSep1to16} | ${status} |`,
    );
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
