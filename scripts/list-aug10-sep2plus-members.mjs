/**
 * 8月10回以上利用 かつ 9月2枠以上予約の会員を抽出
 * node --env-file=.env.local scripts/list-aug10-sep2plus-members.mjs
 */
import { createClient } from "@supabase/supabase-js";

const AUG_MONTH = "2026-08";
const SEP_MONTH = "2026-09";
const MIN_AUG_SESSIONS = 10;
const MIN_SEP_SLOTS = 2;
const TZ = "Asia/Tokyo";
const SLOT_MIN = 30;

function slotCount(startAt, endAt) {
  const ms = new Date(endAt).getTime() - new Date(startAt).getTime();
  if (ms <= 0) return 0;
  return Math.max(1, Math.round(ms / (SLOT_MIN * 60 * 1000)));
}

function monthBounds(month) {
  const lastDay = month === "2026-08" ? "31" : "30";
  return {
    start: `${month}-01T00:00:00+09:00`,
    end: `${month}-${lastDay}T23:59:59+09:00`,
  };
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

async function fetchReservations(supabase, monthStart, monthEnd) {
  const selectWithBlocks =
    "id, member_id, store_id, trainer_id, start_at, end_at, status, blocks_capacity, session_type";
  const selectLegacy = "id, member_id, store_id, trainer_id, start_at, end_at, status, session_type";

  let { data, error } = await supabase
    .from("reservations")
    .select(selectWithBlocks)
    .gte("start_at", monthStart)
    .lte("start_at", monthEnd)
    .not("member_id", "is", null);

  if (error?.message?.match(/blocks_capacity|does not exist|column/i)) {
    const second = await supabase
      .from("reservations")
      .select(selectLegacy)
      .gte("start_at", monthStart)
      .lte("start_at", monthEnd)
      .not("member_id", "is", null);
    data = second.data;
    error = second.error;
  }
  if (error) throw error;

  return (data ?? []).filter(
    (r) => String(r.status).toLowerCase() !== "cancelled" && r.blocks_capacity !== false,
  );
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("DB未接続");
    process.exit(1);
  }

  const supabase = createClient(url, key, { auth: { persistSession: false } });

  const augBounds = monthBounds(AUG_MONTH);
  const sepBounds = monthBounds(SEP_MONTH);

  const [augReservations, sepReservations] = await Promise.all([
    fetchReservations(supabase, augBounds.start, augBounds.end),
    fetchReservations(supabase, sepBounds.start, sepBounds.end),
  ]);

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

  const { data: members } = await supabase
    .from("members")
    .select("id, member_code, display_name, name, store_id, membership_status")
    .in("id", candidateIds.length ? candidateIds : ["00000000-0000-0000-0000-000000000000"]);

  const memberById = Object.fromEntries((members ?? []).map((m) => [m.id, m]));

  const { data: stores } = await supabase.from("stores").select("id, name");
  const storeNameById = Object.fromEntries((stores ?? []).map((s) => [s.id, s.name]));

  const { data: trainers } = await supabase.from("trainers").select("id, display_name");
  const trainerNameById = Object.fromEntries((trainers ?? []).map((t) => [t.id, t.display_name]));

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

  console.log(
    JSON.stringify(
      {
        criteria: {
          august: `${AUG_MONTH} 利用 ${MIN_AUG_SESSIONS}回以上（予約件数・キャンセル除外）`,
          september: `${SEP_MONTH} 予約 ${MIN_SEP_SLOTS}枠以上（30分単位・キャンセル除外）`,
        },
        memberCount: results.length,
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
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
