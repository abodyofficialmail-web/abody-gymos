/**
 * 9月に予約2枠以上の会員を抽出
 * node --env-file=.env.local scripts/list-multi-booking-members-2026-09.mjs
 */
import { createClient } from "@supabase/supabase-js";

const MONTH = "2026-09";
const MIN_SLOTS = 2;
const TZ = "Asia/Tokyo";
const SLOT_MIN = 30;

function slotCount(startAt, endAt) {
  const ms = new Date(endAt).getTime() - new Date(startAt).getTime();
  if (ms <= 0) return 0;
  return Math.max(1, Math.round(ms / (SLOT_MIN * 60 * 1000)));
}

function localDateTime(iso) {
  const fmt = new Intl.DateTimeFormat("ja-JP", {
    timeZone: TZ,
    month: "numeric",
    day: "numeric",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  return fmt.format(new Date(iso));
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("DB未接続");
    process.exit(1);
  }

  const supabase = createClient(url, key, { auth: { persistSession: false } });

  const monthStart = `${MONTH}-01T00:00:00+09:00`;
  const monthEnd = `${MONTH}-30T23:59:59+09:00`;

  let { data: reservations, error } = await supabase
    .from("reservations")
    .select("id, member_id, store_id, trainer_id, start_at, end_at, status, blocks_capacity, session_type")
    .gte("start_at", monthStart)
    .lte("start_at", monthEnd)
    .not("member_id", "is", null);

  if (error) throw error;

  const active = (reservations ?? []).filter(
    (r) => String(r.status).toLowerCase() !== "cancelled" && r.blocks_capacity !== false,
  );

  const byMember = new Map();
  for (const r of active) {
    const mid = r.member_id;
    const list = byMember.get(mid) ?? [];
    list.push(r);
    byMember.set(mid, list);
  }

  const memberIds = [...byMember.keys()];
  const { data: members } = await supabase
    .from("members")
    .select("id, member_code, display_name, name, store_id, membership_status")
    .in("id", memberIds.length ? memberIds : ["00000000-0000-0000-0000-000000000000"]);

  const memberById = Object.fromEntries((members ?? []).map((m) => [m.id, m]));

  const { data: stores } = await supabase.from("stores").select("id, name");
  const storeNameById = Object.fromEntries((stores ?? []).map((s) => [s.id, s.name]));

  const { data: trainers } = await supabase.from("trainers").select("id, display_name");
  const trainerNameById = Object.fromEntries((trainers ?? []).map((t) => [t.id, t.display_name]));

  const results = [];

  for (const [memberId, resList] of byMember) {
    const reservationCount = resList.length;
    const slotTotal = resList.reduce((s, r) => s + slotCount(r.start_at, r.end_at), 0);

    if (slotTotal < MIN_SLOTS) continue;

    const m = memberById[memberId];
    const homeStore = storeNameById[m?.store_id] ?? null;

    const bookings = resList
      .slice()
      .sort((a, b) => a.start_at.localeCompare(b.start_at))
      .map((r) => ({
        dateTime: localDateTime(r.start_at),
        store: storeNameById[r.store_id] ?? r.store_id,
        trainer: r.trainer_id ? (trainerNameById[r.trainer_id] ?? "—") : "—",
        sessionType: r.session_type ?? null,
      }));

    const storeBreakdown = {};
    for (const r of resList) {
      const sn = storeNameById[r.store_id] ?? "不明";
      storeBreakdown[sn] = (storeBreakdown[sn] ?? 0) + slotCount(r.start_at, r.end_at);
    }

    results.push({
      memberCode: m?.member_code ?? "—",
      displayName: m?.display_name ?? m?.name ?? "—",
      homeStore,
      membershipStatus: m?.membership_status ?? null,
      reservationCount,
      slotCount: slotTotal,
      storeBreakdown,
      bookings,
    });
  }

  results.sort((a, b) => b.slotCount - a.slotCount || b.reservationCount - a.reservationCount);

  console.log(
    JSON.stringify(
      {
        month: MONTH,
        criteria: `予約枠（30分単位）が ${MIN_SLOTS} 以上（キャンセル除外・会員のみ）`,
        memberCount: results.length,
        members: results,
      },
      null,
      2,
    ),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
