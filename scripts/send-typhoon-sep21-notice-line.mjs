/**
 * 9/21（JST）予約者（福岡店予約除外）へ台風案内LINE
 *
 * usage:
 *   node scripts/send-typhoon-sep21-notice-line.mjs --dry-run
 *   node scripts/send-typhoon-sep21-notice-line.mjs --api --dry-run
 *   node scripts/send-typhoon-sep21-notice-line.mjs --api --confirm
 *   node scripts/send-typhoon-sep21-notice-line.mjs --api --confirm --date=2026-09-21 --exclude-store=福岡
 */
import fs from "fs";
import path from "path";
import { createClient } from "@supabase/supabase-js";
import { DateTime } from "luxon";
import { fetchAllChecked } from "./lib/supabaseFetchAll.mjs";

const TZ = "Asia/Tokyo";
const PRODUCTION_API = process.env.MEMBER_PLANS_API_URL?.trim() || "https://abody-gymos.vercel.app";

const MESSAGE = `【台風接近に伴う営業について】

いつもAbodyをご利用いただきありがとうございます。

明日9月21日にご予約いただいている会員様へ、台風接近に伴う営業についてご案内です。

現時点では通常通り営業を予定しておりますが、
今後の天候状況や交通機関への影響によっては、お客様・トレーナーの安全を最優先に営業時間の変更または臨時休業とさせていただく可能性がございます。

営業内容に変更がある場合は、改めて公式LINEよりご連絡いたします。
また、通常営業の場合でも雨風が強くなる可能性がございますので、決して無理をせず、安全を最優先にご判断ください。

ご来店予定の方は、天候や交通状況をご確認のうえ、お気をつけてお越しください。
ご不便をおかけする可能性がございますが、何卒ご理解・ご協力のほどよろしくお願いいたします。

Abody`;

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

loadEnvFile(".env.production.local");
loadEnvFile(".env.local");
loadEnvFile(".env.vercel.production");

function parseArgs(argv) {
  const dryRun = !argv.includes("--confirm");
  const useApi = argv.includes("--api");
  const codesArg = argv.find((a) => a.startsWith("--codes="));
  const dateArg = argv.find((a) => a.startsWith("--date="));
  const excludeArg = argv.find((a) => a.startsWith("--exclude-store="));
  const codes = codesArg
    ? codesArg.split("=")[1].split(",").map((c) => c.trim().toUpperCase()).filter(Boolean)
    : null;
  return {
    dryRun,
    useApi,
    codes,
    date: dateArg?.slice("--date=".length) ?? "2026-09-21",
    excludeStore: excludeArg?.slice("--exclude-store=".length) ?? "福岡",
  };
}

async function resolveMemberCodesFromDb({ date, excludeStore }) {
  const dayStart = `${date}T00:00:00+09:00`;
  const dayEnd = DateTime.fromISO(dayStart, { zone: TZ }).plus({ days: 1 }).toISO();

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase env missing");

  const supabase = createClient(url, key, { auth: { persistSession: false } });

  const storesResult = await fetchAllChecked(supabase, "stores", "id, name", undefined, "stores");
  const excludedIds = new Set(
    storesResult.rows.filter((s) => String(s.name).includes(excludeStore)).map((s) => s.id),
  );

  const resResult = await fetchAllChecked(
    supabase,
    "reservations",
    "id, member_id, store_id, start_at, status",
    (q) =>
      q
        .gte("start_at", dayStart)
        .lt("start_at", dayEnd)
        .neq("status", "cancelled")
        .not("member_id", "is", null),
    "reservations.day",
  );

  const filtered = resResult.rows.filter((r) => !excludedIds.has(r.store_id));
  const memberIds = [...new Set(filtered.map((r) => r.member_id))];
  if (!memberIds.length) return [];

  const membersResult = await fetchAllChecked(
    supabase,
    "members",
    "id, member_code",
    (q) => q.in("id", memberIds),
    "members",
  );

  const codes = membersResult.rows
    .map((m) => String(m.member_code ?? "").trim().toUpperCase())
    .filter(Boolean);
  return [...new Set(codes)].sort();
}

async function sendViaApi({ dryRun, codes, serviceKey }) {
  const res = await fetch(`${PRODUCTION_API.replace(/\/$/, "")}/api/admin/send-typhoon-sep21-notice-line`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-service-role-key": serviceKey,
    },
    body: JSON.stringify({
      member_codes: codes,
      text: MESSAGE,
      dry_run: dryRun,
    }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error(`API error HTTP ${res.status}`, json);
    process.exit(1);
  }
  console.log(JSON.stringify(json, null, 2));
}

async function main() {
  const { dryRun, useApi, codes: codesOverride, date, excludeStore } = parseArgs(process.argv);
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!serviceKey) throw new Error("SUPABASE_SERVICE_ROLE_KEY missing");

  const codes = codesOverride ?? (await resolveMemberCodesFromDb({ date, excludeStore }));
  if (!codes.length) {
    console.log("対象会員なし");
    return;
  }

  console.log(`mode: ${dryRun ? "DRY-RUN" : "SEND"}`);
  console.log(`date: ${date} (exclude store name contains: ${excludeStore})`);
  console.log(`targets: ${codes.length} codes`);
  console.log(`via: ${useApi ? "production API" : "local (use --api for production)"}`);
  console.log(codes.join(", "));

  if (!useApi) {
    console.error("本番送信は --api を付けて実行してください（Vercel上のLINEトークンが必要）");
    process.exit(1);
  }

  await sendViaApi({ dryRun, codes, serviceKey });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
