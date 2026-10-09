/**
 * 10月1〜9日の来店回数（予約件数・キャンセル除外）が 0回または1回 の会員一覧
 * 休会・退会は除外
 * node scripts/list-oct1-9-visits-0or1-members.mjs
 */
import { createClient } from "@supabase/supabase-js";
import { DateTime } from "luxon";
import { fetchAllChecked } from "./lib/supabaseFetchAll.mjs";

const MAX_VISITS = 1;
const RANGE_START = "2026-10-01T00:00:00+09:00";
const RANGE_END = "2026-10-10T00:00:00+09:00";
const TZ = "Asia/Tokyo";

/** 在籍会員のみ（退会・休会除外） */
function isActiveMember(m) {
  const ms = String(m.membership_status ?? "").toLowerCase();
  if (ms === "active") return true;
  if (ms === "hiatus" || ms === "withdrawn") return false;
  return m.is_active === true;
}

function countByStore(results) {
  const breakdown = {};
  for (const r of results) {
    const store = r.homeStore ?? "不明";
    breakdown[store] = (breakdown[store] ?? 0) + 1;
  }
  return breakdown;
}

function visitDates(rows) {
  return rows
    .map((r) => DateTime.fromISO(r.start_at).setZone(TZ).toFormat("M/d HH:mm"))
    .sort()
    .join(", ");
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
      "reservations.oct1-9",
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
  let excludedMembership = 0;
  let activeMemberCount = 0;
  for (const m of membersResult.rows) {
    if (!isActiveMember(m)) {
      excludedMembership += 1;
      continue;
    }
    activeMemberCount += 1;

    const visits = byMember.get(m.id) ?? [];
    if (visits.length > MAX_VISITS) continue;

    results.push({
      memberCode: String(m.member_code ?? "").toUpperCase(),
      displayName: m.display_name ?? m.name ?? "—",
      homeStore: storeNameById[m.store_id] ?? null,
      membershipStatus: m.membership_status ?? null,
      isActive: m.is_active ?? null,
      visitCountOct1to9: visits.length,
      visitTimes: visitDates(visits),
    });
  }

  results.sort(
    (a, b) =>
      a.visitCountOct1to9 - b.visitCountOct1to9 ||
      String(a.homeStore ?? "").localeCompare(String(b.homeStore ?? ""), "ja") ||
      String(a.memberCode).localeCompare(String(b.memberCode)),
  );

  const byVisits = { 0: 0, 1: 0 };
  for (const r of results) {
    byVisits[r.visitCountOct1to9] = (byVisits[r.visitCountOct1to9] ?? 0) + 1;
  }

  const generatedAt = DateTime.now().setZone(TZ).toFormat("yyyy-MM-dd HH:mm");

  console.log(
    JSON.stringify(
      {
        criteria: {
          period: "2026-10-01〜09（start_at基準・JST・キャンセル除外）",
          metric: "来店回数 = 予約レコード件数",
          visitRange: "0回または1回",
          membership: "在籍会員のみ（退会・休会除外）",
          generatedAt,
        },
        fetch: {
          reservations: { count: resResult.count, fetched: resResult.fetched },
          members: { count: membersResult.count, fetched: membersResult.fetched },
          stores: { count: storesResult.count, fetched: storesResult.fetched },
        },
        activeMemberCount,
        excludedMembershipCount: excludedMembership,
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
  console.log(`集計時点: ${generatedAt} JST`);
  console.log(
    `10/1〜9 来店0〜1回（在籍のみ）: ${results.length}名（在籍 ${activeMemberCount}名 / 退会・休会除外: ${excludedMembership}名）`,
  );
  console.log(`内訳: 0回=${byVisits[0]} / 1回=${byVisits[1]}`);
  console.log(`店舗別: ${JSON.stringify(countByStore(results))}`);

  console.log("\n--- 一覧 ---");
  console.log("| # | 会員コード | 氏名 | 所属店 | 来店(10/1〜9) | 来店日時 |");
  console.log("|---:|---|---|---|---:|---|");
  results.forEach((r, i) => {
    console.log(
      `| ${i + 1} | ${r.memberCode} | ${r.displayName} | ${r.homeStore ?? "—"} | ${r.visitCountOct1to9} | ${r.visitTimes || "—"} |`,
    );
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
