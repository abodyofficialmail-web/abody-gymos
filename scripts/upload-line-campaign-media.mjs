/**
 * LINE配信用動画・プレビュー画像を Supabase Storage にアップロードし、署名付きURLを出力
 *
 * ローカルファイル:
 *   node scripts/upload-line-campaign-media.mjs --video=./video.mp4 --preview=./thumb.jpg
 *
 * ダウンロードURLから（Cursor等でファイル添付できない場合）:
 *   node scripts/upload-line-campaign-media.mjs \
 *     --video-url=https://.../video.mp4 \
 *     --preview-url=https://.../thumb.jpg
 *
 * プレビュー省略時は ffmpeg で動画先頭フレームから生成（ffmpeg 要）
 */
import fs from "fs";
import path from "path";
import { createClient } from "@supabase/supabase-js";
import { execSync } from "child_process";

const BUCKET = "line-campaign-media";
const SIGNED_TTL_SEC = 60 * 60 * 24 * 30;
const CAMPAIGN_PREFIX = "sep-low-booking-2026-09";

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
    process.env[k] = v;
  }
}

loadEnvFile(".env.production.local");
loadEnvFile(".env.local");

function arg(name) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
}

async function readFromUrl(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download failed ${res.status}: ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const ct = res.headers.get("content-type") ?? "";
  return { buf, contentType: ct };
}

function readLocal(filePath) {
  const abs = path.resolve(filePath);
  if (!fs.existsSync(abs)) throw new Error(`file not found: ${abs}`);
  const ext = path.extname(abs).toLowerCase();
  const contentType =
    ext === ".mp4" ? "video/mp4" : ext === ".jpg" || ext === ".jpeg" ? "image/jpeg" : ext === ".png" ? "image/png" : "application/octet-stream";
  return { buf: fs.readFileSync(abs), contentType };
}

function hasFfmpeg() {
  try {
    execSync("ffmpeg -version", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function previewFromVideo(videoPath, outPath) {
  execSync(
    `ffmpeg -y -i "${videoPath}" -ss 00:00:01 -vframes 1 -q:v 2 "${outPath}"`,
    { stdio: "pipe" },
  );
}

async function upload(supabase, storagePath, buf, contentType) {
  const { error } = await supabase.storage.from(BUCKET).upload(storagePath, buf, {
    contentType,
    upsert: true,
  });
  if (error) throw error;
  const { data, error: signErr } = await supabase.storage.from(BUCKET).createSignedUrl(storagePath, SIGNED_TTL_SEC);
  if (signErr) throw signErr;
  return { storagePath, signedUrl: data.signedUrl };
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase env missing");

  const videoLocal = arg("video");
  const previewLocal = arg("preview");
  const videoUrl = arg("video-url");
  const previewUrl = arg("preview-url");

  if (!videoLocal && !videoUrl) {
    console.error(`usage:
  --video=./file.mp4 [--preview=./thumb.jpg]
  --video-url=https://... [--preview-url=https://...]`);
    process.exit(1);
  }

  const supabase = createClient(url, key, { auth: { persistSession: false } });
  const tmpDir = fs.mkdtempSync(path.join(process.cwd(), ".tmp-line-media-"));

  try {
    let videoBuf;
    let videoContentType = "video/mp4";
    let localVideoPath = null;

    if (videoLocal) {
      const v = readLocal(videoLocal);
      videoBuf = v.buf;
      videoContentType = v.contentType;
      localVideoPath = path.resolve(videoLocal);
    } else {
      const tmpVideo = path.join(tmpDir, "video.mp4");
      const v = await readFromUrl(videoUrl);
      videoBuf = v.buf;
      if (v.contentType.includes("mp4")) videoContentType = "video/mp4";
      fs.writeFileSync(tmpVideo, videoBuf);
      localVideoPath = tmpVideo;
    }

    const mb = (videoBuf.length / (1024 * 1024)).toFixed(2);
    console.log(`video size: ${mb} MB`);
    if (videoBuf.length > 20 * 1024 * 1024) {
      throw new Error("20MB超過（Supabaseバケット上限）。LINE自体は200MBまで可");
    }

    let previewBuf;
    let previewContentType = "image/jpeg";

    if (previewLocal) {
      const p = readLocal(previewLocal);
      previewBuf = p.buf;
      previewContentType = p.contentType;
    } else if (previewUrl) {
      const p = await readFromUrl(previewUrl);
      previewBuf = p.buf;
      previewContentType = p.contentType.includes("png") ? "image/png" : "image/jpeg";
    } else if (localVideoPath && hasFfmpeg()) {
      const tmpPreview = path.join(tmpDir, "preview.jpg");
      previewFromVideo(localVideoPath, tmpPreview);
      previewBuf = fs.readFileSync(tmpPreview);
      console.log("preview: generated from video (ffmpeg)");
    } else {
      throw new Error("プレビュー画像が必要です。--preview= または --preview-url= を指定してください（ffmpeg未インストール）");
    }

    const videoUpload = await upload(
      supabase,
      `${CAMPAIGN_PREFIX}/video.mp4`,
      videoBuf,
      videoContentType,
    );
    const previewUpload = await upload(
      supabase,
      `${CAMPAIGN_PREFIX}/preview.jpg`,
      previewBuf,
      previewContentType,
    );

    console.log(
      JSON.stringify(
        {
          bucket: BUCKET,
          video: videoUpload,
          preview: previewUpload,
          signed_ttl_days: SIGNED_TTL_SEC / 86400,
          note: "これらのURLを send-sep-low-booking-motivation-line に渡してください",
        },
        null,
        2,
      ),
    );

    console.log("\n--- GitHub Secrets 登録用 ---");
    console.log(`SEP_LOW_BOOKING_VIDEO_URL=${videoUpload.signedUrl}`);
    console.log(`SEP_LOW_BOOKING_VIDEO_PREVIEW_URL=${previewUpload.signedUrl}`);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
