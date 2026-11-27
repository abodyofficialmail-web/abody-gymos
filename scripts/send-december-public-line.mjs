import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/**
 * 2026-11-27 18:00（日本時間）に、低利用者以外の在籍会員へ12月予約開放のLINEを送る。
 * 低利用者は、11月27日10:00より前に作られた11月予約が8回以下の在籍会員。
 * チケットは足さない。同じ理由の台帳がある人には再送しない。
 *
 *   node scripts/send-december-public-line.mjs
 *   node scripts/send-december-public-line.mjs --confirm
 */
const REASON = "december_2026_public_release_line";
const PUBLIC_AT_MS = Date.parse("2026-11-27T18:00:00+09:00");
const UNTIL_MS = Date.parse("2026-11-28T00:00:00+09:00");
const USAGE_START = "2026-11-01T00:00:00+09:00";
const USAGE_END = "2026-12-01T00:00:00+09:00";
const USAGE_CREATED_BEFORE = "2026-11-27T10:00:00+09:00";
const LOW_USAGE_MAX = 8;
const PUBLIC_PNG = "https://abody-gymos.vercel.app/line/december-2026-holiday-notice.png";
const PUBLIC_JPG = "https://abody-gymos.vercel.app/line/december-2026-holiday-notice-preview.jpg";

export const DECEMBER_PUBLIC_LINE_MESSAGE = `こんにちは！
パーソナルジムAbodyです😊

12月分の予約枠を開放いたしました！
スケジュールをご確認のうえ、ぜひお早めにご予約くださいませ🤝

誠に勝手ながら、12月30日〜1月3日の5日間は全店お休みをいただきます。

今年も残り約1ヶ月！
気持ちよく新年を迎えられるよう、12月も私たちトレーナーが全力でサポートいたしますので、一緒に頑張っていきましょう🔥`;

function isActive(member) {
  const status = String(member.membership_status ?? "").toLowerCase();
  if (status === "active") return true;
  if (status === "hiatus" || status === "withdrawn") return false;
  return member.is_active === true;
}

function isTestName(name) {
  return /テスト/.test(String(name ?? "").replace(/\s/g, ""));
}

function isMealAccount(memberCode) {
  const code = String(memberCode ?? "")
    .trim()
    .toUpperCase()
    .replace(/[０-９]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0));
  return /^MPS\d{3}$/.test(code);
}

function channelKeyFor(member) {
  const explicit = String(member.line_channel_key ?? "");
  if (["default", "ueno", "sakuragicho", "shinjuku", "fukuoka"].includes(explicit)) return explicit;
  const code = String(member.member_code ?? "").trim().toUpperCase();
  if (code.startsWith("SAK")) return "sakuragicho";
  if (code.startsWith("UEN")) return "ueno";
  if (code.startsWith("SHI") || code.startsWith("SHJ")) return "shinjuku";
  if (code.startsWith("FUK")) return "fukuoka";
  if (code.startsWith("EBI") || code.startsWith("ON") || code.startsWith("ZAI")) return "default";
  return null;
}

function tokenFor(key) {
  const env = {
    default: process.env.LINE_CHANNEL_ACCESS_TOKEN,
    ueno: process.env.LINE_CHANNEL_ACCESS_TOKEN_UENO,
    sakuragicho: process.env.LINE_CHANNEL_ACCESS_TOKEN_SAKURAGICHO,
    shinjuku: process.env.LINE_CHANNEL_ACCESS_TOKEN_SHINJUKU,
    fukuoka: process.env.LINE_CHANNEL_ACCESS_TOKEN_FUKUOKA,
  };
  const token = String(env[key] ?? "").trim();
  return token || null;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function imageUrls(supabase) {
  const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
  const pngPath = path.join(root, "public/line/december-2026-holiday-notice.png");
  const jpgPath = path.join(root, "public/line/december-2026-holiday-notice-preview.jpg");
  if (!fs.existsSync(pngPath) || !fs.existsSync(jpgPath)) {
    return { original: PUBLIC_PNG, preview: PUBLIC_JPG, source: "public" };
  }
  const bucket = "line-campaign-media";
  const stamp = "december-public-2026-11-27";
  const png = fs.readFileSync(pngPath);
  const jpg = fs.readFileSync(jpgPath);
  const uploads = [
    [`${stamp}/holiday-notice.png`, png, "image/png"],
    [`${stamp}/holiday-notice-preview.jpg`, jpg, "image/jpeg"],
  ];
  const signed = [];
  for (const [storagePath, body, contentType] of uploads) {
    const { error } = await supabase.storage.from(bucket).upload(storagePath, body, { contentType, upsert: true });
    if (error) throw error;
    const signedUrl = await supabase.storage.from(bucket).createSignedUrl(storagePath, 60 * 60 * 6);
    if (signedUrl.error || !signedUrl.data?.signedUrl) throw signedUrl.error ?? new Error("signed url missing");
    signed.push(signedUrl.data.signedUrl);
  }
  return { original: signed[0], preview: signed[1], source: "storage" };
}

async function pushTextAndImage(token, to, image) {
  const res = await fetch("https://api.line.me/v2/bot/message/push", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      to,
      messages: [
        { type: "text", text: DECEMBER_PUBLIC_LINE_MESSAGE },
        { type: "image", originalContentUrl: image.original, previewImageUrl: image.preview },
      ],
    }),
  });
  const body = await res.text().catch(() => "");
  return { ok: res.ok, status: res.status, body: body.slice(0, 300) };
}

export async function sendDecemberPublicLine(supabase, { dryRun, nowMs = Date.now() }) {
  const { fetchAllChecked } = await import("./lib/supabaseFetchAll.mjs");
  if (nowMs < PUBLIC_AT_MS) return { ok: true, skipped: true, reason: "before 18:00 JST" };
  if (nowMs >= UNTIL_MS) return { ok: true, skipped: true, reason: "after 2026-11-28 00:00 JST" };

  const members = await fetchAllChecked(
    supabase,
    "members",
    "id, member_code, name, display_name, membership_status, is_active, line_user_id, line_channel_key",
    undefined,
    "members.december-public-line",
  );
  const usage = await fetchAllChecked(
    supabase,
    "reservations",
    "member_id",
    (q) =>
      q
        .gte("start_at", USAGE_START)
        .lt("start_at", USAGE_END)
        .lt("created_at", USAGE_CREATED_BEFORE)
        .neq("status", "cancelled"),
    "reservations.november-usage",
  );
  const counts = new Map();
  for (const row of usage.rows) {
    const id = String(row.member_id ?? "");
    if (!id) continue;
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  const sentIds = new Set();
  const prior = await fetchAllChecked(
    supabase,
    "member_ticket_ledger",
    "member_id",
    (q) => q.eq("reason", REASON),
    "ledger.december-public-line",
  );
  for (const row of prior.rows) if (row.member_id) sentIds.add(String(row.member_id));

  const lowUsage = new Set();
  const recipients = [];
  let inactive = 0;
  let testOrMeal = 0;
  for (const member of members.rows) {
    if (!member.id) continue;
    if (!isActive(member)) {
      inactive += 1;
      continue;
    }
    if (isTestName(member.name) || isTestName(member.display_name) || isMealAccount(member.member_code)) {
      testOrMeal += 1;
      continue;
    }
    const count = counts.get(String(member.id)) ?? 0;
    if (count <= LOW_USAGE_MAX) {
      lowUsage.add(String(member.id));
      continue;
    }
    if (sentIds.has(String(member.id))) continue;
    recipients.push(member);
  }

  const summary = {
    ok: true,
    dryRun,
    lowUsage: lowUsage.size,
    alreadySent: sentIds.size,
    inactive,
    testOrMeal,
    recipients: recipients.length,
    withLine: recipients.filter((m) => m.line_user_id).length,
    sent: 0,
    skippedNoLine: 0,
    skippedNoToken: 0,
    failed: [],
  };
  if (dryRun) return summary;

  const image = await imageUrls(supabase);
  summary.imageSource = image.source;
  for (const member of recipients) {
    const memberCode = String(member.member_code ?? "").trim().toUpperCase();
    const fresh = await supabase.from("member_ticket_ledger").select("id").eq("member_id", member.id).eq("reason", REASON).limit(1);
    if (fresh.error) {
      summary.failed.push({ memberCode, error: "ledger_read_failed" });
      continue;
    }
    if ((fresh.data ?? []).length > 0) continue;
    if (!member.line_user_id) {
      summary.skippedNoLine += 1;
      continue;
    }
    const key = channelKeyFor(member);
    const token = key ? tokenFor(key) : null;
    if (!token) {
      summary.skippedNoToken += 1;
      summary.failed.push({ memberCode, error: "no_token" });
      continue;
    }
    const pushed = await pushTextAndImage(token, member.line_user_id, image);
    if (!pushed.ok) {
      summary.failed.push({ memberCode, error: `line_${pushed.status}` });
      continue;
    }
    const ledger = await supabase.from("member_ticket_ledger").insert({
      member_id: member.id,
      delta: 0,
      reason: REASON,
      note: "2026-11-27",
    });
    if (ledger.error) {
      summary.failed.push({ memberCode, error: "sent_but_log_failed" });
      continue;
    }
    summary.sent += 1;
    await sleep(120);
  }
  summary.ok = summary.failed.length === 0;
  return summary;
}

async function main() {
  const dryRun = !process.argv.includes("--confirm");
  const { createClient } = await import("@supabase/supabase-js");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY が未設定です。");
  const supabase = createClient(url, key, { auth: { persistSession: false } });
  const nowMs = Date.now();
  if (!dryRun && nowMs < PUBLIC_AT_MS) {
    console.log(JSON.stringify({ ok: true, skipped: true, reason: "before 18:00 JST" }));
    return;
  }
  const result = dryRun
    ? await sendDecemberPublicLine(supabase, { dryRun: true, nowMs: PUBLIC_AT_MS })
    : await sendDecemberPublicLine(supabase, { dryRun: false, nowMs });
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}

const invokedDirectly = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (invokedDirectly) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
