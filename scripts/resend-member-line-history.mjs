/**
 * 会員の line_channel_key 修正 + カルテ（フィードバック）・予約確定LINEの再送
 *
 * usage:
 *   npx vercel env run --environment=production -- node scripts/resend-member-line-history.mjs UEN018 --channel=default
 *   npx vercel env run --environment=production -- node scripts/resend-member-line-history.mjs UEN018 --channel=default --june=2026-06
 *   npx vercel env run --environment=production -- node scripts/resend-member-line-history.mjs UEN018 --dry-run
 */
import { createClient } from "@supabase/supabase-js";
import { DateTime } from "luxon";
import fs from "fs";
import path from "path";
import { lineMessageWithReservationDetails } from "./lib/lineReservationMessage.mjs";
import { STORE_VISIT_ADDRESS_BY_NAME } from "./lib/storeAddresses.mjs";

const TZ = "Asia/Tokyo";

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

loadEnvFile(".env.vercel.production", { overwrite: true });
loadEnvFile(".env.production.local");

function parseArgs(argv) {
  const memberCode = (argv[2] ?? "").trim().toUpperCase();
  if (!memberCode) throw new Error("会員番号を指定してください（例: UEN018）");
  const dryRun = argv.includes("--dry-run");
  const juneIdx = argv.findIndex((a) => a.startsWith("--june="));
  const june = juneIdx >= 0 ? argv[juneIdx].split("=")[1] : null;
  const chIdx = argv.findIndex((a) => a.startsWith("--channel="));
  const channel = chIdx >= 0 ? argv[chIdx].split("=")[1] : "default";
  const skipKarte = argv.includes("--skip-karte");
  const skipReservations = argv.includes("--skip-reservations");
  return { memberCode, dryRun, june, channel, skipKarte, skipReservations };
}

function tokenForChannel(channel) {
  if (channel === "ueno") return process.env.LINE_CHANNEL_ACCESS_TOKEN_UENO ?? null;
  if (channel === "sakuragicho") return process.env.LINE_CHANNEL_ACCESS_TOKEN_SAKURAGICHO ?? null;
  if (channel === "shinjuku") return process.env.LINE_CHANNEL_ACCESS_TOKEN_SHINJUKU ?? null;
  return process.env.LINE_CHANNEL_ACCESS_TOKEN ?? null;
}

function messageForClientNote({ storeName, dateYmd, content }) {
  const date = DateTime.fromISO(dateYmd, { zone: TZ });
  const dateLabel = date.isValid ? date.setLocale("ja").toFormat("M月d日（ccc）") : dateYmd;
  const body = String(content ?? "").trim();
  return `
【カルテを共有しました】
店舗：${storeName}
日付：${dateLabel}

${body}
`.trim();
}

async function pushLine({ to, text, token }) {
  if (!token) throw new Error("LINE token が未設定です");
  const res = await fetch("https://api.line.me/v2/bot/message/push", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ to, messages: [{ type: "text", text }] }),
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`LINE push failed ${res.status}: ${body}`);
  return body;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const { memberCode, dryRun, june, channel, skipKarte, skipReservations } = parseArgs(process.argv);
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase env missing");

  const token = tokenForChannel(channel);
  if (!token && !dryRun) throw new Error(`token missing for channel=${channel}`);

  const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

  let member = null;
  let mErr = null;
  {
    const q = await supabase
      .from("members")
      .select("id, member_code, name, line_user_id, line_channel_key, is_active")
      .eq("member_code", memberCode)
      .maybeSingle();
    member = q.data;
    mErr = q.error;
  }
  if (mErr && /line_channel_key/i.test(mErr.message)) {
    const q = await supabase
      .from("members")
      .select("id, member_code, name, line_user_id, is_active")
      .eq("member_code", memberCode)
      .maybeSingle();
    member = q.data;
    mErr = q.error;
    if (member) member.line_channel_key = null;
  }
  if (mErr) throw mErr;
  if (!member?.is_active) throw new Error(`会員 ${memberCode} が見つからないか無効です`);
  if (!member.line_user_id) throw new Error(`${memberCode} は line_user_id 未連携です`);

  console.log("member", {
    member_code: member.member_code,
    name: member.name,
    line_user_id: member.line_user_id?.slice(0, 8) + "…",
    line_channel_key: member.line_channel_key,
    fix_channel: channel,
  });

  if (!dryRun) {
    const { error: upErr } = await supabase
      .from("members")
      .update({ line_channel_key: channel, updated_at: new Date().toISOString() })
      .eq("id", member.id);
    if (upErr) {
      if (/line_channel_key/i.test(upErr.message)) {
        console.warn("line_channel_key カラム未適用のため DB 更新スキップ。マイグレーションを実行してください。");
      } else {
        throw upErr;
      }
    } else {
      console.log("updated line_channel_key ->", channel);
    }
  }

  const results = { karte: [], reservations: [] };

  if (!skipKarte) {
    const { data: notes, error: nErr } = await supabase
      .from("client_notes")
      .select("id, date, content, store_id, stores(name)")
      .eq("member_id", member.id)
      .order("date", { ascending: true });
    if (nErr) throw nErr;

    console.log(`karte: ${notes?.length ?? 0} 件`);
    for (const n of notes ?? []) {
      const storeName = n.stores?.name ?? "";
      const text = messageForClientNote({
        storeName,
        dateYmd: n.date,
        content: n.content,
      });
      if (dryRun) {
        results.karte.push({ date: n.date, store: storeName, dry_run: true });
        continue;
      }
      await pushLine({ to: member.line_user_id, text, token });
      results.karte.push({ date: n.date, store: storeName, ok: true });
      console.log("sent karte", n.date, storeName);
      await sleep(450);
    }
  }

  if (!skipReservations) {
    let q = supabase
      .from("reservations")
      .select("id, start_at, end_at, session_type, status, stores(name)")
      .eq("member_id", member.id)
      .eq("status", "confirmed")
      .order("start_at", { ascending: true });

    if (june) {
      const start = `${june}-01T00:00:00+09:00`;
      const end = DateTime.fromISO(`${june}-01`, { zone: TZ }).endOf("month").toISO();
      q = q.gte("start_at", start).lte("start_at", end);
    }

    const { data: rows, error: rErr } = await q;
    if (rErr) throw rErr;

    console.log(`reservations: ${rows?.length ?? 0} 件${june ? ` (${june})` : ""}`);
    for (const r of rows ?? []) {
      const storeName = r.stores?.name ?? "恵比寿";
      const sessionType = r.session_type === "online" ? "online" : "store";
      const text = lineMessageWithReservationDetails({
        storeName,
        startAtUtcIso: r.start_at,
        endAtUtcIso: r.end_at,
        sessionType,
      });
      if (dryRun) {
        results.reservations.push({
          start_at: r.start_at,
          store: storeName,
          session_type: sessionType,
          has_address: sessionType === "store" && Boolean(STORE_VISIT_ADDRESS_BY_NAME[storeName]),
          dry_run: true,
        });
        continue;
      }
      await pushLine({ to: member.line_user_id, text, token });
      const start = DateTime.fromISO(r.start_at).setZone(TZ);
      results.reservations.push({ start_at: r.start_at, store: storeName, ok: true });
      console.log("sent reservation", start.toFormat("yyyy-MM-dd HH:mm"), storeName, sessionType);
      await sleep(450);
    }
  }

  console.log(JSON.stringify({ ok: true, dryRun, results }, null, 2));
}

main().catch((e) => {
  console.error(e?.message ?? e);
  process.exit(1);
});
