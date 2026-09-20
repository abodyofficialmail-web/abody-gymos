/**
 * 指定日（JST）・指定店舗以外で予約がある会員一覧
 * node scripts/list-reservations-on-date-exclude-store.mjs --date=2026-09-21 --exclude-store=福岡
 */
import { createClient } from "@supabase/supabase-js";
import { DateTime } from "luxon";
import { fetchAllChecked } from "./lib/supabaseFetchAll.mjs";

const TZ = "Asia/Tokyo";

function parseArgs(argv) {
  const dateArg = argv.find((a) => a.startsWith("--date="));
  const excludeArg = argv.find((a) => a.startsWith("--exclude-store="));
  const date = dateArg?.slice("--date=".length) ?? "2026-09-21";
  const excludeStore = excludeArg?.slice("--exclude-store=".length) ?? "福岡";
  return { date, excludeStore };
}

function formatJst(iso) {
  return DateTime.fromISO(iso).setZone(TZ).toFormat("HH:mm");
}

async function main() {
  const { date, excludeStore } = parseArgs(process.argv);
  const dayStart = `${date}T00:00:00+09:00`;
  const dayEnd = DateTime.fromISO(dayStart, { zone: TZ }).plus({ days: 1 }).toISO();

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("DB未接続");
    process.exit(1);
  }

  const supabase = createClient(url, key, { auth: { persistSession: false } });

  const storesResult = await fetchAllChecked(supabase, "stores", "id, name", undefined, "stores");
  const fukuokaIds = new Set(
    storesResult.rows.filter((s) => String(s.name).includes(excludeStore)).map((s) => s.id),
  );
  const storeNameById = Object.fromEntries(storesResult.rows.map((s) => [s.id, s.name]));

  const resResult = await fetchAllChecked(
    supabase,
    "reservations",
    "id, member_id, store_id, trainer_id, start_at, end_at, status, session_type",
    (q) =>
      q
        .gte("start_at", dayStart)
        .lt("start_at", dayEnd)
        .neq("status", "cancelled")
        .not("member_id", "is", null),
    "reservations.day",
  );

  const filtered = resResult.rows.filter((r) => !fukuokaIds.has(r.store_id));

  const memberIds = [...new Set(filtered.map((r) => r.member_id))];
  const trainerIds = [...new Set(filtered.map((r) => r.trainer_id).filter(Boolean))];

  const [membersResult, trainersResult] = await Promise.all([
    memberIds.length
      ? fetchAllChecked(
          supabase,
          "members",
          "id, member_code, display_name, name, store_id",
          (q) => q.in("id", memberIds),
          "members",
        )
      : { rows: [], count: 0, fetched: 0 },
    trainerIds.length
      ? fetchAllChecked(
          supabase,
          "trainers",
          "id, display_name",
          (q) => q.in("id", trainerIds),
          "trainers",
        )
      : { rows: [], count: 0, fetched: 0 },
  ]);

  const memberById = Object.fromEntries(membersResult.rows.map((m) => [m.id, m]));
  const trainerById = Object.fromEntries(trainersResult.rows.map((t) => [t.id, t.display_name]));

  const byMember = new Map();
  for (const r of filtered) {
    const list = byMember.get(r.member_id) ?? [];
    list.push(r);
    byMember.set(r.member_id, list);
  }

  const members = [];
  for (const [memberId, list] of byMember) {
    const m = memberById[memberId];
    list.sort((a, b) => a.start_at.localeCompare(b.start_at));
    const slots = list.map((r) => ({
      startAt: r.start_at,
      startJst: formatJst(r.start_at),
      endJst: formatJst(r.end_at),
      store: storeNameById[r.store_id] ?? "—",
      trainer: trainerById[r.trainer_id] ?? "—",
      sessionType: r.session_type,
    }));
    members.push({
      memberCode: String(m?.member_code ?? "").toUpperCase() || "—",
      memberName: m?.display_name ?? m?.name ?? "—",
      homeStore: storeNameById[m?.store_id] ?? "—",
      reservationCount: list.length,
      slots,
      slotsSummary: slots.map((s) => `${s.startJst}-${s.endJst} ${s.store}(${s.trainer})`).join(" / "),
    });
  }

  members.sort((a, b) => a.memberCode.localeCompare(b.memberCode));

  console.log(
    JSON.stringify(
      {
        dateJst: date,
        excludeStoreNameContains: excludeStore,
        excludedStoreIds: [...fukuokaIds],
        reservationRows: filtered.length,
        memberCount: members.length,
        members,
      },
      null,
      2,
    ),
  );

  console.log(`\n--- ${date}（JST）${excludeStore}以外で予約がある会員: ${members.length}名 / 予約 ${filtered.length}件 ---\n`);
  console.log("| # | 会員コード | 氏名 | 所属店 | 予約件数 | 予約（JST） |");
  console.log("|---:|---|---|---|---:|---|");
  members.forEach((r, i) => {
    console.log(
      `| ${i + 1} | ${r.memberCode} | ${r.memberName} | ${r.homeStore} | ${r.reservationCount} | ${r.slotsSummary.replace(/\|/g, "｜")} |`,
    );
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
