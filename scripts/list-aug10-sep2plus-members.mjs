/**
 * 8月10回以上利用 かつ 9月2枠以上予約の会員を抽出（ページング対応）
 * node --env-file=.env.local scripts/list-aug10-sep2plus-members.mjs
 */
import { createClient } from "@supabase/supabase-js";
import { fetchAllChecked } from "./lib/supabaseFetchAll.mjs";

const MIN_AUG_SESSIONS = 10;
const MIN_SEP_SLOTS = 2;
const TZ = "Asia/Tokyo";
const SLOT_MIN = 30;

const AUG_START = "2026-08-01T00:00:00+09:00";
const AUG_END = "2026-09-01T00:00:00+09:00";
const SEP_START = "2026-09-01T00:00:00+09:00";
const SEP_END = "2026-10-01T00:00:00+09:00";

function slotCount(startAt, endAt) {
  const ms = new Date(endAt).getTime() - new Date(startAt).getTime();
  if (ms <= 0) return 0;
  return Math.max(1, Math.round(ms / (SLOT_MIN * 60 * 1000)));
}

function localDateTime(iso) {
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: TZ,
    month: "numeric",
    day: "numeric",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}

async function fetchReservations(supabase, rangeStart, rangeEnd, label) {
  const select =
    "id, member_id, store_id, trainer_id, start_at, end_at, status, session_type";

  return fetchAllChecked(
    supabase,
    "reservations",
    select,
    (q) =>
      q
        .gte("start_at", rangeStart)
        .lt("start_at", rangeEnd)
        .neq("status", "cancelled")
        .not("member_id", "is", null),
    label,
  );
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

  const [augResult, sepResult, membersResult, storesResult, trainersResult] = await Promise.all([
    fetchReservations(supabase, AUG_START, AUG_END, "reservations.august"),
    fetchReservations(supabase, SEP_START, SEP_END, "reservations.september"),
    fetchAllChecked(
      supabase,
      "members",
      "id, member_code, display_name, name, store_id, membership_status",
      undefined,
      "members",
    ),
    fetchAllChecked(supabase, "stores", "id, name", undefined, "stores"),
    fetchAllChecked(supabase, "trainers", "id, display_name", undefined, "trainers"),
  ]);

  const augReservations = augResult.rows;
  const sepReservations = sepResult.rows;

  const fetched = {
    august: { count: augResult.count, fetched: augResult.fetched },
    september: { count: sepResult.count, fetched: sepResult.fetched },
    members: { count: membersResult.count, fetched: membersResult.fetched },
  };

  const augByMember = new Map();
  for (const r of augReservations) {
    const list = augByMember.get(r.member_id) ?? [];
    list.push(r);
    augByMember.set(r.member_id, list);
  }

  const sepByMember = new Map();
  for (const r of sepReservations) {
    const list = sepByMember.get(r.member_id) ?? [];
    list.push(r);
    sepByMember.set(r.member_id, list);
  }

  const candidateIds = [...augByMember.keys()].filter((id) => {
    const augCount = augByMember.get(id)?.length ?? 0;
    if (augCount < MIN_AUG_SESSIONS) return false;
    const sepList = sepByMember.get(id) ?? [];
    const sepSlots = sepList.reduce((s, r) => s + slotCount(r.start_at, r.end_at), 0);
    return sepSlots >= MIN_SEP_SLOTS;
  });

  const memberById = Object.fromEntries(membersResult.rows.map((m) => [m.id, m]));
  const storeNameById = Object.fromEntries(storesResult.rows.map((s) => [s.id, s.name]));
  const trainerNameById = Object.fromEntries(trainersResult.rows.map((t) => [t.id, t.display_name]));

  const results = candidateIds.map((memberId) => {
    const augList = augByMember.get(memberId) ?? [];
    const sepList = sepByMember.get(memberId) ?? [];
    const m = memberById[memberId];
    const augSessionCount = augList.length;
    const sepReservationCount = sepList.length;
    const sepSlotCount = sepList.reduce((s, r) => s + slotCount(r.start_at, r.end_at), 0);

    const sepBookings = sepList
      .slice()
      .sort((a, b) => a.start_at.localeCompare(b.start_at))
      .map((r) => ({
        dateTime: localDateTime(r.start_at),
        store: storeNameById[r.store_id] ?? r.store_id,
        trainer: r.trainer_id ? (trainerNameById[r.trainer_id] ?? "—") : "—",
        slots: slotCount(r.start_at, r.end_at),
      }));

    return {
      memberCode: m?.member_code ?? "—",
      displayName: m?.display_name ?? m?.name ?? "—",
      homeStore: storeNameById[m?.store_id] ?? null,
      membershipStatus: m?.membership_status ?? null,
      augSessionCount,
      sepReservationCount,
      sepSlotCount,
      sepBookings,
    };
  });

  results.sort(
    (a, b) =>
      b.sepSlotCount - a.sepSlotCount ||
      b.augSessionCount - a.augSessionCount ||
      String(a.memberCode).localeCompare(String(b.memberCode)),
  );

  const storeBreakdown = countByStore(results);

  console.log(
    JSON.stringify(
      {
        fetched,
        criteria: {
          august: `2026-08 利用 ${MIN_AUG_SESSIONS}回以上（予約件数・SQLでキャンセル除外）`,
          september: `2026-09 予約 ${MIN_SEP_SLOTS}枠以上（30分単位・SQLでキャンセル除外）`,
        },
        memberCount: results.length,
        storeBreakdown,
        members: results,
      },
      null,
      2,
    ),
  );

  console.log("\n--- 一覧 ---");
  console.log("| # | 会員コード | 氏名 | 所属店 | 8月利用 | 9月枠 | 9月予約数 |");
  console.log("|---:|---|---|---|---:|---:|---:|");
  results.forEach((r, i) => {
    console.log(
      `| ${i + 1} | ${r.memberCode} | ${r.displayName} | ${r.homeStore ?? "—"} | ${r.augSessionCount} | ${r.sepSlotCount} | ${r.sepReservationCount} |`,
    );
  });

  console.log("\n--- 店舗別 ---");
  for (const [store, n] of Object.entries(storeBreakdown).sort((a, b) => b[1] - a[1])) {
    console.log(`${store}: ${n}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
