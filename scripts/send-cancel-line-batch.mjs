/**
 * 9名対象の 9/7以降キャンセル済み予約へ、本番API経由でキャンセルLINEを送信
 *
 *   node scripts/send-cancel-line-batch.mjs --dry-run
 *   node scripts/send-cancel-line-batch.mjs --confirm
 */
import { createClient } from "@supabase/supabase-js";
import { fetchAllChecked } from "./lib/supabaseFetchAll.mjs";

const COUNT_START = "2026-09-07T00:00:00+09:00";
const COUNT_END = "2026-10-01T00:00:00+09:00";
const PRODUCTION_API = process.env.MEMBER_PLANS_API_URL?.trim() || "https://abody-gymos.vercel.app";

const TARGET_CODES = [
  "SHI004", "SHI022", "SHI018", "SHI026", "SHI027",
  "UEN011", "SHI021", "SHI023", "EBI008",
];

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
  const memberIds = members.map((m) => m.id);

  const { rows: reservations } = await fetchAllChecked(
    supabase,
    "reservations",
    "id, member_id, start_at, status, updated_at",
    (q) =>
      q
        .in("member_id", memberIds)
        .gte("start_at", COUNT_START)
        .lt("start_at", COUNT_END)
        .eq("status", "cancelled"),
    "reservations.cancelled",
  );

  const ids = reservations.map((r) => r.id);
  console.log(`キャンセル済み予約: ${ids.length}件`);

  if (!ids.length) {
    console.log("送信対象なし");
    return;
  }

  const batchSize = 20;
  let sent = 0;
  let failed = 0;

  for (let i = 0; i < ids.length; i += batchSize) {
    const batch = ids.slice(i, i + batchSize);
    const res = await fetch(`${PRODUCTION_API.replace(/\/$/, "")}/api/admin/send-cancel-line`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-service-role-key": key,
      },
      body: JSON.stringify({ reservation_ids: batch, dry_run: dryRun }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      console.error(`API error HTTP ${res.status}`, body);
      process.exit(1);
    }
    sent += body.sent ?? 0;
    failed += body.failed ?? 0;
    console.log(`batch ${i / batchSize + 1}: sent=${body.sent} failed=${body.failed} dry_run=${dryRun}`);
    for (const r of body.results ?? []) {
      if (!r.ok) console.log("  fail", r);
    }
    if (!dryRun) await new Promise((r) => setTimeout(r, 500));
  }

  console.log(`\n完了: sent=${sent} failed=${failed} mode=${dryRun ? "dry-run" : "confirm"}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
