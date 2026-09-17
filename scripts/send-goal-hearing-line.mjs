/**
 * 目標ヒアリング LINE 送信
 *
 * usage:
 *   node scripts/send-goal-hearing-line.mjs --dry-run EBI020
 *   npx vercel env run --environment=production -- node scripts/send-goal-hearing-line.mjs EBI020
 */
import { createClient } from "@supabase/supabase-js";
import { createHmac } from "crypto";
import fs from "fs";
import path from "path";

const DEFAULT_MEMBER_CODE = "EBI020";
const DEFAULT_APP_URL = "https://abody-gymos.vercel.app";
const TTL_MS = 30 * 24 * 60 * 60 * 1000;

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
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
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
  return DEFAULT_APP_URL;
}

function signingSecret() {
  return (
    process.env.GOAL_HEARING_SIGN_SECRET?.trim() ||
    process.env.PRE_SESSION_SURVEY_SIGN_SECRET?.trim() ||
    process.env.SESSION_SURVEY_SIGN_SECRET?.trim() ||
    process.env.TRAINER_GATE_SECRET?.trim() ||
    "change-me-to-random-long-secret"
  );
}

function signPayload({ member_id, invite_id }) {
  const full = { member_id, invite_id: invite_id ?? null, exp: Date.now() + TTL_MS };
  const canonical = [full.member_id, full.invite_id ?? "", String(full.exp)].join("|");
  const s = Buffer.from(JSON.stringify(full), "utf8").toString("base64url");
  const sig = createHmac("sha256", signingSecret()).update(canonical).digest("base64url");
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

function inferChannelKeyFromMemberCode(memberCode) {
  const code = String(memberCode ?? "").trim().toUpperCase();
  if (code.startsWith("SAK")) return "sakuragicho";
  if (code.startsWith("UEN")) return "ueno";
  if (code.startsWith("SHJ") || code.startsWith("SHI")) return "shinjuku";
  if (code.startsWith("FUK")) return "fukuoka";
  if (code.startsWith("EBI")) return "default";
  return null;
}

function buildMessages(surveyUrl) {
  const text = `【目標ヒアリングのお願い🏋️】

いつもAbodyをご利用いただきありがとうございます！

今後、より一人ひとりの目標に合わせたトレーニングやサポートを行っていくため、目標ヒアリングへのご協力をお願いいたします。

今回のヒアリングでは、

・今後の目標、なりたい身体
・理想の体型がわかる写真（1枚以上）
・生活習慣
・トレーニングで改善したいこと

などをお伺いします！

以前ヒアリングにご回答いただいた会員様も、システム移行に伴い最新の情報を改めて登録させていただくため、お手数をおかけしますが再度ご回答をお願いいたします🙇‍♂️

ご回答いただいた内容と、これまでのセッション記録をもとに、今後のトレーニング方針や目標設定、より一人ひとりに合わせたサポートに活用していきます💪
また月末のAbodyトレーニングレポートにも活用される内容となりますので必ずご回答をお願いいたします🙇

⏱ 所要時間：5〜8分程度

より良いサポートのため、皆さまのご協力をお願いいたします！

▼ヒアリングはこちら`;
  return [
    { type: "text", text: `${text}\n${surveyUrl}` },
    {
      type: "flex",
      altText: "【目標ヒアリングのお願い】ご協力をお願いいたします",
      contents: {
        type: "bubble",
        size: "mega",
        body: {
          type: "box",
          layout: "vertical",
          spacing: "md",
          contents: [
            { type: "text", text: "目標ヒアリング", weight: "bold", size: "lg", color: "#1e293b" },
            {
              type: "text",
              text: "所要5〜8分／なりたい体型の写真（1枚以上）必須",
              wrap: true,
              size: "sm",
              color: "#334155",
            },
          ],
        },
        footer: {
          type: "box",
          layout: "vertical",
          contents: [
            {
              type: "button",
              style: "primary",
              color: "#0f766e",
              height: "sm",
              action: { type: "uri", label: "ヒアリングに回答する", uri: surveyUrl },
            },
          ],
        },
      },
    },
  ];
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
  const fillKeys = [
    "LINE_CHANNEL_ACCESS_TOKEN",
    "LINE_CHANNEL_ACCESS_TOKEN_UENO",
    "LINE_CHANNEL_ACCESS_TOKEN_SAKURAGICHO",
    "LINE_CHANNEL_ACCESS_TOKEN_SHINJUKU",
    "LINE_CHANNEL_ACCESS_TOKEN_FUKUOKA",
    "SUPABASE_SERVICE_ROLE_KEY",
    "NEXT_PUBLIC_SUPABASE_URL",
    "NEXT_PUBLIC_APP_URL",
    "TRAINER_GATE_SECRET",
    "SESSION_SURVEY_SIGN_SECRET",
    "PRE_SESSION_SURVEY_SIGN_SECRET",
    "GOAL_HEARING_SIGN_SECRET",
  ];
  for (const f of [
    ".env.local.bak-before-vercel-run",
    ".env.local.tmp-off",
    ".env.local",
    ".env.production.local",
    ".env.vercel.production",
    ".env.prod.query",
  ]) {
    fillEmptyFromFile(f, fillKeys);
  }
  // vercel env run で空文字が入る場合があるので、空ならバックアップから補完
  for (const k of fillKeys) {
    if (!process.env[k] || !String(process.env[k]).trim()) {
      delete process.env[k];
    }
  }
  for (const f of [".env.local.bak-before-vercel-run", ".env.local.tmp-off"]) {
    fillEmptyFromFile(f, fillKeys);
  }

  const { dryRun, memberCode } = parseArgs(process.argv.slice(2));
  const appUrl = resolveAppUrl();
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!supabaseUrl || !serviceKey) throw new Error("Supabase env が不足しています");

  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: member, error } = await supabase
    .from("members")
    .select("id, member_code, name, line_user_id, line_channel_key, store_id, is_active")
    .eq("member_code", memberCode)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!member?.is_active) throw new Error(`${memberCode} が無効です`);
  if (!member.line_user_id) throw new Error(`${memberCode} に LINE 連携がありません`);

  let inviteId = null;
  if (member.store_id) {
    const expiresAt = new Date(Date.now() + TTL_MS).toISOString();
    const { data: invite, error: invErr } = await supabase
      .from("goal_hearing_invites")
      .insert({
        member_id: member.id,
        store_id: member.store_id,
        expires_at: expiresAt,
      })
      .select("id")
      .single();
    if (!invErr && invite?.id) {
      inviteId = invite.id;
    } else if (invErr) {
      console.warn("goal_hearing_invites unavailable — signed URL only:", invErr.message);
    }
  }

  const { s, sig } = signPayload({ member_id: member.id, invite_id: inviteId });
  const surveyUrl = `${appUrl}/goal-hearing?s=${encodeURIComponent(s)}&sig=${encodeURIComponent(sig)}`;

  const inferred = inferChannelKeyFromMemberCode(memberCode);
  const channelKey = member.line_channel_key || inferred || "default";
  const lineToken = tokenForChannelKey(channelKey) || process.env.LINE_CHANNEL_ACCESS_TOKEN;
  const messages = buildMessages(surveyUrl);

  console.log("--- goal hearing send ---");
  console.log("member:", memberCode, member.name);
  console.log("invite_id:", inviteId ?? "(none)");
  console.log("channel:", channelKey);
  console.log("survey_url:", surveyUrl);

  if (dryRun) {
    console.log("dry-run: not sent");
    return;
  }

  await pushMessages({ to: member.line_user_id, token: lineToken, messages });
  if (inviteId) {
    await supabase
      .from("goal_hearing_invites")
      .update({ line_sent_at: new Date().toISOString() })
      .eq("id", inviteId);
  }
  console.log("sent OK");
}

main().catch((e) => {
  console.error(e?.message ?? e);
  process.exit(1);
});
