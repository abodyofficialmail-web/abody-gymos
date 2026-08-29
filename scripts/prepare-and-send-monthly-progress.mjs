/**
 * 先に全員分レポート生成（マイページ保存）→ 指定時刻以降に高速LINE送信
 *
 *   node scripts/prepare-and-send-monthly-progress.mjs --month=2026-07 --confirm-send --send-after=20:00
 */

import { createClient } from "@supabase/supabase-js";
import { spawnSync } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { DateTime } from "luxon";
import {
  MEMBER_REPORTS_BUCKET,
  createDeliveryUrls,
  markLineSent,
} from "./lib/monthlyProgressPersist.mjs";
import { sendMonthlyProgressLineLocal } from "./lib/sendMonthlyProgressLineLocal.mjs";

const PROD_MONTHLY_API = "https://abody-gymos.vercel.app/api/admin/send-monthly-progress-line";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const GEN = path.join(ROOT, "scripts", "generate-monthly-progress-report.mjs");
const EXCLUDE_CODES = new Set(["EBI020"]);
const TZ = "Asia/Tokyo";

async function createSb(url, key) {
  const opts = { auth: { persistSession: false } };
  try {
    const ws = (await import("ws")).default;
    opts.realtime = { transport: ws };
  } catch {
    // Node 22+ はネイティブ WebSocket で足りる
  }
  return createClient(url, key, opts);
}

function loadEnv() {
  for (const name of [".env.local.bak-before-vercel-run", ".env.local.tmp-off", ".env.local"]) {
    const p = path.join(ROOT, name);
    if (!fs.existsSync(p)) continue;
    for (const line of fs.readFileSync(p, "utf8").split("\n")) {
      const t = line.trim();
      if (!t || t.startsWith("#") || !t.includes("=")) continue;
      const i = t.indexOf("=");
      const k = t.slice(0, i).trim();
      let v = t.slice(i + 1).trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      if (!v) continue;
      if (!process.env[k]) process.env[k] = v;
    }
  }
}

function arg(name, fallback = null) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}

function isSendableMember(m) {
  const ms = String(m.membership_status ?? "").toLowerCase();
  if (ms === "withdrawn") return false;
  if (ms === "active" || ms === "hiatus") return true;
  return m.is_active !== false;
}

async function fetchAll(supabase, table, select, apply) {
  const pageSize = 1000;
  let from = 0;
  const rows = [];
  for (;;) {
    let q = supabase.from(table).select(select).range(from, from + pageSize - 1);
    if (apply) q = apply(q);
    const { data, error } = await q;
    if (error) throw error;
    rows.push(...(data ?? []));
    if (!data || data.length < pageSize) break;
    from += pageSize;
  }
  return rows;
}

async function listEligible(sb) {
  const members = await fetchAll(
    sb,
    "members",
    "id, member_code, name, display_name, line_user_id, line_channel_key, is_active, membership_status, store_id"
  );
  return members
    .map((m) => {
      const code = String(m.member_code || "").toUpperCase();
      return {
        id: m.id,
        member_code: code,
        name: m.display_name || m.name,
        hasLine: Boolean(m.line_user_id),
        eligible: isSendableMember(m) && Boolean(m.line_user_id) && Boolean(code) && !EXCLUDE_CODES.has(code),
      };
    })
    .filter((t) => t.eligible)
    .sort((a, b) => a.member_code.localeCompare(b.member_code));
}

async function loadMeta(sb, memberId, yearMonth) {
  const metaPath = `${memberId}/${yearMonth}/meta.json`;
  const { data: blob, error } = await sb.storage.from(MEMBER_REPORTS_BUCKET).download(metaPath);
  if (error || !blob) return null;
  try {
    return JSON.parse(await blob.text());
  } catch {
    return null;
  }
}

function persistOne(code, yearMonth) {
  const r = spawnSync(process.execPath, [GEN, `--code=${code}`, `--month=${yearMonth}`, "--persist"], {
    cwd: ROOT,
    encoding: "utf8",
    env: process.env,
    maxBuffer: 20 * 1024 * 1024,
  });
  return { ok: r.status === 0, stdout: r.stdout || "", stderr: r.stderr || "", status: r.status };
}

function buildLineText(meta, pdfUrl) {
  return `【Monthly Progress Report】

対象: ${meta.name}（${meta.memberCode} / ${meta.storeName || ""}）
期間: ${meta.yearMonthLabel}
来店: ${meta.visitCount}回 / Score ${meta.abodyScore}（${meta.overallGrade}）

1) 成長レポート  2) 成果サマリー  3) トレーニング分析  4) 来月プラン

マイページの「成長レポート」からもいつでもご覧いただけます。

PDF:
${pdfUrl}`;
}

async function sendOne(sb, meta, dryRun) {
  const { imageUrls, pdfUrl } = await createDeliveryUrls(sb, meta);
  const text = buildLineText(meta, pdfUrl);

  // ローカルに LINE トークンが無い場合が多いので、まず本番API、ダメならローカル直送
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (serviceKey) {
    const res = await fetch(PROD_MONTHLY_API, {
      method: "POST",
      headers: { "content-type": "application/json", "x-service-role-key": serviceKey },
      body: JSON.stringify({
        member_codes: [meta.memberCode],
        dry_run: dryRun,
        text,
        image_urls: imageUrls,
        pdf_url: pdfUrl,
        pdf_file_name: `${meta.memberCode}-${meta.yearMonth}-monthly-progress.pdf`,
      }),
    });
    const body = await res.text();
    let json = null;
    try {
      json = JSON.parse(body);
    } catch {
      json = null;
    }
    if (res.ok && json?.ok) {
      const one = json.results?.[0] || { ok: true, channel: "prod-api" };
      if (!dryRun) await markLineSent(sb, meta.memberId, meta.yearMonth);
      return one;
    }
    console.warn("prod-api send failed, fallback local:", res.status, body.slice(0, 200));
  }

  const result = await sendMonthlyProgressLineLocal(sb, {
    memberCode: meta.memberCode,
    text,
    imageUrls,
    pdfUrl,
    dryRun,
  });
  if (!result.ok) throw new Error(result.error || result.detail || "send failed");
  if (!dryRun) await markLineSent(sb, meta.memberId, meta.yearMonth);
  return result;
}

function writeStatus(statusPath, status) {
  fs.writeFileSync(statusPath, JSON.stringify(status, null, 2));
}

async function main() {
  loadEnv();
  const now0 = DateTime.now().setZone(TZ);
  const yearMonth = arg("month", now0.toFormat("yyyy-MM"));
  const confirmSend = process.argv.includes("--confirm-send");
  const dryRun = process.argv.includes("--dry-run") || !confirmSend;
  const phaseArg = (arg("phase", null) || "all").toLowerCase();
  const persistOnly = process.argv.includes("--persist-only") || phaseArg === "persist";
  const sendOnly = process.argv.includes("--send-only") || phaseArg === "send";
  const doPersist = !sendOnly;
  const doSend = !persistOnly;
  const sendAfterRaw = arg("send-after", null);
  let sendAfter = null;
  if (sendAfterRaw) {
    const m = String(sendAfterRaw).match(/^(\d{1,2}):(\d{2})$/);
    if (!m) throw new Error("--send-after=HH:MM");
    sendAfter = now0.set({ hour: Number(m[1]), minute: Number(m[2]), second: 0, millisecond: 0 });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase env missing");
  const sb = await createSb(url, key);

  const eligible = await listEligible(sb);
  const outDir = path.join(ROOT, "tmp", "monthly-progress-reports");
  fs.mkdirSync(outDir, { recursive: true });
  const statusPath = path.join(outDir, `_prepare-send-${yearMonth}-status.json`);
  const results = [];

  const status = {
    startedAt: now0.toISO(),
    yearMonth,
    phaseRequested: phaseArg,
    sendAfter: sendAfter ? sendAfter.toISO() : null,
    dryRun,
    confirmSend: confirmSend && !dryRun,
    total: eligible.length,
    persisted: 0,
    sent: 0,
    failed: 0,
    phase: doPersist ? "persist" : "send",
    pid: process.pid,
  };
  writeStatus(statusPath, status);
  console.log(
    JSON.stringify(
      {
        ...status,
        note: persistOnly
          ? "persist only (no LINE send)"
          : sendOnly
            ? "send only (expect already persisted)"
            : "persist first, then send",
      },
      null,
      2
    )
  );

  // Phase 1: persist all (skip if already have meta)
  if (doPersist) {
    for (let i = 0; i < eligible.length; i++) {
      const t = eligible[i];
      const existing = await loadMeta(sb, t.id, yearMonth);
      if (existing?.pagePaths?.length) {
        console.log(`[persist ${i + 1}/${eligible.length}] ${t.member_code} already persisted`);
        status.persisted += 1;
        results.push({
          code: t.member_code,
          persist: "skip_exists",
          send: existing.lineSentAt ? "already_sent" : "pending",
        });
        writeStatus(statusPath, { ...status, results });
        continue;
      }
      console.log(`[persist ${i + 1}/${eligible.length}] ${t.member_code} ${t.name} generating…`);
      const r = persistOne(t.member_code, yearMonth);
      if (!r.ok) {
        status.failed += 1;
        results.push({ code: t.member_code, persist: "fail", detail: (r.stderr || r.stdout).slice(-400) });
        console.error("PERSIST FAIL", t.member_code);
        writeStatus(statusPath, { ...status, results });
        continue;
      }
      status.persisted += 1;
      results.push({ code: t.member_code, persist: "ok", send: "pending" });
      writeStatus(statusPath, { ...status, results });
      console.log("PERSIST OK", t.member_code);
    }
  }

  if (!doSend) {
    status.phase = "done_persist_only";
    status.finishedAt = DateTime.now().setZone(TZ).toISO();
    writeStatus(statusPath, { ...status, results });
    console.log("\ndone persist-only", { persisted: status.persisted, failed: status.failed, statusPath });
    return;
  }

  // Wait until send-after if needed (all モードのみ)
  let now = DateTime.now().setZone(TZ);
  if (sendAfter && now < sendAfter) {
    const waitMs = sendAfter.toMillis() - now.toMillis();
    status.phase = "waiting_send_after";
    status.waitMs = waitMs;
    writeStatus(statusPath, { ...status, results });
    console.log(`waiting until ${sendAfter.toFormat("HH:mm")} JST (${Math.round(waitMs / 1000)}s)…`);
    await new Promise((r) => setTimeout(r, waitMs));
  }

  // Phase 2: send all persisted not yet sent
  status.phase = "send";
  writeStatus(statusPath, { ...status, results });
  console.log(`\n=== SEND PHASE dryRun=${dryRun} ===`);

  for (let i = 0; i < eligible.length; i++) {
    const t = eligible[i];
    const meta = await loadMeta(sb, t.id, yearMonth);
    if (!meta?.pagePaths?.length) {
      console.log(`[send ${i + 1}/${eligible.length}] ${t.member_code} skip (no persist)`);
      results.push({ code: t.member_code, send: "skip_no_persist" });
      continue;
    }
    if (meta.lineSentAt && !process.argv.includes("--force-resend")) {
      console.log(`[send ${i + 1}/${eligible.length}] ${t.member_code} skip (already sent)`);
      status.sent += 1;
      continue;
    }
    try {
      console.log(`[send ${i + 1}/${eligible.length}] ${t.member_code} ${t.name}`);
      const sent = await sendOne(sb, meta, dryRun);
      status.sent += 1;
      results.push({ code: t.member_code, send: dryRun ? "dry_ok" : "ok", channel: sent.channel });
      console.log("SEND OK", t.member_code, sent.channel);
    } catch (e) {
      status.failed += 1;
      results.push({ code: t.member_code, send: "fail", detail: String(e?.message || e) });
      console.error("SEND FAIL", t.member_code, e?.message || e);
    }
    writeStatus(statusPath, { ...status, results });
    await new Promise((r) => setTimeout(r, dryRun ? 50 : 350));
  }

  status.phase = "done";
  status.finishedAt = DateTime.now().setZone(TZ).toISO();
  writeStatus(statusPath, { ...status, results });
  console.log("\ndone", { persisted: status.persisted, sent: status.sent, failed: status.failed, statusPath });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
