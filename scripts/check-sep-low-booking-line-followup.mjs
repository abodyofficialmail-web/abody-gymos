/**
 * 9/9 低予約LINE送信後の予約経過確認（送信成功21名）
 * node scripts/check-sep-low-booking-line-followup.mjs
 */
import { createClient } from "@supabase/supabase-js";
import { fetchAllChecked } from "./lib/supabaseFetchAll.mjs";

/** 2026-09-09 本番送信開始（GitHub Actions UTC ≒ 19:31 JST） */
const LINE_SENT_AT = "2026-09-09T10:31:00.000Z";

const SEP_START = "2026-09-01T00:00:00+09:00";
const SEP_END = "2026-10-01T00:00:00+09:00";

/** 本番送信成功21名（FUK012は429失敗、LINE未連携5名は除外） */
const SENT_SUCCESS_CODES = [
  "UEN012", "SAK036", "SHI001", "SAK053", "EBI027", "SAK011", "SAK047", "SAK050",
  "SHI003", "SHI012", "UEN014", "UEN042", "UEN050", "SAK009", "EBI009", "UEN039",
  "EBI002", "EBI026", "UEN031", "UEN053", "SAK061",
];

const NOT_SENT_CODES = [
  { code: "FUK012", reason: "line_push_failed_429" },
  { code: "FUK001", reason: "no_line_user_id" },
  { code: "UEN022", reason: "no_line_user_id" },
  { code: "UEN024", reason: "no_line_user_id" },
  { code: "UEN057", reason: "no_line_user_id" },
  { code: "ZAI001", reason: "no_line_user_id" },
];

const SLOT_MIN = 30;

function slotCount(startAt, endAt) {
  const ms = new Date(endAt).getTime() - new Date(startAt).getTime();
  if (ms <= 0) return 0;
  return Math.max(1, Math.round(ms / (SLOT_MIN * 60 * 1000)));
}

function fmtJst(iso) {
  return new Date(iso).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo", hour12: false });
}

function analyzeMember(member, sepList, storeName) {
  const sentMs = new Date(LINE_SENT_AT).getTime();
  const active = sepList.filter((r) => r.status !== "cancelled");
  const afterLine = active.filter((r) => new Date(r.created_at).getTime() >= sentMs);
  const beforeLine = active.filter((r) => new Date(r.created_at).getTime() < sentMs);

  const afterLineDetails = afterLine
    .slice()
    .sort((a, b) => a.start_at.localeCompare(b.start_at))
    .map((r) => ({
      startAtJst: fmtJst(r.start_at),
      slots: slotCount(r.start_at, r.end_at),
      createdAtJst: fmtJst(r.created_at),
      status: r.status,
    }));

  return {
    memberCode: String(member.member_code).toUpperCase(),
    displayName: member.display_name ?? member.name ?? "—",
    homeStore: storeName,
    sepCountAtSend: beforeLine.length,
    sepCountNow: active.length,
    newBookingsAfterLine: afterLine.length,
    newSlotsAfterLine: afterLine.reduce((s, r) => s + slotCount(r.start_at, r.end_at), 0),
    bookedAfterLine: afterLine.length > 0,
    newReservations: afterLineDetails,
  };
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("DB未接続");
    process.exit(1);
  }

  const supabase = createClient(url, key, { auth: { persistSession: false } });
  const nowJst = fmtJst(new Date().toISOString());

  const [membersResult, storesResult, sepResult] = await Promise.all([
    fetchAllChecked(
      supabase,
      "members",
      "id, member_code, display_name, name, store_id",
      (q) => q.in("member_code", [...SENT_SUCCESS_CODES, ...NOT_SENT_CODES.map((x) => x.code)]),
      "members",
    ),
    fetchAllChecked(supabase, "stores", "id, name", undefined, "stores"),
    fetchAllChecked(
      supabase,
      "reservations",
      "id, member_id, start_at, end_at, status, created_at",
      (q) =>
        q
          .gte("start_at", SEP_START)
          .lt("start_at", SEP_END)
          .not("member_id", "is", null),
      "reservations.september",
    ),
  ]);

  const storeNameById = Object.fromEntries(storesResult.rows.map((s) => [s.id, s.name]));
  const memberByCode = Object.fromEntries(
    membersResult.rows.map((m) => [String(m.member_code).toUpperCase(), m]),
  );
  const sepByMember = new Map();
  for (const r of sepResult.rows) {
    const list = sepByMember.get(r.member_id) ?? [];
    list.push(r);
    sepByMember.set(r.member_id, list);
  }

  const sentResults = [];
  for (const code of SENT_SUCCESS_CODES) {
    const m = memberByCode[code];
    if (!m) {
      sentResults.push({ memberCode: code, error: "member_not_found" });
      continue;
    }
    sentResults.push(analyzeMember(m, sepByMember.get(m.id) ?? [], storeNameById[m.store_id] ?? null));
  }

  sentResults.sort(
    (a, b) =>
      Number(b.bookedAfterLine) - Number(a.bookedAfterLine) ||
      (b.newBookingsAfterLine ?? 0) - (a.newBookingsAfterLine ?? 0) ||
      String(a.memberCode).localeCompare(String(b.memberCode)),
  );

  const booked = sentResults.filter((r) => r.bookedAfterLine);
  const notBooked = sentResults.filter((r) => !r.bookedAfterLine && !r.error);

  const notSentFollowup = NOT_SENT_CODES.map(({ code, reason }) => {
    const m = memberByCode[code];
    if (!m) return { memberCode: code, reason, error: "member_not_found" };
    const row = analyzeMember(m, sepByMember.get(m.id) ?? [], storeNameById[m.store_id] ?? null);
    return { ...row, lineSendStatus: reason };
  });

  console.log(
    JSON.stringify(
      {
        checkedAtJst: nowJst,
        lineSentAtUtc: LINE_SENT_AT,
        lineSentAtJst: fmtJst(LINE_SENT_AT),
        sentSuccessCount: SENT_SUCCESS_CODES.length,
        bookedAfterLineCount: booked.length,
        notBookedAfterLineCount: notBooked.length,
        bookedMembers: booked,
        notBookedMembers: notBooked,
        notSentReference: notSentFollowup,
      },
      null,
      2,
    ),
  );

  console.log("\n--- サマリー ---");
  console.log(`確認日時(JST): ${nowJst}`);
  console.log(`LINE送信後に新規予約: ${booked.length} / ${SENT_SUCCESS_CODES.length}名`);

  console.log("\n--- 予約あり（送信後） ---");
  if (!booked.length) console.log("（なし）");
  for (const r of booked) {
    console.log(
      `${r.memberCode} ${r.displayName} | 送信後+${r.newBookingsAfterLine}件 / +${r.newSlotsAfterLine}コマ | 9月合計 ${r.sepCountAtSend}→${r.sepCountNow}`,
    );
    for (const n of r.newReservations) {
      console.log(`  - 来店 ${n.startAtJst} (${n.slots}コマ) 予約操作 ${n.createdAtJst}`);
    }
  }

  console.log("\n--- 予約なし（送信後・未反応） ---");
  for (const r of notBooked) {
    console.log(`${r.memberCode} ${r.displayName} | 9月合計 ${r.sepCountAtSend}→${r.sepCountNow}（変化なし）`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
