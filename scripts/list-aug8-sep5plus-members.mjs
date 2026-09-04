/**
 * 8月8枠以上 かつ 9/5〜9/30で3回以上予約の会員を抽出
 * node --env-file=.env.local scripts/list-aug8-sep5plus-members.mjs
 */
import { createClient } from "@supabase/supabase-js";
import { fetchAllChecked } from "./lib/supabaseFetchAll.mjs";

const MIN_AUG_SLOTS = 8;
const MIN_SEP_RESERVATIONS = 3;
const SLOT_MIN = 30;

const AUG_START = "2026-08-01T00:00:00+09:00";
const AUG_END = "2026-09-01T00:00:00+09:00";

const SEP_FETCH_START = "2026-09-01T00:00:00+09:00";
const SEP_FETCH_END = "2026-10-01T00:00:00+09:00";
/** 予約数カウント対象: 9/5 0:00 〜 9/30（9/1〜9/4は除外） */
const COUNT_START = "2026-09-05T00:00:00+09:00";
const COUNT_END = "2026-10-01T00:00:00+09:00";

/** 8コマ先取り案内済み scripts/send-june-low-booking-line.mjs と同期 */
const EXCLUDE_8SLOT_GUIDANCE_CODES = new Set([
  "EBI006", "EBI012", "EBI026", "EBI024", "EBI009", "EBI021", "EBI010", "EBI015", "EBI031",
  "SAK009", "SAK043", "SAK033", "SAK049", "SAK050", "SAK044", "SAK025", "SAK028", "SAK017", "SAK030",
  "UEN052", "UEN053", "UEN042", "UEN001", "UEN033", "UEN058", "UEN051", "UEN049", "UEN031",
  "UEN009", "UEN039", "UEN002",
]);

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
    const augSlotCount = augList.reduce((s, r) => s + slotCount(r.start_at, r.end_at), 0);
    if (augSlotCount < MIN_AUG_SLOTS) continue;

    const sepList = sepByMember.get(memberId) ?? [];
    const sep5to30ReservationCount = countReservationsInRange(sepList, COUNT_START, COUNT_END);
    if (sep5to30ReservationCount < MIN_SEP_RESERVATIONS) continue;

    const m = memberById[memberId];
    results.push({
      memberCode: String(m?.member_code ?? "").toUpperCase(),
      displayName: m?.display_name ?? m?.name ?? "—",
      homeStore: storeNameById[m?.store_id] ?? null,
      augSlotCount,
      augReservationCount: augList.length,
      sep5to30ReservationCount,
      sep5to30SlotCount: countSlotsInRange(sepList, COUNT_START, COUNT_END),
      sep1to4ReservationCount: countReservationsInRange(sepList, SEP_FETCH_START, COUNT_START),
      sepTotalReservationCount: sepList.length,
      sepTotalSlotCount: countSlotsInRange(sepList, SEP_FETCH_START, SEP_FETCH_END),
    });
  }

  results.sort(
    (a, b) =>
      b.sep5to30ReservationCount - a.sep5to30ReservationCount ||
      b.augSlotCount - a.augSlotCount ||
      String(a.memberCode).localeCompare(String(b.memberCode)),
  );

  const excluded8slot = results.filter((m) => EXCLUDE_8SLOT_GUIDANCE_CODES.has(m.memberCode));
  const remaining = results.filter((m) => !EXCLUDE_8SLOT_GUIDANCE_CODES.has(m.memberCode));

  console.log(
    JSON.stringify(
      {
        fetched: {
          august: { count: augResult.count, fetched: augResult.fetched },
          september: { count: sepResult.count, fetched: sepResult.fetched },
          members: { count: membersResult.count, fetched: membersResult.fetched },
        },
        criteria: {
          august: `2026-08 ${MIN_AUG_SLOTS}枠以上（30分単位・キャンセル除外）`,
          september: `2026-09-05 〜 2026-09-30 ${MIN_SEP_RESERVATIONS}回以上予約（9/1〜9/4除外・キャンセル除外）`,
          exclude: "8枠先取り案内済み31名（send-june-low-booking-line.mjs）",
        },
        memberCount: results.length,
        excluded8slotGuidanceCount: excluded8slot.length,
        remainingCount: remaining.length,
        excluded8slotMembers: excluded8slot,
        storeBreakdown: countByStore(remaining),
        remainingMembers: remaining,
        members: results,
      },
      null,
      2,
    ),
  );

  console.log("\n--- サマリー ---");
  console.log(`8月${MIN_AUG_SLOTS}枠以上 × 9/5〜9/30で${MIN_SEP_RESERVATIONS}回以上予約: ${results.length}名`);
  console.log(`8枠案内済みで除外: ${excluded8slot.length}名`);
  console.log(`最終: ${remaining.length}名`);

  if (excluded8slot.length) {
    console.log("\n--- 8枠案内済みで除外 ---");
    for (const m of excluded8slot) {
      console.log(`${m.memberCode} ${m.displayName}`);
    }
  }

  console.log("\n--- 一覧（8枠案内済み除外） ---");
  console.log(
    "| # | 会員コード | 氏名 | 所属店 | 8月枠 | 8月予約数 | 9/5〜予約数 | 9/5〜枠 | 9/1〜4予約 | 9月合計予約 | 9月合計枠 |",
  );
  console.log("|---:|---|---|---|---:|---:|---:|---:|---:|---:|---:|");
  remaining.forEach((r, i) => {
    console.log(
      `| ${i + 1} | ${r.memberCode} | ${r.displayName} | ${r.homeStore ?? "—"} | ${r.augSlotCount} | ${r.augReservationCount} | ${r.sep5to30ReservationCount} | ${r.sep5to30SlotCount} | ${r.sep1to4ReservationCount} | ${r.sepTotalReservationCount} | ${r.sepTotalSlotCount} |`,
    );
  });

  console.log("\n--- 店舗別 ---");
  for (const [store, n] of Object.entries(countByStore(remaining)).sort((a, b) => b[1] - a[1])) {
    console.log(`${store}: ${n}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
