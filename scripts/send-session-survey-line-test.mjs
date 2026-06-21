/**
 * セッション後アンケート（Flex + LIFF）を EBI020 にテスト送信
 *
 * usage:
 *   node scripts/send-session-survey-line-test.mjs --dry-run
 *   npx vercel env run --environment=production -- node scripts/send-session-survey-line-test.mjs
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
    process.env[k] = v;
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
    process.env.SESSION_SURVEY_SIGN_SECRET?.trim() ||
    process.env.TRAINER_GATE_SECRET?.trim() ||
    "change-me-to-random-long-secret"
  );
}

function signPayload(payload) {
  const secret = signingSecret();
  const full = { ...payload, client_note_id: payload.client_note_id ?? null, exp: Date.now() + 14 * 86400000 };
  const canonical = [full.member_id, full.trainer_id, full.store_id, full.session_date, full.client_note_id ?? "", String(full.exp)].join("|");
  const s = Buffer.from(JSON.stringify(full), "utf8").toString("base64url");
  const sig = createHmac("sha256", secret).update(canonical).digest("base64url");
  return { s, sig };
}

function tokenForStoreName(storeName) {
  if (storeName === "上野") return process.env.LINE_CHANNEL_ACCESS_TOKEN_UENO ?? null;
  if (storeName === "桜木町") return process.env.LINE_CHANNEL_ACCESS_TOKEN_SAKURAGICHO ?? null;
  if (storeName === "新宿") return process.env.LINE_CHANNEL_ACCESS_TOKEN_SHINJUKU ?? null;
  return process.env.LINE_CHANNEL_ACCESS_TOKEN ?? null;
}

function buildFlex({ trainerDisplayName, surveyUrl }) {
  const name = trainerDisplayName.trim() || "トレーナー";
  const intro = `担当トレーナーの${name}です。\n本日のセッションはいかがでしたでしょうか？\n次回のセッションに活かしたいのでご回答お願いします`;
  return {
    type: "flex",
    altText: `担当トレーナーの${name}です。セッション後アンケートのご協力をお願いします`,
    contents: {
      type: "bubble",
      size: "mega",
      body: {
        type: "box",
        layout: "vertical",
        spacing: "md",
        contents: [
          { type: "text", text: "セッション後アンケート", weight: "bold", size: "lg", color: "#1e293b" },
          { type: "text", text: intro, wrap: true, size: "sm", color: "#334155" },
          {
            type: "button",
            style: "primary",
            color: "#e11d48",
            height: "sm",
            action: { type: "uri", label: "アンケートに回答する", uri: surveyUrl },
          },
        ],
      },
    },
  };
}

async function pushFlex({ to, token, message }) {
  if (!token) throw new Error("LINE access token が未設定です");
  const res = await fetch("https://api.line.me/v2/bot/message/push", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ to, messages: [message] }),
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`LINE push failed ${res.status}: ${body}`);
  return body;
}

function parseArgs(argv) {
  const dryRun = argv.includes("--dry-run");
  const codes = argv.filter((a) => !a.startsWith("-"));
  return { dryRun, memberCode: codes[0] ?? DEFAULT_MEMBER_CODE };
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
    if ((!cur || cur === "") && map[k]) process.env[k] = map[k];
  }
}

async function main() {
  loadEnvFile(".env.local");
  loadEnvFile(".env.production.local");
  const fillKeys = [
    "LINE_CHANNEL_ACCESS_TOKEN",
    "LINE_CHANNEL_ACCESS_TOKEN_UENO",
    "LINE_CHANNEL_ACCESS_TOKEN_SAKURAGICHO",
    "LINE_CHANNEL_ACCESS_TOKEN_SHINJUKU",
    "SUPABASE_SERVICE_ROLE_KEY",
    "NEXT_PUBLIC_SUPABASE_URL",
    "TRAINER_GATE_SECRET",
    "NEXT_PUBLIC_APP_URL",
  ];
  fillEmptyFromFile(".env.local", fillKeys);
  fillEmptyFromFile(".env.production.local", fillKeys);

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
    .select("id, member_code, name, line_user_id, is_active")
    .eq("member_code", memberCode)
    .maybeSingle();
  if (mErr) throw mErr;
  if (!member?.line_user_id) {
    console.error(`${memberCode}: line_user_id なし`);
    process.exit(1);
  }

  const sessionDate = DateTime.now().setZone(TZ).toISODate();

  const { data: note } = await supabase
    .from("client_notes")
    .select("id, trainer_id, store_id, trainers(display_name), stores(name)")
    .eq("member_id", member.id)
    .eq("date", sessionDate)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  let trainerId = note?.trainer_id;
  let storeId = note?.store_id;
  let trainerName = note?.trainers?.display_name ?? "テストトレーナー";
  let storeName = note?.stores?.name ?? "恵比寿";

  if (!trainerId || !storeId) {
    const { data: tr } = await supabase.from("trainers").select("id, display_name, store_id").eq("is_active", true).limit(1).maybeSingle();
    const { data: st } = await supabase.from("stores").select("id, name").eq("is_active", true).eq("name", "恵比寿").maybeSingle();
    trainerId = tr?.id;
    storeId = st?.id ?? tr?.store_id;
    trainerName = tr?.display_name ?? trainerName;
    storeName = st?.name ?? storeName;
  }

  if (!trainerId || !storeId) {
    console.error("trainer/store not found");
    process.exit(1);
  }

  let surveyUrl = "";
  let inviteId = null;

  const { data: existingInvite } = await supabase
    .from("session_survey_invites")
    .select("id")
    .eq("member_id", member.id)
    .eq("session_date", sessionDate)
    .maybeSingle();

  if (existingInvite?.id) {
    inviteId = existingInvite.id;
    surveyUrl = `${appUrl}/survey?token=${inviteId}`;
  } else {
    const { data: inserted, error: insErr } = await supabase
      .from("session_survey_invites")
      .insert({
        member_id: member.id,
        trainer_id: trainerId,
        store_id: storeId,
        session_date: sessionDate,
        client_note_id: note?.id ?? null,
      })
      .select("id")
      .single();

    if (!insErr && inserted?.id) {
      inviteId = inserted.id;
      surveyUrl = `${appUrl}/survey?token=${inviteId}`;
    } else {
      const { s, sig } = signPayload({
        member_id: member.id,
        trainer_id: trainerId,
        store_id: storeId,
        session_date: sessionDate,
        client_note_id: note?.id ?? null,
      });
      surveyUrl = `${appUrl}/survey?s=${encodeURIComponent(s)}&sig=${encodeURIComponent(sig)}`;
      if (insErr) {
        console.warn("invite table unavailable — using signed URL (apply migration for response storage)");
      }
    }
  }

  const lineToken = tokenForStoreName(memberCode === DEFAULT_MEMBER_CODE ? "恵比寿" : storeName);
  const flex = buildFlex({ trainerDisplayName: trainerName, surveyUrl });

  console.log("--- test send ---");
  console.log("member:", memberCode, member.line_user_id);
  console.log("trainer:", trainerName);
  console.log("survey_url:", surveyUrl);

  if (dryRun) {
    console.log("dry-run: not sent");
    return;
  }

  await pushFlex({ to: member.line_user_id, token: lineToken, message: flex });
  if (inviteId) {
    await supabase.from("session_survey_invites").update({ line_sent_at: new Date().toISOString() }).eq("id", inviteId);
  }
  console.log("sent OK");
}

main().catch((e) => {
  console.error(e?.message ?? e);
  process.exit(1);
});
