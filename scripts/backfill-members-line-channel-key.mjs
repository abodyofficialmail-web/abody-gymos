/**
 * 既存会員の line_channel_key を会員番号プレフィックスから暫定推定してバックフィル
 *
 * usage:
 *   npx vercel env run --environment=production -- node scripts/backfill-members-line-channel-key.mjs --dry-run
 *   npx vercel env run --environment=production -- node scripts/backfill-members-line-channel-key.mjs
 *
 * 既に line_channel_key が設定されている会員（手修正含む）はスキップします。
 */
import { createClient } from "@supabase/supabase-js";
import fs from "fs";
import path from "path";

function loadEnvFile(name, { overwrite = false } = {}) {
  const p = path.join(process.cwd(), name);
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i === -1) continue;
    const k = t.slice(0, i).trim();
    const cur = process.env[k];
    if (!overwrite && cur !== undefined && cur !== "") continue;
    let v = t.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    process.env[k] = v;
  }
}

loadEnvFile(".env.local");
loadEnvFile(".env.production.local");

const dryRun = process.argv.includes("--dry-run");

function inferChannelKey(memberCode) {
  const code = String(memberCode ?? "").trim().toUpperCase();
  if (code.startsWith("SAK")) return "sakuragicho";
  if (code.startsWith("UEN")) return "ueno";
  if (code.startsWith("SHJ")) return "shinjuku";
  if (code.startsWith("EBI")) return "default";
  return "default";
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) {
    console.error("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY が必要です");
    process.exit(1);
  }

  const supabase = createClient(url, key);
  const { data: rows, error } = await supabase
    .from("members")
    .select("id, member_code, line_channel_key")
    .not("line_user_id", "is", null)
    .is("line_channel_key", null)
    .order("member_code");

  if (error) {
    console.error(error.message);
    process.exit(1);
  }

  const targets = rows ?? [];
  const byChannel = {};
  for (const m of targets) {
    const ch = inferChannelKey(m.member_code);
    byChannel[ch] = (byChannel[ch] ?? 0) + 1;
  }

  console.log(`mode: ${dryRun ? "dry-run" : "apply"}`);
  console.log(`targets: ${targets.length} members (line_user_id あり & line_channel_key NULL)`);
  console.log("by channel:", byChannel);

  if (targets.length === 0) {
    console.log("nothing to do");
    return;
  }

  const samples = targets.slice(0, 10).map((m) => ({
    member_code: m.member_code,
    channel: inferChannelKey(m.member_code),
  }));
  console.log("samples:", samples);

  if (dryRun) {
    console.log("dry-run complete (no updates)");
    return;
  }

  let ok = 0;
  let failed = 0;
  const now = new Date().toISOString();

  for (const m of targets) {
    const channelKey = inferChannelKey(m.member_code);
    const { error: upErr } = await supabase
      .from("members")
      .update({ line_channel_key: channelKey, updated_at: now })
      .eq("id", m.id)
      .is("line_channel_key", null);
    if (upErr) {
      console.error("FAIL", m.member_code, upErr.message);
      failed++;
    } else {
      ok++;
    }
  }

  const { count, error: cErr } = await supabase
    .from("members")
    .select("id", { count: "exact", head: true })
    .not("line_user_id", "is", null)
    .is("line_channel_key", null);

  if (cErr) console.error("count error:", cErr.message);
  console.log(`updated: ${ok}, failed: ${failed}, remaining null: ${count ?? "?"}`);
}

main().catch((e) => {
  console.error(e?.message ?? e);
  process.exit(1);
});
