/**
 * 新宿会員（SHI/SHJ）向け LINE 一括再送
 * - カルテ（トレーニングフィードバック）全件
 * - セッション後アンケート（既存 invite + カルテから欠落分作成）
 * - 予約確定LINE（指定日以降の start_at のみ）
 *
 * usage:
 *   node scripts/resend-shinjuku-line-batch.mjs --dry-run
 *   node scripts/resend-shinjuku-line-batch.mjs
 *   node scripts/resend-shinjuku-line-batch.mjs --from=2026-06-26
 *   node scripts/resend-shinjuku-line-batch.mjs --member=SHI004
 */
import { createClient } from "@supabase/supabase-js";
import fs from "fs";
import path from "path";

const DEFAULT_APP_URL = "https://abody-gymos.vercel.app";
const DEFAULT_RESERVATIONS_FROM = "2026-06-26";

function loadEnvFile(name) {
  const p = path.join(process.cwd(), name);
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i === -1) continue;
    const k = t.slice(0, i).trim();
    if (process.env[k]) continue;
    let v = t.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (v) process.env[k] = v;
  }
}

loadEnvFile(".env.local");

function parseArgs(argv) {
  const dryRun = argv.includes("--dry-run");
  const skipDbFix = argv.includes("--skip-db-fix");
  const fromArg = argv.find((a) => a.startsWith("--from="));
  const reservationsFrom = fromArg ? fromArg.split("=")[1] : DEFAULT_RESERVATIONS_FROM;
  const memberArg = argv.find((a) => a.startsWith("--member="));
  const memberCode = memberArg ? memberArg.split("=")[1].trim().toUpperCase() : null;
  const useLocalApi = argv.includes("--local-api");
  return { dryRun, skipDbFix, reservationsFrom, memberCode, useLocalApi };
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function applyDbFix(supabase, dryRun) {
  const { data: targets, error: selErr } = await supabase
    .from("members")
    .select("id, member_code")
    .not("line_user_id", "is", null)
    .or("member_code.ilike.SHI%,member_code.ilike.SHJ%")
    .neq("line_channel_key", "shinjuku");
  if (selErr) throw selErr;

  if (dryRun) {
    console.log(`[dry-run] would fix line_channel_key for ${targets?.length ?? 0} members`);
    return targets?.length ?? 0;
  }

  const now = new Date().toISOString();
  for (const m of targets ?? []) {
    const { error: upErr } = await supabase
      .from("members")
      .update({ line_channel_key: "shinjuku", updated_at: now })
      .eq("id", m.id);
    if (upErr) throw upErr;
    console.log("fixed channel", m.member_code, "-> shinjuku");
  }
  return targets?.length ?? 0;
}

async function callResendApi(params) {
  const base = params.useLocalApi ? "http://localhost:3000" : DEFAULT_APP_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY missing");

  const res = await fetch(`${base}/api/admin/resend-member-line-history`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-service-role-key": key,
    },
    body: JSON.stringify({
      member_code: params.memberCode,
      line_channel_key: "shinjuku",
      include_karte: true,
      include_reservations: true,
      include_session_surveys: true,
      create_missing_session_surveys: true,
      reservations_from: params.reservationsFrom,
      dry_run: params.dryRun,
    }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`${params.memberCode}: ${json.error ?? res.status}`);
  }
  return json;
}

function summarizeResult(json) {
  const karteOk = (json.results?.karte ?? []).filter((r) => r.ok).length;
  const karteTotal = (json.results?.karte ?? []).length;
  const resOk = (json.results?.reservations ?? []).filter((r) => r.ok).length;
  const resTotal = (json.results?.reservations ?? []).length;
  const surveyOk = (json.results?.session_surveys ?? []).filter((r) => r.ok).length;
  const surveyTotal = (json.results?.session_surveys ?? []).length;
  const missingOk = (json.results?.missing_surveys ?? []).filter((r) => r.ok).length;
  const missingTotal = (json.results?.missing_surveys ?? []).length;
  return { karteOk, karteTotal, resOk, resTotal, surveyOk, surveyTotal, missingOk, missingTotal };
}

async function main() {
  const { dryRun, skipDbFix, reservationsFrom, memberCode, useLocalApi } = parseArgs(process.argv);

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) throw new Error("Supabase env missing (.env.local)");

  const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

  console.log("mode:", dryRun ? "dry-run" : "send");
  console.log("reservations_from:", reservationsFrom);
  console.log("api:", useLocalApi ? "local" : DEFAULT_APP_URL);

  if (!skipDbFix) {
    const fixed = await applyDbFix(supabase, dryRun);
    console.log("db fix count:", fixed);
  }

  let query = supabase
    .from("members")
    .select("member_code, line_user_id, is_active")
    .not("line_user_id", "is", null)
    .eq("is_active", true)
    .or("member_code.ilike.SHI%,member_code.ilike.SHJ%")
    .order("member_code");
  if (memberCode) query = query.eq("member_code", memberCode);

  const { data: members, error } = await query;
  if (error) throw error;
  if (!members?.length) throw new Error("対象会員がいません");

  console.log(`targets: ${members.length} members`);

  const summary = [];
  for (const m of members) {
    console.log(`\n--- ${m.member_code} ---`);
    try {
      const json = await callResendApi({
        memberCode: m.member_code,
        reservationsFrom,
        dryRun,
        useLocalApi,
      });
      const s = summarizeResult(json);
      summary.push({ member_code: m.member_code, ok: true, ...s });
      console.log(
        `karte ${s.karteOk}/${s.karteTotal}, reservations ${s.resOk}/${s.resTotal}, surveys ${s.surveyOk}/${s.surveyTotal}, missing ${s.missingOk}/${s.missingTotal}`
      );
    } catch (e) {
      const msg = e?.message ?? String(e);
      console.error("FAIL", m.member_code, msg);
      summary.push({ member_code: m.member_code, ok: false, error: msg });
    }
    if (!dryRun) await sleep(800);
  }

  console.log("\n=== summary ===");
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((e) => {
  console.error(e?.message ?? e);
  process.exit(1);
});
