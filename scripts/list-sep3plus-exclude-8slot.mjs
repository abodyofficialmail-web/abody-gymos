/**
 * 9月2日〜30日で3枠以上予約の会員から、8枠先取り案内済み（31名）を除外
 * ※9月1日分だけで3枠に達する場合は対象外
 * node --env-file=.env.local scripts/list-sep3plus-exclude-8slot.mjs
 */
import { createClient } from "@supabase/supabase-js";
import { fetchAllChecked } from "./lib/supabaseFetchAll.mjs";

const MIN_SEP_SLOTS = 3;
const SLOT_MIN = 30;

const AUG_START = "2026-08-01T00:00:00+09:00";
const AUG_END = "2026-09-01T00:00:00+09:00";

const SEP_FETCH_START = "2026-09-01T00:00:00+09:00";
const SEP_FETCH_END = "2026-10-01T00:00:00+09:00";
/** 枠数カウント対象: 9/2 0:00 〜 9/30（9/1は除外） */
const COUNT_START = "2026-09-02T00:00:00+09:00";
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

  const augCountByMember = new Map();
  for (const r of augResult.rows) {
    augCountByMember.set(r.member_id, (augCountByMember.get(r.member_id) ?? 0) + 1);
  }

  const sepByMember = new Map();
  for (const r of sepResult.rows) {
    const list = sepByMember.get(r.member_id) ?? [];
    list.push(r);
    sepByMember.set(r.member_id, list);
  }

  const memberById = Object.fromEntries(membersResult.rows.map((m) => [m.id, m]));
  const storeNameById = Object.fromEntries(storesResult.rows.map((s) => [s.id, s.name]));

  const sep3plusSep2to30 = [];
  const excludedBySep1Only = [];

  for (const [memberId, resList] of sepByMember) {
    const sep1Slots = countSlotsInRange(resList, SEP_FETCH_START, COUNT_START);
    const sep2to30Slots = countSlotsInRange(resList, COUNT_START, COUNT_END);
    const sepTotalSlots = countSlotsInRange(resList, SEP_FETCH_START, SEP_FETCH_END);

    if (sep2to30Slots < MIN_SEP_SLOTS) {
      if (sepTotalSlots >= MIN_SEP_SLOTS && sep2to30Slots < MIN_SEP_SLOTS) {
        const m = memberById[memberId];
        excludedBySep1Only.push({
          memberCode: String(m?.member_code ?? "").toUpperCase(),
          displayName: m?.display_name ?? m?.name ?? "—",
          homeStore: storeNameById[m?.store_id] ?? null,
          augSessionCount: augCountByMember.get(memberId) ?? 0,
          sep1Slots,
          sep2to30Slots,
          sepTotalSlots,
        });
      }
      continue;
    }

    const m = memberById[memberId];
    sep3plusSep2to30.push({
      memberCode: String(m?.member_code ?? "").toUpperCase(),
      displayName: m?.display_name ?? m?.name ?? "—",
      homeStore: storeNameById[m?.store_id] ?? null,
      augSessionCount: augCountByMember.get(memberId) ?? 0,
      sep2to30SlotCount: sep2to30Slots,
      sep2to30ReservationCount: countReservationsInRange(resList, COUNT_START, COUNT_END),
      sep1SlotCount: sep1Slots,
      sepTotalSlotCount: sepTotalSlots,
    });
  }

  sep3plusSep2to30.sort(
    (a, b) =>
      b.sep2to30SlotCount - a.sep2to30SlotCount ||
      String(a.memberCode).localeCompare(String(b.memberCode)),
  );

  const excluded8slot = sep3plusSep2to30.filter((m) =>
    EXCLUDE_8SLOT_GUIDANCE_CODES.has(m.memberCode),
  );
  const remaining = sep3plusSep2to30.filter(
    (m) => !EXCLUDE_8SLOT_GUIDANCE_CODES.has(m.memberCode),
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
          countPeriod: "2026-09-02 〜 2026-09-30（9/1の予約は枠数カウントに含めない）",
          minSlots: MIN_SEP_SLOTS,
          exclude: "8枠先取り案内済み31名（send-june-low-booking-line.mjs）",
        },
        sep3plusSep2to30Count: sep3plusSep2to30.length,
        excludedBySep1OnlyCount: excludedBySep1Only.length,
        excluded8slotGuidanceCount: excluded8slot.length,
        remainingCount: remaining.length,
        excludedBySep1Only,
        excluded8slotMembers: excluded8slot,
        storeBreakdown: countByStore(remaining),
        remainingMembers: remaining,
      },
      null,
      2,
    ),
  );

  console.log("\n--- サマリー ---");
  console.log(`9/2〜9/30で3枠以上: ${sep3plusSep2to30.length}名`);
  console.log(`（参考）9/1分込みで3枠以上だが9/2〜は未満で除外: ${excludedBySep1Only.length}名`);
  console.log(`8枠案内済みで除外: ${excluded8slot.length}名`);
  console.log(`最終: ${remaining.length}名`);

  if (excludedBySep1Only.length) {
    console.log("\n--- 9/1分のみで3枠達成のため除外 ---");
    for (const m of excludedBySep1Only) {
      console.log(
        `${m.memberCode} ${m.displayName} (9/1:${m.sep1Slots}枠 9/2〜:${m.sep2to30Slots}枠 合計:${m.sepTotalSlots}枠)`,
      );
    }
  }

  console.log("\n--- 一覧（9/2〜9/30で3枠以上・8枠案内済み除外） ---");
  console.log("| # | 会員コード | 氏名 | 所属店 | 8月利用 | 9/2〜枠 | 9/2〜予約数 | 9/1枠 | 9月合計枠 |");
  console.log("|---:|---|---|---|---:|---:|---:|---:|---:|");
  remaining.forEach((r, i) => {
    console.log(
      `| ${i + 1} | ${r.memberCode} | ${r.displayName} | ${r.homeStore ?? "—"} | ${r.augSessionCount} | ${r.sep2to30SlotCount} | ${r.sep2to30ReservationCount} | ${r.sep1SlotCount} | ${r.sepTotalSlotCount} |`,
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
