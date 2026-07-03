/**
 * 6月予約数が少なかった会員へLINE一括送信
 *
 * usage:
 *   node scripts/send-june-low-booking-line.mjs --dry-run
 *   npx vercel env run --environment=production -- node scripts/send-june-low-booking-line.mjs
 *   npx vercel env run --environment=production -- node scripts/send-june-low-booking-line.mjs --codes=UEN052,EBI006
 */
import { createClient } from "@supabase/supabase-js";
import fs from "fs";
import path from "path";

const MEMBER_CODES = [
  "EBI006", "EBI012", "EBI026", "EBI024", "EBI009", "EBI021", "EBI010", "EBI015", "EBI031",
  "SAK009", "SAK043", "SAK033", "SAK049", "SAK050", "SAK044", "SAK025", "SAK028", "SAK017", "SAK030",
  "UEN052", "UEN053", "UEN042", "UEN001", "UEN033", "UEN058", "UEN051", "UEN049", "UEN031",
  "UEN009", "UEN039", "UEN002",
];

const MESSAGE = `お世話になっております！
Abodyです😊


6月のご予約数が少なかったため、個別でご連絡させていただきました。

まずは7月分のご予約を先に8コマお取りいただき、その後ご都合が合いそうでしたら追加でご予約いただけたら嬉しいです！

目標達成に向けて、7月は10回以上のセッションを目標に進めていきたいと考えております💪
お忙しくてなかなか予約が取れない場合は60分でのセッションや体調が悪い場合はストレッチや軽めのトレーニングで調整させていただきますので、気分転換がてら遊びにくる感覚でも大丈夫です！



人気の時間帯は早めに埋まりやすいため、ご予定がお決まりでしたらお早めのご予約をお願いいたします🙇‍♂️


7月もしっかりサポートさせていただきますので、一緒に頑張っていきましょう😊

ご不明点ございましたらお気軽にご連絡ください！
引き続きよろしくお願いいたいします。`;

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
  const dryRun = argv.includes("--dry-run");
  const codesArg = argv.find((a) => a.startsWith("--codes="));
  const codes = codesArg
    ? codesArg.split("=")[1].split(",").map((c) => c.trim().toUpperCase()).filter(Boolean)
    : MEMBER_CODES;
  return { dryRun, codes };
}

function inferChannelKey(memberCode) {
  const code = String(memberCode ?? "").trim().toUpperCase();
  if (code.startsWith("SAK")) return "sakuragicho";
  if (code.startsWith("UEN")) return "ueno";
  if (code.startsWith("SHI") || code.startsWith("SHJ")) return "shinjuku";
  if (code.startsWith("FUK")) return "fukuoka";
  if (code.startsWith("EBI") || code.startsWith("ON") || code.startsWith("ZAI")) return "default";
  return null;
}

function tokenForChannelKey(key) {
  if (key === "ueno") return process.env.LINE_CHANNEL_ACCESS_TOKEN_UENO ?? null;
  if (key === "sakuragicho") return process.env.LINE_CHANNEL_ACCESS_TOKEN_SAKURAGICHO ?? null;
  if (key === "shinjuku") return process.env.LINE_CHANNEL_ACCESS_TOKEN_SHINJUKU ?? null;
  if (key === "fukuoka") return process.env.LINE_CHANNEL_ACCESS_TOKEN_FUKUOKA ?? null;
  if (key === "default") return process.env.LINE_CHANNEL_ACCESS_TOKEN ?? null;
  return null;
}

function resolveToken(member) {
  const explicit = member.line_channel_key;
  if (explicit && ["default", "ueno", "sakuragicho", "shinjuku", "fukuoka"].includes(explicit)) {
    return { channelKey: explicit, token: tokenForChannelKey(explicit), source: "line_channel_key" };
  }
  const inferred = inferChannelKey(member.member_code);
  if (inferred) {
    return { channelKey: inferred, token: tokenForChannelKey(inferred), source: "member_code" };
  }
  return { channelKey: null, token: null, source: "missing" };
}

async function pushLine({ to, text, token }) {
  const res = await fetch("https://api.line.me/v2/bot/message/push", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ to, messages: [{ type: "text", text }] }),
  });
  const body = await res.text();
  return { ok: res.ok, status: res.status, body };
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const { dryRun, codes } = parseArgs(process.argv);
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase env missing");

  const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: members, error } = await supabase
    .from("members")
    .select("id, member_code, name, display_name, line_user_id, line_channel_key, is_active")
    .in("member_code", codes);
  if (error) throw error;

  const byCode = new Map((members ?? []).map((m) => [String(m.member_code).toUpperCase(), m]));
  const missing = codes.filter((c) => !byCode.has(c));

  console.log(`mode: ${dryRun ? "DRY-RUN" : "SEND"}`);
  console.log(`targets: ${codes.length} codes`);
  if (missing.length) console.log("not found:", missing.join(", "));

  let sent = 0;
  let skipped = 0;
  let failed = 0;

  for (const code of codes) {
    const m = byCode.get(code);
    if (!m) {
      console.log(`SKIP ${code}: 会員なし`);
      skipped += 1;
      continue;
    }
    const name = m.display_name || m.name || code;
    if (!m.line_user_id) {
      console.log(`SKIP ${code} ${name}: line_user_id なし`);
      skipped += 1;
      continue;
    }
    const { channelKey, token, source } = resolveToken(m);
    if (!token) {
      console.log(`SKIP ${code} ${name}: LINEトークンなし (channel=${channelKey ?? "?"})`);
      skipped += 1;
      continue;
    }

    if (dryRun) {
      console.log(`OK   ${code} ${name} → channel=${channelKey} (${source}) line_user_id=${m.line_user_id.slice(0, 8)}...`);
      sent += 1;
      continue;
    }

    const r = await pushLine({ to: m.line_user_id, text: MESSAGE, token });
    if (r.ok) {
      console.log(`SENT ${code} ${name} (${channelKey})`);
      sent += 1;
    } else {
      console.log(`FAIL ${code} ${name} status=${r.status} ${r.body}`);
      failed += 1;
    }
    await sleep(300);
  }

  console.log("\n---");
  console.log(dryRun ? `ready: ${sent}` : `sent: ${sent}, failed: ${failed}, skipped: ${skipped}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
