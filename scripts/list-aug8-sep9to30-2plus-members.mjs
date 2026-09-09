/**
 * 8月8回以上利用 かつ 9/9〜9/30で2回以上予約の会員を抽出
 * node --env-file=.env.local scripts/list-aug8-sep9to30-2plus-members.mjs
 */
import { createClient } from "@supabase/supabase-js";
import { fetchAllChecked } from "./lib/supabaseFetchAll.mjs";

const MIN_AUG_SESSIONS = 8;
const MIN_SEP_RESERVATIONS = 2;
const SLOT_MIN = 30;

const AUG_START = "2026-08-01T00:00:00+09:00";
const AUG_END = "2026-09-01T00:00:00+09:00";

const SEP_FETCH_START = "2026-09-01T00:00:00+09:00";
const SEP_FETCH_END = "2026-10-01T00:00:00+09:00";
/** 予約数カウント対象: 9/9 0:00 〜 9/30 */
const COUNT_START = "2026-09-09T00:00:00+09:00";
const COUNT_END = "2026-10-01T00:00:00+09:00";

function slotCount(startAt, endAt) {
  const ms = new Date(endAt).getTime() - new Date(startAt).getTime();
  if (ms <= 0) return 0;
  return Math.max(1, Math.round(ms / (SLOT_MIN * 60 * 1000)));
}

function inRange(iso, start, end) {
  const t = new Date(iso).getTime();
  return t >= new Date(start).getTime() && t < new Date(end).getTime();
}

function countSlotsInRange(resList, rangeStart, rangeEnd) {
  return resList
    .filter((r) => inRange(r.start_at, rangeStart, rangeEnd))
    .reduce((s, r) => s + slotCount(r.start_at, r.end_at), 0);
}

function countReservationsInRange(resList, rangeStart, rangeEnd) {
  return resList.filter((r) => inRange(r.start_at, rangeStart, rangeEnd)).length;
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

  const [augResult, sepResult, membersResult, storesResult] = await Promise.all([
    fetchAllChecked(
      supabase,
      "reservations",
      "id, member_id, store_id, start_at, end_at, status",
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
      "reservations",
      "id, member_id, store_id, start_at, end_at, status",
      (q) =>
        q
          .gte("start_at", SEP_FETCH_START)
          .lt("start_at", SEP_FETCH_END)
          .neq("status", "cancelled")
          .not("member_id", "is", null),
      "reservations.september",
    ),
    fetchAllChecked(
      supabase,
      "members",
      "id, member_code, display_name, name, store_id",
      undefined,
      "members",
    ),
    fetchAllChecked(supabase, "stores", "id, name", undefined, "stores"),
  ]);

  const augByMember = new Map();
  for (const r of augResult.rows) {
    const list = augByMember.get(r.member_id) ?? [];
    list.push(r);
    augByMember.set(r.member_id, list);
  }

  const sepByMember = new Map();
  for (const r of sepResult.rows) {
    const list = sepByMember.get(r.member_id) ?? [];
    list.push(r);
    sepByMember.set(r.member_id, list);
  }

  const memberById = Object.fromEntries(membersResult.rows.map((m) => [m.id, m]));
  const storeNameById = Object.fromEntries(storesResult.rows.map((s) => [s.id, s.name]));

  const results = [];

  for (const [memberId, augList] of augByMember) {
    const augSessionCount = augList.length;
    if (augSessionCount < MIN_AUG_SESSIONS) continue;

    const sepList = sepByMember.get(memberId) ?? [];
    const sep9to30ReservationCount = countReservationsInRange(sepList, COUNT_START, COUNT_END);
    if (sep9to30ReservationCount < MIN_SEP_RESERVATIONS) continue;

    const m = memberById[memberId];
    const augSlotCount = augList.reduce((s, r) => s + slotCount(r.start_at, r.end_at), 0);

    results.push({
      memberCode: String(m?.member_code ?? "").toUpperCase(),
      displayName: m?.display_name ?? m?.name ?? "—",
      homeStore: storeNameById[m?.store_id] ?? null,
      augSessionCount,
      augSlotCount,
      sep9to30ReservationCount,
      sep9to30SlotCount: countSlotsInRange(sepList, COUNT_START, COUNT_END),
      sep1to8ReservationCount: countReservationsInRange(sepList, SEP_FETCH_START, COUNT_START),
      sepTotalReservationCount: sepList.length,
      sepTotalSlotCount: countSlotsInRange(sepList, SEP_FETCH_START, SEP_FETCH_END),
    });
  }

  results.sort(
    (a, b) =>
      b.sep9to30ReservationCount - a.sep9to30ReservationCount ||
      b.augSessionCount - a.augSessionCount ||
      String(a.memberCode).localeCompare(String(b.memberCode)),
  );

  console.log(
    JSON.stringify(
      {
        fetched: {
          august: { count: augResult.count, fetched: augResult.fetched },
          september: { count: sepResult.count, fetched: sepResult.fetched },
          members: { count: membersResult.count, fetched: membersResult.fetched },
        },
        criteria: {
          august: `2026-08 利用 ${MIN_AUG_SESSIONS}回以上（予約件数・キャンセル除外）`,
          september: `2026-09-09 〜 2026-09-30 ${MIN_SEP_RESERVATIONS}回以上予約（9/1〜9/8除外・キャンセル除外）`,
        },
        memberCount: results.length,
        storeBreakdown: countByStore(results),
        members: results,
      },
      null,
      2,
    ),
  );

  console.log("\n--- 一覧 ---");
  console.log(
    "| # | 会員コード | 氏名 | 所属店 | 8月利用 | 8月枠 | 9/9〜予約数 | 9/9〜枠 | 9/1〜8予約 | 9月合計予約 | 9月合計枠 |",
  );
  console.log("|---:|---|---|---|---:|---:|---:|---:|---:|---:|---:|");
  results.forEach((r, i) => {
    console.log(
      `| ${i + 1} | ${r.memberCode} | ${r.displayName} | ${r.homeStore ?? "—"} | ${r.augSessionCount} | ${r.augSlotCount} | ${r.sep9to30ReservationCount} | ${r.sep9to30SlotCount} | ${r.sep1to8ReservationCount} | ${r.sepTotalReservationCount} | ${r.sepTotalSlotCount} |`,
    );
  });

  console.log("\n--- 店舗別 ---");
  for (const [store, n] of Object.entries(countByStore(results)).sort((a, b) => b[1] - a[1])) {
    console.log(`${store}: ${n}`);
  }

  const sep1to8Low = results.filter((r) => r.sep1to8ReservationCount <= 1);
  const sep1to8Zero = sep1to8Low.filter((r) => r.sep1to8ReservationCount === 0);
  const sep1to8One = sep1to8Low.filter((r) => r.sep1to8ReservationCount === 1);
  const sep1to8Two = results.filter((r) => r.sep1to8ReservationCount === 2);

  const printSep1to8Subset = (title, subset) => {
    console.log(`\n--- ${title} ---`);
    console.log(`該当: ${subset.length}名`);
    console.log(
      "| # | 会員コード | 氏名 | 所属店 | 8月利用 | 9/1〜8予約 | 9/9〜予約 | 9月合計 |",
    );
    console.log("|---:|---|---|---|---:|---:|---:|---:|");
    subset.forEach((r, i) => {
      console.log(
        `| ${i + 1} | ${r.memberCode} | ${r.displayName} | ${r.homeStore ?? "—"} | ${r.augSessionCount} | ${r.sep1to8ReservationCount} | ${r.sep9to30ReservationCount} | ${r.sepTotalReservationCount} |`,
      );
    });
  };

  printSep1to8Subset("9/1〜9/8 が0回または1回のみ（上記一覧から）", sep1to8Low);
  console.log(`内訳: 0回 ${sep1to8Zero.length}名 / 1回 ${sep1to8One.length}名`);
  printSep1to8Subset("9/1〜9/8 が2回（上記一覧から）", sep1to8Two);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
