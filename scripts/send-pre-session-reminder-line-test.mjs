/**
 * セッション前リマインド（60分前）+ ヒアリング Flex をテスト送信
 *
 * usage:
 *   node scripts/send-pre-session-reminder-line-test.mjs --dry-run
 *   npx vercel env run --environment=production -- node scripts/send-pre-session-reminder-line-test.mjs
 */
import { createClient } from "@supabase/supabase-js";
import { createHmac } from "crypto";
import { DateTime } from "luxon";
import fs from "fs";
import path from "path";

const TZ = "Asia/Tokyo";
const DEFAULT_MEMBER_CODE = "EBI020";
const DEFAULT_APP_URL = "https://abody-gymos.vercel.app";

function loadEnvFile(name) {
  const p = path.join(process.cwd(), name);
  if (!fs.existsSync(p)) return;
  const raw = fs.readFileSync(p, "utf8");
  for (const line of raw.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i === -1) continue;
    const k = t.slice(0, i).trim();
    const cur = process.env[k];
    if (cur !== undefined && cur !== "") continue;
    let v = t.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (!v) continue;
    process.env[k] = v;
  }
}

function fillEmptyFromFile(name, keys) {
  const p = path.join(process.cwd(), name);
  if (!fs.existsSync(p)) return;
  const raw = fs.readFileSync(p, "utf8");
  const map = {};
  for (const line of raw.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i === -1) continue;
    map[t.slice(0, i).trim()] = t.slice(i + 1).trim().replace(/^["']|["']$/g, "");
  }
  for (const k of keys) {
    const cur = process.env[k];
    const fromFile = map[k];
    if ((!cur || cur === "") && fromFile) process.env[k] = fromFile;
  }
}

function resolveAppUrl() {
  const explicit = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (explicit) return explicit.replace(/\/$/, "");
  if (process.env.VERCEL_ENV === "production") return DEFAULT_APP_URL;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`.replace(/\/$/, "");
  return DEFAULT_APP_URL;
}

function signingSecret() {
  return (
    process.env.PRE_SESSION_SURVEY_SIGN_SECRET?.trim() ||
    process.env.SESSION_SURVEY_SIGN_SECRET?.trim() ||
    process.env.TRAINER_GATE_SECRET?.trim() ||
    "change-me-to-random-long-secret"
  );
}

function signPreSessionPayload(payload) {
  const secret = signingSecret();
  const full = { ...payload, exp: Date.now() + 14 * 86400000 };
  const canonical = [full.reservation_id, full.member_id, String(full.exp)].join("|");
  const s = Buffer.from(JSON.stringify(full), "utf8").toString("base64url");
  const sig = createHmac("sha256", secret).update(canonical).digest("base64url");
  return { s, sig };
}

function tokenForChannelKey(key) {
  if (key === "ueno") return process.env.LINE_CHANNEL_ACCESS_TOKEN_UENO ?? null;
  if (key === "sakuragicho") return process.env.LINE_CHANNEL_ACCESS_TOKEN_SAKURAGICHO ?? null;
  if (key === "shinjuku") return process.env.LINE_CHANNEL_ACCESS_TOKEN_SHINJUKU ?? null;
  if (key === "fukuoka") return process.env.LINE_CHANNEL_ACCESS_TOKEN_FUKUOKA ?? null;
  if (key === "default") return process.env.LINE_CHANNEL_ACCESS_TOKEN ?? null;
  return null;
}

function tokenForStoreName(storeName) {
  if (storeName === "上野") return process.env.LINE_CHANNEL_ACCESS_TOKEN_UENO ?? null;
  if (storeName === "桜木町") return process.env.LINE_CHANNEL_ACCESS_TOKEN_SAKURAGICHO ?? null;
  if (storeName === "新宿") return process.env.LINE_CHANNEL_ACCESS_TOKEN_SHINJUKU ?? null;
  if (storeName === "福岡") return process.env.LINE_CHANNEL_ACCESS_TOKEN_FUKUOKA ?? null;
  return process.env.LINE_CHANNEL_ACCESS_TOKEN ?? null;
}

function inferChannelKeyFromMemberCode(memberCode) {
  const code = String(memberCode ?? "").trim().toUpperCase();
  if (code.startsWith("SAK")) return "sakuragicho";
  if (code.startsWith("UEN")) return "ueno";
  if (code.startsWith("SHJ") || code.startsWith("SHI")) return "shinjuku";
  if (code.startsWith("FUK")) return "fukuoka";
  if (code.startsWith("EBI")) return "default";
  return null;
}

function linePushTokenForMember({ lineChannelKey, memberCode, storeName }) {
  if (lineChannelKey) {
    const token = tokenForChannelKey(lineChannelKey);
    if (token) return { token, source: "line_channel_key" };
  }
  const inferred = inferChannelKeyFromMemberCode(memberCode);
  if (inferred) {
    const token = tokenForChannelKey(inferred);
    if (token) return { token, source: "member_code" };
  }
  // EBI020 テストは恵比寿 Bot（既存セッション後アンケートテストと同じ）
  const storeForToken =
    String(memberCode ?? "").toUpperCase() === DEFAULT_MEMBER_CODE ? "恵比寿" : storeName;
  const storeToken = tokenForStoreName(storeForToken);
  if (storeToken) return { token: storeToken, source: "store_fallback" };
  return { token: null, source: "missing" };
}

function buildReminderText({ startAt, storeName, trainerName, sessionType }) {
  const start = DateTime.fromISO(startAt).setZone(TZ);
  const formattedDate = start.setLocale("ja").toFormat("M月d日（ccc）");
  const formattedTime = start.toFormat("HH:mm");
  const sessionLabel = sessionType === "online" ? "オンライン" : "店舗";
  return `【ご予約リマインド】
本日 ${formattedDate} ${formattedTime} からセッション予定です。

店舗：${storeName}
担当：${trainerName}
セッション種別：${sessionLabel}

お気をつけてお越しください！`.trim();
}

function buildSurveyFlex({ surveyUrl }) {
  const intro =
    "本日の体調やご希望を事前に教えてください。\nトレーナーがセッション内容を準備します。";
  return {
    type: "flex",
    altText: "セッション前ヒアリングのご協力をお願いします",
    contents: {
      type: "bubble",
      size: "mega",
      body: {
        type: "box",
        layout: "vertical",
        spacing: "md",
        contents: [
          { type: "text", text: "セッション前ヒアリング", weight: "bold", size: "lg", color: "#1e293b" },
          { type: "text", text: intro, wrap: true, size: "sm", color: "#334155" },
          {
            type: "button",
            style: "primary",
            color: "#2563eb",
            height: "sm",
            action: { type: "uri", label: "ヒアリングに回答する", uri: surveyUrl },
          },
        ],
      },
    },
  };
}

async function pushMessages({ to, token, messages }) {
  if (!token) throw new Error("LINE access token が未設定です");
  const res = await fetch("https://api.line.me/v2/bot/message/push", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ to, messages }),
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`LINE push failed ${res.status}: ${body}`);
  return body;
}

function parseArgs(argv) {
  const dryRun = argv.includes("--dry-run");
  const codes = argv.filter((a) => !a.startsWith("-"));
  return { dryRun, memberCode: (codes[0] ?? DEFAULT_MEMBER_CODE).toUpperCase() };
}

async function main() {
  // vercel env run より先に空の .env.production.local で上書きしないよう、ファイルは後から補完のみ
  const fillKeys = [
    "LINE_CHANNEL_ACCESS_TOKEN",
    "LINE_CHANNEL_ACCESS_TOKEN_UENO",
    "LINE_CHANNEL_ACCESS_TOKEN_SAKURAGICHO",
    "LINE_CHANNEL_ACCESS_TOKEN_SHINJUKU",
    "LINE_CHANNEL_ACCESS_TOKEN_FUKUOKA",
    "SUPABASE_SERVICE_ROLE_KEY",
    "NEXT_PUBLIC_SUPABASE_URL",
    "TRAINER_GATE_SECRET",
    "SESSION_SURVEY_SIGN_SECRET",
    "PRE_SESSION_SURVEY_SIGN_SECRET",
    "NEXT_PUBLIC_APP_URL",
  ];
  fillEmptyFromFile(".env.local", fillKeys);
  fillEmptyFromFile(".env.production.local", fillKeys);
  // ローカル単体実行用（vercel env run 未使用時）
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    loadEnvFile(".env.local");
  }

  const { dryRun, memberCode } = parseArgs(process.argv.slice(2));
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("Supabase env missing");
    process.exit(1);
  }

  const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const appUrl = resolveAppUrl();

  const { data: member, error: mErr } = await supabase
    .from("members")
    .select("id, member_code, name, line_user_id, line_channel_key, is_active")
    .eq("member_code", memberCode)
    .maybeSingle();
  if (mErr) throw mErr;
  if (!member?.line_user_id) {
    console.error(`${memberCode}: line_user_id なし`);
    process.exit(1);
  }

  const now = DateTime.now().setZone(TZ);
  const { data: reservation } = await supabase
    .from("reservations")
    .select(
      `
      id,
      start_at,
      end_at,
      session_type,
      store_id,
      trainer_id,
      stores ( name ),
      trainers ( display_name )
    `
    )
    .eq("member_id", member.id)
    .eq("status", "confirmed")
    .gte("start_at", now.toISO())
    .order("start_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  let reservationId;
  let startAt;
  let storeName;
  let trainerName;
  let sessionType;

  if (reservation?.id) {
    reservationId = reservation.id;
    startAt = reservation.start_at;
    storeName = reservation.stores?.name ?? "恵比寿";
    trainerName = reservation.trainers?.display_name ?? "担当トレーナー";
    sessionType = reservation.session_type ?? "store";
    console.log("using upcoming reservation:", reservationId);
  } else {
    reservationId = "00000000-0000-4000-8000-000000000099";
    startAt = now.plus({ hours: 1 }).toISO();
    storeName = "恵比寿";
    trainerName = "テストトレーナー";
    sessionType = "store";
    console.warn("no upcoming reservation — using dummy schedule (+1h)");
  }

  const reminderText = buildReminderText({ startAt, storeName, trainerName, sessionType });
  const { s, sig } = signPreSessionPayload({ reservation_id: reservationId, member_id: member.id });
  const surveyUrl = `${appUrl}/pre-session-survey?s=${encodeURIComponent(s)}&sig=${encodeURIComponent(sig)}`;
  const flex = buildSurveyFlex({ surveyUrl });

  const { token, source } = linePushTokenForMember({
    lineChannelKey: member.line_channel_key,
    memberCode: member.member_code,
    storeName,
  });

  console.log("--- pre-session reminder test ---");
  console.log("member:", memberCode, member.line_user_id);
  console.log("line_token_source:", source);
  console.log("store:", storeName);
  console.log("trainer:", trainerName);
  console.log("start_at:", startAt);
  console.log("reminder_text:\n", reminderText);
  console.log("survey_url:", surveyUrl);

  if (dryRun) {
    console.log("dry-run: not sent");
    return;
  }

  if (!token) {
    console.error("LINE token not found");
    process.exit(1);
  }

  await pushMessages({
    to: member.line_user_id,
    token,
    messages: [{ type: "text", text: reminderText }, flex],
  });
  console.log("sent OK (reminder + survey flex)");
}

main().catch((e) => {
  console.error(e?.message ?? e);
  process.exit(1);
});
