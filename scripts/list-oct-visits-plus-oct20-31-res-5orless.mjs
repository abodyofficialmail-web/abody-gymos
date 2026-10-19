/**
 * 在籍会員のうち、10月の来店回数 + 10/20〜31の予約回数が5回以下
 * 来店 = 2026-10-01〜19 のキャンセル以外の予約件数
 * 予約 = 2026-10-20〜31 のキャンセル以外の予約件数
 * 休会・退会は除外
 * node scripts/list-oct-visits-plus-oct20-31-res-5orless.mjs
 */
import { createClient } from "@supabase/supabase-js";
import { DateTime } from "luxon";
import { fetchAllChecked } from "./lib/supabaseFetchAll.mjs";

const MAX_TOTAL = 5;
const VISIT_START = "2026-10-01T00:00:00+09:00";
const RES_START = "2026-10-20T00:00:00+09:00";
const RANGE_END = "2026-11-01T00:00:00+09:00";
const TZ = "Asia/Tokyo";

function isActiveMember(m) {
  const ms = String(m.membership_status ?? "").toLowerCase();
  if (ms === "active") return true;
  if (ms === "hiatus" || ms === "withdrawn") return false;
  return m.is_active === true;
}

function fmtTimes(rows) {
  return rows
    .map((r) => DateTime.fromISO(r.start_at).setZone(TZ).toFormat("M/d HH:mm"))
    .sort((a, b) => a.localeCompare(b, "ja"))
    .join(", ");
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
          .gte("start_at", VISIT_START)
          .lt("start_at", RANGE_END)
          .neq("status", "cancelled")
          .not("member_id", "is", null),
      "reservations.oct",
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
  const resStartMs = new Date(RES_START).getTime();

  const results = [];
  let excludedMembership = 0;
  let activeMemberCount = 0;
  for (const m of membersResult.rows) {
    if (!isActiveMember(m)) {
      excludedMembership += 1;
      continue;
    }
    activeMemberCount += 1;
    const all = byMember.get(m.id) ?? [];
    const visits = all.filter((r) => new Date(r.start_at).getTime() < resStartMs);
    const reservations = all.filter((r) => new Date(r.start_at).getTime() >= resStartMs);
    const total = visits.length + reservations.length;
    if (total > MAX_TOTAL) continue;
    results.push({
      memberCode: String(m.member_code ?? "").toUpperCase(),
      displayName: m.display_name ?? m.name ?? "—",
      homeStore: storeNameById[m.store_id] ?? "",
      visitCount: visits.length,
      reservationCount: reservations.length,
      total,
      visitTimes: fmtTimes(visits),
      reservationTimes: fmtTimes(reservations),
    });
  }

  results.sort(
    (a, b) =>
      a.total - b.total ||
      a.visitCount - b.visitCount ||
      String(a.homeStore).localeCompare(String(b.homeStore), "ja") ||
      a.memberCode.localeCompare(b.memberCode),
  );

  const byTotal = {};
  const byStore = {};
  for (const r of results) {
    byTotal[r.total] = (byTotal[r.total] ?? 0) + 1;
    const store = r.homeStore || "不明";
    byStore[store] = (byStore[store] ?? 0) + 1;
  }

  const generatedAt = DateTime.now().setZone(TZ).toFormat("yyyy-MM-dd HH:mm");
  console.log(
    JSON.stringify(
      {
        generatedAt,
        criteria: "在籍会員。10/1〜19の来店回数 + 10/20〜31の予約回数 <= 5。キャンセル除外。休会・退会除外。",
        activeMemberCount,
        excludedMembership,
        fetchedReservations: resResult.count,
        matchCount: results.length,
        byTotal,
        byStore,
        results,
      },
      null,
      2,
    ),
  );

  console.log("\n--- TSV ---");
  console.log("会員番号\t名前\t店舗\t来店(10/1-19)\t予約(10/20-31)\t合計\t来店日時\t予約日時");
  for (const r of results) {
    console.log(
      [r.memberCode, r.displayName, r.homeStore, r.visitCount, r.reservationCount, r.total, r.visitTimes, r.reservationTimes].join(
        "\t",
      ),
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
