/**
 * 在籍会員のうち
 * - 9/1〜16 来店 0〜5回
 * - 9/17〜30 予約 0〜5回
 * node scripts/list-sep1-16-and-sep17-30-visits-0to5-members.mjs
 */
import { createClient } from "@supabase/supabase-js";
import { fetchAllChecked } from "./lib/supabaseFetchAll.mjs";

const MAX_VISITS = 5;
const SEP_START = "2026-09-01T00:00:00+09:00";
const SEP16_END = "2026-09-17T00:00:00+09:00";
const SEP17_START = "2026-09-17T00:00:00+09:00";
const SEP_END = "2026-10-01T00:00:00+09:00";

function isActiveMember(m) {
  const ms = String(m.membership_status ?? "").toLowerCase();
  if (ms === "active") return true;
  if (ms === "hiatus" || ms === "withdrawn") return false;
  return m.is_active === true;
}

function inRange(iso, start, end) {
  const t = new Date(iso).getTime();
  return t >= new Date(start).getTime() && t < new Date(end).getTime();
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

  const [resResult, membersResult, storesResult] = await Promise.all([
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
      "id, member_code, display_name, name, store_id, is_active, membership_status",
      undefined,
      "members",
    ),
    fetchAllChecked(supabase, "stores", "id, name", undefined, "stores"),
  ]);

  const byMember = new Map();
  for (const r of resResult.rows) {
    const list = byMember.get(r.member_id) ?? [];
    list.push(r);
    byMember.set(r.member_id, list);
  }

  const storeNameById = Object.fromEntries(storesResult.rows.map((s) => [s.id, s.name]));

  const results = [];
  let excludedMembership = 0;
  let excludedSep1to16 = 0;
  let excludedSep17to30 = 0;

  for (const m of membersResult.rows) {
    if (!isActiveMember(m)) {
      excludedMembership += 1;
      continue;
    }

    const list = byMember.get(m.id) ?? [];
    const sep1to16 = list.filter((r) => inRange(r.start_at, SEP_START, SEP16_END)).length;
    const sep17to30 = list.filter((r) => inRange(r.start_at, SEP17_START, SEP_END)).length;

    if (sep1to16 > MAX_VISITS) {
      excludedSep1to16 += 1;
      continue;
    }
    if (sep17to30 > MAX_VISITS) {
      excludedSep17to30 += 1;
      continue;
    }

    results.push({
      memberCode: String(m.member_code ?? "").toUpperCase(),
      displayName: m.display_name ?? m.name ?? "—",
      homeStore: storeNameById[m.store_id] ?? null,
      visitCountSep1to16: sep1to16,
      visitCountSep17to30: sep17to30,
      visitCountSeptemberTotal: sep1to16 + sep17to30,
    });
  }

  results.sort(
    (a, b) =>
      a.visitCountSeptemberTotal - b.visitCountSeptemberTotal ||
      a.visitCountSep17to30 - b.visitCountSep17to30 ||
      a.visitCountSep1to16 - b.visitCountSep1to16 ||
      String(a.memberCode).localeCompare(String(b.memberCode)),
  );

  console.log(
    JSON.stringify(
      {
        criteria: {
          membership: "在籍会員のみ（退会・休会除外）",
          sep1to16: "0〜5回（start_at・キャンセル除外）",
          sep17to30: "0〜5回（start_at・キャンセル除外）",
        },
        excludedMembershipCount: excludedMembership,
        excludedSep1to16Over5: excludedSep1to16,
        excludedSep17to30Over5: excludedSep17to30,
        memberCount: results.length,
        storeBreakdown: countByStore(results),
        members: results,
      },
      null,
      2,
    ),
  );

  console.log("\n--- サマリー ---");
  console.log(`該当: ${results.length}名`);
  console.log(`除外: 退会・休会 ${excludedMembership} / 9/1〜16が6回以上 ${excludedSep1to16} / 9/17〜30が6回以上 ${excludedSep17to30}`);

  console.log("\n--- 一覧 ---");
  console.log("| # | 会員コード | 氏名 | 所属店 | 9/1〜16 | 9/17〜30 | 9月合計 |");
  console.log("|---:|---|---|---|---:|---:|---:|");
  results.forEach((r, i) => {
    console.log(
      `| ${i + 1} | ${r.memberCode} | ${r.displayName} | ${r.homeStore ?? "—"} | ${r.visitCountSep1to16} | ${r.visitCountSep17to30} | ${r.visitCountSeptemberTotal} |`,
    );
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
