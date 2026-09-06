/**
 * #4・#8 最遠日枠キャンセル分の LINE 再送（キャンセル済み予約向け）
 *
 *   node scripts/send-cancel-line-farthest-4-8.mjs --dry-run
 *   node scripts/send-cancel-line-farthest-4-8.mjs --confirm
 */
import { createClient } from "@supabase/supabase-js";
import { DateTime } from "luxon";
import { fetchAllChecked } from "./lib/supabaseFetchAll.mjs";

const PRODUCTION_API = process.env.MEMBER_PLANS_API_URL?.trim() || "https://abody-gymos.vercel.app";
const TARGET_CODES = ["SHI025", "UEN054"];

/** 直近キャンセル対象（9/13・9/28） */
const CANCEL_WINDOWS = [
  { code: "SHI025", start: "2026-09-28T09:30:00.000Z", end: "2026-09-28T10:00:00.000Z" },
  { code: "UEN054", start: "2026-09-13T01:30:00.000Z", end: "2026-09-13T02:00:00.000Z" },
  { code: "UEN054", start: "2026-09-13T01:00:00.000Z", end: "2026-09-13T01:30:00.000Z" },
];

function fmtJst(iso) {
  return DateTime.fromISO(iso, { setZone: true }).setZone("Asia/Tokyo").toFormat("yyyy-MM-dd HH:mm");
}

async function main() {
  const dryRun = !process.argv.includes("--confirm");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("SUPABASE env missing");
    process.exit(1);
  }

  const supabase = createClient(url, key, { auth: { persistSession: false } });
  const { rows: members } = await fetchAllChecked(
    supabase,
    "members",
    "id, member_code",
    (q) => q.in("member_code", TARGET_CODES),
    "members",
  );
  const memberByCode = Object.fromEntries(members.map((m) => [m.member_code, m.id]));

  const notifications = [];
  for (const w of CANCEL_WINDOWS) {
    const memberId = memberByCode[w.code];
    if (!memberId) continue;
    const { rows } = await fetchAllChecked(
      supabase,
      "reservations",
      "id, start_at, end_at, status",
      (q) =>
        q
          .eq("member_id", memberId)
          .eq("start_at", w.start)
          .eq("end_at", w.end)
          .eq("status", "cancelled"),
      `cancelled.${w.code}`,
    );
    for (const r of rows) {
      notifications.push({
        reservation_id: r.id,
        start_at: r.start_at,
        end_at: r.end_at,
      });
      console.log(`対象: ${w.code} ${fmtJst(r.start_at)}-${fmtJst(r.end_at).slice(11)} id=${r.id}`);
    }
  }

  if (!notifications.length) {
    console.log("送信対象なし（キャンセル済み予約が見つかりません）");
    return;
  }

  console.log(`\nLINE送信 ${notifications.length}件 mode=${dryRun ? "dry-run" : "confirm"}`);

  const endpoints = [
    { url: `${PRODUCTION_API.replace(/\/$/, "")}/api/admin/resend-member-line-history`, body: { cancel_notifications: notifications, dry_run: dryRun } },
    { url: `${PRODUCTION_API.replace(/\/$/, "")}/api/admin/send-cancel-line`, body: { notifications, dry_run: dryRun } },
  ];

  for (const { url, body } of endpoints) {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-service-role-key": key,
      },
      body: JSON.stringify(body),
    });
    const parsed = await res.json().catch(() => ({}));
    console.log(`${url} HTTP ${res.status}`, JSON.stringify(parsed, null, 2));
    if (res.ok) return;
    if (res.status !== 404) process.exit(1);
  }
  process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
