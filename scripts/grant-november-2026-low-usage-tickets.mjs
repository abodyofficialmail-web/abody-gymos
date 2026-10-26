/**
 * 11月先行のチケット2枚。cron `/api/cron/november-booking-release` と同じ条件。
 *
 * 10月26日18:00（日本時間）より前は --apply しない。
 * 既に reason `november_2026_low_usage_tickets` がある会員は足さない。
 *
 *   node --env-file=.env.local scripts/grant-november-2026-low-usage-tickets.mjs
 *   node --env-file=.env.local scripts/grant-november-2026-low-usage-tickets.mjs --apply
 */
import { createClient } from "@supabase/supabase-js";
import { fetchAllChecked } from "./lib/supabaseFetchAll.mjs";

const EARLY_AT_ISO = "2026-10-26T18:00:00+09:00";
const USAGE_START = "2026-10-01T00:00:00+09:00";
const USAGE_END = "2026-11-01T00:00:00+09:00";
const LOW_MAX = 8;
const TICKET_KOMA = 2;
const LEDGER_REASON = "november_2026_low_usage_tickets";
const LEDGER_NOTE = "10月の利用が8回以下のため、11月の先行予約に2枚";

function isActive(member) {
  const status = String(member.membership_status ?? "").toLowerCase();
  if (status === "active") return true;
  if (status === "hiatus" || status === "withdrawn") return false;
  return member.is_active === true;
}

function isTestName(name) {
  return /テスト/.test(String(name ?? "").replace(/\s/g, ""));
}

async function main() {
  const apply = process.argv.includes("--apply");
  if (apply && Date.now() < Date.parse(EARLY_AT_ISO)) {
    throw new Error("10月26日18:00より前はチケットを付与しません。");
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY が未設定です。");
  const supabase = createClient(url, key, { auth: { persistSession: false } });

  let members;
  try {
    members = (
      await fetchAllChecked(
        supabase,
        "members",
        "id, member_code, name, display_name, is_active, membership_status",
        undefined,
        "members.november-low-usage"
      )
    ).rows;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e?.message ?? e);
    if (!/membership_status|display_name|does not exist|schema cache/i.test(msg)) throw e;
    members = (
      await fetchAllChecked(
        supabase,
        "members",
        "id, member_code, name, is_active",
        undefined,
        "members.november-low-usage"
      )
    ).rows;
  }

  const reservations = await fetchAllChecked(
    supabase,
    "reservations",
    "member_id",
    (q) =>
      q
        .gte("start_at", USAGE_START)
        .lt("start_at", USAGE_END)
        .lt("created_at", EARLY_AT_ISO)
        .neq("status", "cancelled")
        .not("member_id", "is", null),
    "reservations.2026-10.usage"
  );

  const counts = new Map();
  for (const row of reservations.rows) {
    if (!row.member_id) continue;
    counts.set(row.member_id, (counts.get(row.member_id) ?? 0) + 1);
  }

  const selected = [];
  for (const member of members) {
    if (!member.id || !isActive(member)) continue;
    if (isTestName(member.name) || isTestName(member.display_name)) continue;
    const count = counts.get(member.id) ?? 0;
    if (count < 0 || count > LOW_MAX) continue;
    selected.push({ id: member.id, memberCode: String(member.member_code ?? "").trim().toUpperCase(), count });
  }
  selected.sort((a, b) => a.count - b.count || a.memberCode.localeCompare(b.memberCode));

  const grantedIds = new Set();
  for (let i = 0; i < selected.length; i += 100) {
    const chunk = selected.slice(i, i + 100).map((m) => m.id);
    const { data, error } = await supabase
      .from("member_ticket_ledger")
      .select("member_id")
      .eq("reason", LEDGER_REASON)
      .in("member_id", chunk);
    if (error) throw error;
    for (const row of data ?? []) grantedIds.add(row.member_id);
  }

  const pending = selected.filter((m) => !grantedIds.has(m.id));
  const byCount = {};
  for (const member of selected) byCount[member.count] = (byCount[member.count] ?? 0) + 1;
  console.log(
    JSON.stringify(
      {
        apply,
        eligible: selected.length,
        alreadyGranted: grantedIds.size,
        pending: pending.length,
        byCount,
      },
      null,
      2
    )
  );
  if (!apply) return;

  let granted = 0;
  const failed = [];
  for (const member of pending) {
    const cur = await supabase.from("members").select("bonus_ticket_koma").eq("id", member.id).maybeSingle();
    if (cur.error) {
      failed.push({ memberCode: member.memberCode, error: cur.error.message });
      continue;
    }
    const current = Math.max(0, Number(cur.data?.bonus_ticket_koma ?? 0) || 0);
    const next = current + TICKET_KOMA;
    const upd = await supabase
      .from("members")
      .update({ bonus_ticket_koma: next, updated_at: new Date().toISOString() })
      .eq("id", member.id);
    if (upd.error) {
      failed.push({ memberCode: member.memberCode, error: upd.error.message });
      continue;
    }
    const ledger = await supabase.from("member_ticket_ledger").insert({
      member_id: member.id,
      delta: TICKET_KOMA,
      reason: LEDGER_REASON,
      note: LEDGER_NOTE,
    });
    if (ledger.error) {
      await supabase
        .from("members")
        .update({ bonus_ticket_koma: current, updated_at: new Date().toISOString() })
        .eq("id", member.id);
      failed.push({ memberCode: member.memberCode, error: ledger.error.message });
      continue;
    }
    granted += 1;
  }
  console.log(JSON.stringify({ granted, failed }, null, 2));
  if (failed.length) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
