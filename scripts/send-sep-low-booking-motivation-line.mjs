/**
 * 9月低予約（合計0〜2回）対象27名へ、テキスト＋動画LINE一括送信（動画はテキストの直後）
 *
 * usage:
 *   node scripts/send-sep-low-booking-motivation-line.mjs --dry-run
 *   node scripts/send-sep-low-booking-motivation-line.mjs --confirm \
 *     --video-url=https://.../video.mp4 \
 *     --preview-url=https://.../thumb.jpg
 *
 * 本番API経由（デプロイ後）:
 *   node scripts/send-sep-low-booking-motivation-line.mjs --api --dry-run
 *   node scripts/send-sep-low-booking-motivation-line.mjs --api --confirm \
 *     --video-url=... --preview-url=...
 */
import fs from "fs";
import path from "path";
import { createClient } from "@supabase/supabase-js";

const LINE_MEDIA_BUCKET = "line-campaign-media";
const DEFAULT_VIDEO_PATH = "sep-low-booking-2026-09/video.mp4";
const DEFAULT_PREVIEW_PATH = "sep-low-booking-2026-09/preview.jpg";

const MEMBER_CODES = [
  "FUK001", "SAK035", "SAK050", "SHI001", "SHI003", "SHI012", "UEN050", "EBI027", "SAK009",
  "EBI026", "EBI020", "UEN053", "SAK044", "FUK012", "UEN031", "FUK011", "UEN039", "UEN048",
  "SAK051", "SHI011", "SHI019", "SHI024", "UEN045", "SAK002", "SAK017", "SAK043", "SAK036",
];

const MESSAGE = `こんにちは！Abodyです😊

9月も折り返しですが、最近身体動かせていますか？

お仕事や予定が忙しく、「行こうと思ってたけど、気づいたら間が空いてしまった…」
という方もいると思います。

そんな時はまず30分だけでも大丈夫です💪

トレーニングは勿論「今日は疲れてるな…」という日はストレッチだけでもOKです！

まずは次の1回から！
予約メニューを開いて、空いている日をチェックしてみてください😊

僕たちも一緒に頑張りますので、今月後半またペースを上げていきましょう💪
ご予約お待ちしてます！`;

const PRODUCTION_API = process.env.MEMBER_PLANS_API_URL?.trim() || "https://abody-gymos.vercel.app";

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
  const videoArg = argv.find((a) => a.startsWith("--video-url="));
  const previewArg = argv.find((a) => a.startsWith("--preview-url="));
  const codes = codesArg
    ? codesArg.split("=")[1].split(",").map((c) => c.trim().toUpperCase()).filter(Boolean)
    : MEMBER_CODES;
  return {
    dryRun,
    useApi,
    codes,
    videoUrl: videoArg ? videoArg.slice("--video-url=".length).trim() : process.env.SEP_LOW_BOOKING_VIDEO_URL?.trim() || null,
    previewUrl: previewArg
      ? previewArg.slice("--preview-url=".length).trim()
      : process.env.SEP_LOW_BOOKING_VIDEO_PREVIEW_URL?.trim() || null,
  };
}

async function resolveMediaUrls(videoUrl, previewUrl) {
  if (videoUrl && previewUrl) return { videoUrl, previewUrl };

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return { videoUrl, previewUrl };

  const supabase = createClient(url, key, { auth: { persistSession: false } });
  const ttl = 60 * 60 * 24 * 30;
  const videoPath = process.env.SEP_LOW_BOOKING_VIDEO_PATH?.trim() || DEFAULT_VIDEO_PATH;
  const previewPath = process.env.SEP_LOW_BOOKING_VIDEO_PREVIEW_PATH?.trim() || DEFAULT_PREVIEW_PATH;

  const [videoSigned, previewSigned] = await Promise.all([
    supabase.storage.from(LINE_MEDIA_BUCKET).createSignedUrl(videoPath, ttl),
    supabase.storage.from(LINE_MEDIA_BUCKET).createSignedUrl(previewPath, ttl),
  ]);
  if (videoSigned.error) throw videoSigned.error;
  if (previewSigned.error) throw previewSigned.error;

  console.log(`media: resolved from storage (${LINE_MEDIA_BUCKET}/${videoPath})`);
  return {
    videoUrl: videoUrl || videoSigned.data.signedUrl,
    previewUrl: previewUrl || previewSigned.data.signedUrl,
  };
}

async function sendViaApi({ dryRun, codes, videoUrl, previewUrl, serviceKey }) {
  const body = {
    member_codes: codes,
    text: MESSAGE,
    dry_run: dryRun,
  };
  if (videoUrl) body.video_url = videoUrl;
  if (previewUrl) body.preview_image_url = previewUrl;

  const res = await fetch(`${PRODUCTION_API.replace(/\/$/, "")}/api/admin/send-sep-low-booking-motivation-line`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-service-role-key": serviceKey,
    },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error(`API error HTTP ${res.status}`, json);
    process.exit(1);
  }
  console.log(JSON.stringify(json, null, 2));
}

async function main() {
  const { dryRun, useApi, codes, videoUrl: videoArg, previewUrl: previewArg } = parseArgs(process.argv);
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!serviceKey) throw new Error("SUPABASE_SERVICE_ROLE_KEY missing");

  const { videoUrl, previewUrl } = await resolveMediaUrls(videoArg, previewArg);

  console.log(`mode: ${dryRun ? "DRY-RUN" : "SEND"}`);
  console.log(`targets: ${codes.length} codes`);
  console.log(`via: ${useApi ? "production API" : "production API"}`);

  if (!dryRun && (!videoUrl || !previewUrl)) {
    throw new Error("本番送信には動画URLが必要です（Storage未アップロードの可能性）");
  }
  if (videoUrl) console.log(`video: ${videoUrl.slice(0, 80)}...`);
  if (previewUrl) console.log(`preview: ${previewUrl.slice(0, 80)}...`);

  await sendViaApi({ dryRun, codes, videoUrl, previewUrl, serviceKey });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
