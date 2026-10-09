/**
 * 在籍会員のうち
 * - 10/1〜9 の来店（予約件数・キャンセル除外）が 0回または1回
 * - 休会・退会は除外
 * - 10/9以降の予約を足すと 10/1以降の合計が2枠以上になる人は除外
 * 枠は30分=1枠。10/9以降の予約が無く、合計がすでに2枠の人は残す。
 * node scripts/list-oct1-9-visits-0or1-members.mjs
 */
import { createClient } from "@supabase/supabase-js";
import { DateTime } from "luxon";
import { fetchAllChecked } from "./lib/supabaseFetchAll.mjs";

const MAX_VISITS = 1;
const MAX_SLOTS = 1;
const SLOT_MIN = 30;
const RANGE_START = "2026-10-01T00:00:00+09:00";
const OCT9_START = "2026-10-09T00:00:00+09:00";
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

function slotCount(startAt, endAt) {
  const ms = new Date(endAt).getTime() - new Date(startAt).getTime();
  if (!Number.isFinite(ms) || ms <= 0) return 1;
  return Math.max(1, Math.round(ms / (SLOT_MIN * 60 * 1000)));
}

function slotsOf(rows) {
  return rows.reduce((sum, r) => sum + slotCount(r.start_at, r.end_at), 0);
}

function visitDates(rows) {
  return rows
    .map((r) => {
      const start = DateTime.fromISO(r.start_at).setZone(TZ);
      const slots = slotCount(r.start_at, r.end_at);
      return `${start.toFormat("M/d HH:mm")}(${slots}枠)`;
    })
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
          .neq("status", "cancelled")
          .not("member_id", "is", null),
      "reservations.oct1-onward",
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
  const excludedByFutureSlots = [];
  let excludedMembership = 0;
  let activeMemberCount = 0;
  let baseListCount = 0;
  for (const m of membersResult.rows) {
    if (!isActiveMember(m)) {
      excludedMembership += 1;
      continue;
    }
    activeMemberCount += 1;

    const all = byMember.get(m.id) ?? [];
    const oct1to9 = all.filter((r) => new Date(r.start_at).getTime() < new Date(RANGE_END).getTime());
    if (oct1to9.length > MAX_VISITS) continue;
    baseListCount += 1;

    const beforeOct9 = all.filter((r) => new Date(r.start_at).getTime() < new Date(OCT9_START).getTime());
    const fromOct9 = all.filter((r) => new Date(r.start_at).getTime() >= new Date(OCT9_START).getTime());
    const slotsBeforeOct9 = slotsOf(beforeOct9);
    const slotsFromOct9 = slotsOf(fromOct9);
    const slotsFromOct1 = slotsBeforeOct9 + slotsFromOct9;

    const row = {
      memberCode: String(m.member_code ?? "").toUpperCase(),
      displayName: m.display_name ?? m.name ?? "—",
      homeStore: storeNameById[m.store_id] ?? null,
      membershipStatus: m.membership_status ?? null,
      isActive: m.is_active ?? null,
      visitCountOct1to9: oct1to9.length,
      slotsBeforeOct9,
      slotsFromOct9,
      slotsFromOct1,
      visitTimesOct1to9: visitDates(oct1to9),
      reservationTimesFromOct9: visitDates(fromOct9),
    };

    if (fromOct9.length > 0 && slotsFromOct1 > MAX_SLOTS) {
      excludedByFutureSlots.push(row);
      continue;
    }

    results.push(row);
  }

  const byStoreThenCode = (a, b) =>
    a.visitCountOct1to9 - b.visitCountOct1to9 ||
    a.slotsFromOct1 - b.slotsFromOct1 ||
    String(a.homeStore ?? "").localeCompare(String(b.homeStore ?? ""), "ja") ||
    String(a.memberCode).localeCompare(String(b.memberCode));
  results.sort(byStoreThenCode);
  excludedByFutureSlots.sort(byStoreThenCode);

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
          metric: "来店回数 = 予約レコード件数 / 枠 = 30分",
          visitRange: "10/1〜9 は 0回または1回",
          exclude: "10/9以降の予約があり、10/1以降の合計枠が2以上",
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
        baseListCount,
        excludedByFutureSlotsCount: excludedByFutureSlots.length,
        memberCount: results.length,
        breakdownByVisits: byVisits,
        storeBreakdown: countByStore(results),
        members: results,
        excludedByFutureSlots,
      },
      null,
      2,
    ),
  );

  console.log("\n--- サマリー ---");
  console.log(`集計時点: ${generatedAt} JST`);
  console.log(
    `対象: ${results.length}名（10/1〜9が0〜1回の在籍 ${baseListCount}名から、9日以降の予約で2枠以上になる ${excludedByFutureSlots.length}名を除外）`,
  );
  console.log(`在籍 ${activeMemberCount}名 / 退会・休会除外: ${excludedMembership}名`);
  console.log(`内訳: 0回=${byVisits[0]} / 1回=${byVisits[1]}`);
  console.log(`店舗別: ${JSON.stringify(countByStore(results))}`);

  console.log("\n--- 一覧 ---");
  console.log("| # | 会員コード | 氏名 | 所属店 | 来店(10/1〜9) | 10/1〜8枠 | 10/9以降枠 | 合計枠 | 10/1〜9 | 10/9以降 |");
  console.log("|---:|---|---|---|---:|---:|---:|---:|---|---|");
  results.forEach((r, i) => {
    console.log(
      `| ${i + 1} | ${r.memberCode} | ${r.displayName} | ${r.homeStore ?? "—"} | ${r.visitCountOct1to9} | ${r.slotsBeforeOct9} | ${r.slotsFromOct9} | ${r.slotsFromOct1} | ${r.visitTimesOct1to9 || "—"} | ${r.reservationTimesFromOct9 || "—"} |`,
    );
  });

  console.log("\n--- 除外（9日以降の予約で合計2枠以上） ---");
  console.log("| # | 会員コード | 氏名 | 所属店 | 来店(10/1〜9) | 10/1〜8枠 | 10/9以降枠 | 合計枠 | 10/9以降 |");
  console.log("|---:|---|---|---|---:|---:|---:|---:|---|");
  excludedByFutureSlots.forEach((r, i) => {
    console.log(
      `| ${i + 1} | ${r.memberCode} | ${r.displayName} | ${r.homeStore ?? "—"} | ${r.visitCountOct1to9} | ${r.slotsBeforeOct9} | ${r.slotsFromOct9} | ${r.slotsFromOct1} | ${r.reservationTimesFromOct9 || "—"} |`,
    );
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
