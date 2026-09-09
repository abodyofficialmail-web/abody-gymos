/**
 * 8月8回以上 かつ 9月0〜2回利用 かつ 9/9以降予約なし の会員を抽出
 * node --env-file=.env.local scripts/list-aug8-sep-low-no-future.mjs
 */
import { createClient } from "@supabase/supabase-js";
import { fetchAllChecked } from "./lib/supabaseFetchAll.mjs";

const MIN_AUG_SESSIONS = 8;
const MAX_SEP_TOTAL = 2;
const SLOT_MIN = 30;

const AUG_START = "2026-08-01T00:00:00+09:00";
const AUG_END = "2026-09-01T00:00:00+09:00";
const SEP_START = "2026-09-01T00:00:00+09:00";
const SEP_END = "2026-10-01T00:00:00+09:00";
const SEP9_START = "2026-09-09T00:00:00+09:00";

function inRange(iso, start, end) {
  const t = new Date(iso).getTime();
  return t >= new Date(start).getTime() && t < new Date(end).getTime();
}

function countReservationsInRange(resList, rangeStart, rangeEnd) {
  return resList.filter((r) => inRange(r.start_at, rangeStart, rangeEnd)).length;
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
    if (augList.length < MIN_AUG_SESSIONS) continue;

    const sepList = sepByMember.get(memberId) ?? [];
    const sepTotal = sepList.length;
    const sep1to8 = countReservationsInRange(sepList, SEP_START, SEP9_START);
    const sep9plus = countReservationsInRange(sepList, SEP9_START, SEP_END);

    if (sepTotal > MAX_SEP_TOTAL) continue;
    if (sep9plus > 0) continue;

    const m = memberById[memberId];
    results.push({
      memberCode: String(m?.member_code ?? "").toUpperCase(),
      displayName: m?.display_name ?? m?.name ?? "—",
      homeStore: storeNameById[m?.store_id] ?? null,
      augSessionCount: augList.length,
      sepTotalReservationCount: sepTotal,
      sep1to8ReservationCount: sep1to8,
      sep9plusReservationCount: sep9plus,
    });
  }

  results.sort(
    (a, b) =>
      a.sepTotalReservationCount - b.sepTotalReservationCount ||
      b.augSessionCount - a.augSessionCount ||
      String(a.memberCode).localeCompare(String(b.memberCode)),
  );

  console.log(
    JSON.stringify(
      {
        criteria: {
          august: `2026-08 利用 ${MIN_AUG_SESSIONS}回以上`,
          september: `2026-09 合計 ${MAX_SEP_TOTAL}回以下（0〜2回）`,
          sep9plus: "2026-09-09 以降 予約0件",
        },
        memberCount: results.length,
        members: results,
      },
      null,
      2,
    ),
  );

  console.log("\n--- 該当者 ---");
  if (!results.length) {
    console.log("該当者なし");
  } else {
    console.log("| # | 会員コード | 氏名 | 所属店 | 8月利用 | 9月合計 | 9/1〜8 | 9/9〜 |");
    console.log("|---:|---|---|---|---:|---:|---:|---:|");
    results.forEach((r, i) => {
      console.log(
        `| ${i + 1} | ${r.memberCode} | ${r.displayName} | ${r.homeStore ?? "—"} | ${r.augSessionCount} | ${r.sepTotalReservationCount} | ${r.sep1to8ReservationCount} | ${r.sep9plusReservationCount} |`,
      );
    });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
