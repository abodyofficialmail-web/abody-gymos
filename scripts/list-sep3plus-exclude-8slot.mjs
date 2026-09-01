/**
 * 9月3枠以上予約の会員から、8枠先取り案内済み（31名）を除外
 * node --env-file=.env.local scripts/list-sep3plus-exclude-8slot.mjs
 */
import { createClient } from "@supabase/supabase-js";
import { fetchAllChecked } from "./lib/supabaseFetchAll.mjs";

const MIN_SEP_SLOTS = 3;
const TZ = "Asia/Tokyo";
const SLOT_MIN = 30;

const SEP_START = "2026-09-01T00:00:00+09:00";
const SEP_END = "2026-10-01T00:00:00+09:00";

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

  const [sepResult, membersResult, storesResult] = await Promise.all([
    fetchAllChecked(
      supabase,
      "reservations",
      "id, member_id, store_id, start_at, end_at, status",
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

  const sepByMember = new Map();
  for (const r of sepResult.rows) {
    const list = sepByMember.get(r.member_id) ?? [];
    list.push(r);
    sepByMember.set(r.member_id, list);
  }

  const memberById = Object.fromEntries(membersResult.rows.map((m) => [m.id, m]));
  const storeNameById = Object.fromEntries(storesResult.rows.map((s) => [s.id, s.name]));

  const sep3plus = [];
  for (const [memberId, resList] of sepByMember) {
    const slotTotal = resList.reduce((s, r) => s + slotCount(r.start_at, r.end_at), 0);
    if (slotTotal < MIN_SEP_SLOTS) continue;
    const m = memberById[memberId];
    sep3plus.push({
      memberCode: String(m?.member_code ?? "").toUpperCase(),
      displayName: m?.display_name ?? m?.name ?? "—",
      homeStore: storeNameById[m?.store_id] ?? null,
      sepSlotCount: slotTotal,
      sepReservationCount: resList.length,
    });
  }

  sep3plus.sort(
    (a, b) =>
      b.sepSlotCount - a.sepSlotCount ||
      String(a.memberCode).localeCompare(String(b.memberCode)),
  );

  const excluded = sep3plus.filter((m) => EXCLUDE_8SLOT_GUIDANCE_CODES.has(m.memberCode));
  const remaining = sep3plus.filter((m) => !EXCLUDE_8SLOT_GUIDANCE_CODES.has(m.memberCode));

  console.log(
    JSON.stringify(
      {
        fetched: {
          september: { count: sepResult.count, fetched: sepResult.fetched },
          members: { count: membersResult.count, fetched: membersResult.fetched },
        },
        criteria: {
          september: `2026-09 予約 ${MIN_SEP_SLOTS}枠以上（30分単位・キャンセル除外）`,
          exclude: "8枠先取り案内済み31名（send-june-low-booking-line.mjs）",
        },
        sep3plusCount: sep3plus.length,
        excluded8slotGuidanceCount: excluded.length,
        remainingCount: remaining.length,
        excludedMembers: excluded,
        storeBreakdown: {
          sep3plus: countByStore(sep3plus),
          remaining: countByStore(remaining),
        },
        remainingMembers: remaining,
      },
      null,
      2,
    ),
  );

  console.log("\n--- サマリー ---");
  console.log(`9月3枠以上: ${sep3plus.length}名`);
  console.log(`8枠案内済みで除外: ${excluded.length}名`);
  console.log(`除外後: ${remaining.length}名`);

  if (excluded.length) {
    console.log("\n--- 除外された会員（9月3枠以上かつ8枠案内済み） ---");
    for (const m of excluded) {
      console.log(`${m.memberCode} ${m.displayName} (${m.homeStore}) 9月${m.sepSlotCount}枠`);
    }
  }

  console.log("\n--- 除外後一覧 ---");
  console.log("| # | 会員コード | 氏名 | 所属店 | 9月枠 | 9月予約数 |");
  console.log("|---:|---|---|---|---:|---:|");
  remaining.forEach((r, i) => {
    console.log(
      `| ${i + 1} | ${r.memberCode} | ${r.displayName} | ${r.homeStore ?? "—"} | ${r.sepSlotCount} | ${r.sepReservationCount} |`,
    );
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
