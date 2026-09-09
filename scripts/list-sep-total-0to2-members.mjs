/**
 * 9月1〜9日 + 9月10〜30日 の予約合計が 0〜2回 の会員を抽出（8月利用不問）
 * node --env-file=.env.local scripts/list-sep-total-0to2-members.mjs
 */
import { createClient } from "@supabase/supabase-js";
import { fetchAllChecked } from "./lib/supabaseFetchAll.mjs";

const MAX_SEP_TOTAL = 2;
const SLOT_MIN = 30;

const SEP_START = "2026-09-01T00:00:00+09:00";
const SEP_END = "2026-10-01T00:00:00+09:00";
const SEP10_START = "2026-09-10T00:00:00+09:00";

const AUG_START = "2026-08-01T00:00:00+09:00";
const AUG_END = "2026-09-01T00:00:00+09:00";

function slotCount(startAt, endAt) {
  const ms = new Date(endAt).getTime() - new Date(startAt).getTime();
  if (ms <= 0) return 0;
  return Math.max(1, Math.round(ms / (SLOT_MIN * 60 * 1000)));
}

function inRange(iso, start, end) {
  const t = new Date(iso).getTime();
  return t >= new Date(start).getTime() && t < new Date(end).getTime();
}

function countReservationsInRange(resList, rangeStart, rangeEnd) {
  return resList.filter((r) => inRange(r.start_at, rangeStart, rangeEnd)).length;
}

function countSlotsInRange(resList, rangeStart, rangeEnd) {
  return resList
    .filter((r) => inRange(r.start_at, rangeStart, rangeEnd))
    .reduce((s, r) => s + slotCount(r.start_at, r.end_at), 0);
}

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

  const [sepResult, augResult, membersResult, storesResult] = await Promise.all([
    fetchAllChecked(
      supabase,
      "reservations",
      "id, member_id, start_at, end_at, status",
      (q) =>
        q
          .gte("start_at", SEP_START)
          .lt("start_at", SEP_END)
          .neq("status", "cancelled")
          .not("member_id", "is", null),
      "reservations.september",
    ),
    fetchAllChecked(
      supabase,
      "reservations",
      "id, member_id, start_at, end_at, status",
      (q) =>
        q
          .gte("start_at", AUG_START)
          .lt("start_at", AUG_END)
          .neq("status", "cancelled")
          .not("member_id", "is", null),
      "reservations.august",
    ),
    fetchAllChecked(
      supabase,
      "members",
      "id, member_code, display_name, name, store_id, is_active",
      undefined,
      "members",
    ),
    fetchAllChecked(supabase, "stores", "id, name", undefined, "stores"),
  ]);

  const sepByMember = new Map();
  for (const r of sepResult.rows) {
    const list = sepByMember.get(r.member_id) ?? [];
    list.push(r);
    sepByMember.set(r.member_id, list);
  }

  const augByMember = new Map();
  for (const r of augResult.rows) {
    const list = augByMember.get(r.member_id) ?? [];
    list.push(r);
    augByMember.set(r.member_id, list);
  }

  const storeNameById = Object.fromEntries(storesResult.rows.map((s) => [s.id, s.name]));

  const results = [];

  for (const m of membersResult.rows) {
    const sepList = sepByMember.get(m.id) ?? [];
    const sep1to9 = countReservationsInRange(sepList, SEP_START, SEP10_START);
    const sep10to30 = countReservationsInRange(sepList, SEP10_START, SEP_END);
    const sepTotal = sepList.length;

    if (sepTotal > MAX_SEP_TOTAL) continue;

    const augList = augByMember.get(m.id) ?? [];

    results.push({
      memberCode: String(m.member_code ?? "").toUpperCase(),
      displayName: m.display_name ?? m.name ?? "—",
      homeStore: storeNameById[m.store_id] ?? null,
      isActive: m.is_active ?? null,
      augSessionCount: augList.length,
      sep1to9ReservationCount: sep1to9,
      sep10to30ReservationCount: sep10to30,
      sepTotalReservationCount: sepTotal,
      sepTotalSlotCount: countSlotsInRange(sepList, SEP_START, SEP_END),
    });
  }

  results.sort(
    (a, b) =>
      a.sepTotalReservationCount - b.sepTotalReservationCount ||
      b.augSessionCount - a.augSessionCount ||
      String(a.memberCode).localeCompare(String(b.memberCode)),
  );

  const bySepTotal = { 0: 0, 1: 0, 2: 0 };
  for (const r of results) {
    bySepTotal[r.sepTotalReservationCount] = (bySepTotal[r.sepTotalReservationCount] ?? 0) + 1;
  }

  console.log(
    JSON.stringify(
      {
        fetched: {
          septemberReservations: { count: sepResult.count, fetched: sepResult.fetched },
          members: { count: membersResult.count, fetched: membersResult.fetched },
        },
        criteria: {
          september: "2026-09-01〜09 + 2026-09-10〜30 の予約合計 0〜2回（キャンセル除外）",
          august: "不問（参考として8月利用回数を表示）",
        },
        memberCount: results.length,
        breakdownBySepTotal: bySepTotal,
        storeBreakdown: countByStore(results),
        members: results,
      },
      null,
      2,
    ),
  );

  console.log("\n--- サマリー ---");
  console.log(`9月合計0〜2回: ${results.length}名（0回: ${bySepTotal[0]} / 1回: ${bySepTotal[1]} / 2回: ${bySepTotal[2]}）`);

  console.log("\n--- 一覧 ---");
  console.log(
    "| # | 会員コード | 氏名 | 所属店 | 9/1〜9 | 9/10〜30 | 9月合計 | 8月利用(参考) |",
  );
  console.log("|---:|---|---|---|---:|---:|---:|---:|");
  results.forEach((r, i) => {
    console.log(
      `| ${i + 1} | ${r.memberCode} | ${r.displayName} | ${r.homeStore ?? "—"} | ${r.sep1to9ReservationCount} | ${r.sep10to30ReservationCount} | ${r.sepTotalReservationCount} | ${r.augSessionCount} |`,
    );
  });

  console.log("\n--- 店舗別 ---");
  for (const [store, n] of Object.entries(countByStore(results)).sort((a, b) => b[1] - a[1])) {
    console.log(`${store}: ${n}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
