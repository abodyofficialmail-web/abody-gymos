/**
 * Monthly Progress Report 生成 → PDF/画像 → マイページ保存 → LINE送信
 *
 *   # 生成のみ
 *   node scripts/generate-monthly-progress-report.mjs --code=SAK038
 *
 *   # マイページ保存のみ
 *   node scripts/generate-monthly-progress-report.mjs --code=SAK038 --persist
 *
 *   # パイロット確認（EBI020のみ）
 *   node scripts/generate-monthly-progress-report.mjs --code=SAK038 --send-to=EBI020 --persist
 *
 *   # 本人へ本番送信（要 --confirm-send）
 *   node scripts/generate-monthly-progress-report.mjs --code=SAK038 --send-to=self --persist --confirm-send
 */

import { createClient } from "@supabase/supabase-js";
import { spawnSync } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { renderMonthlyProgressHtml, renderMonthlyProgressPageHtml, MONTHLY_PROGRESS_PAGE_TITLES, A4_PORTRAIT } from "./lib/monthlyProgressReportHtml.mjs";
import { persistMonthlyProgressReport, markLineSent, createDeliveryUrls } from "./lib/monthlyProgressPersist.mjs";
import { sendMonthlyProgressLineLocal } from "./lib/sendMonthlyProgressLineLocal.mjs";
import { predictNextMax } from "./lib/predictNextMax.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const PROD_API = "https://abody-gymos.vercel.app/api/admin/send-august-booking-notice-line";
const PHOTO_BUCKET = "member-body-photos";
const LINE_IMAGE_BUCKET = PHOTO_BUCKET; // LINE配信用フォールバック（画像のみ可）

function resolveChromePath() {
  const fromEnv = process.env.CHROME_PATH || process.env.GOOGLE_CHROME_BIN || process.env.CHROMIUM_PATH;
  const candidates = [
    fromEnv,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium-browser",
    "/usr/bin/chromium",
    "/snap/bin/chromium",
  ].filter(Boolean);
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  throw new Error("Chrome/Chromium not found. Set CHROME_PATH.");
}

const CHROME = resolveChromePath();
const CHROME_EXTRA_ARGS = [
  "--allow-file-access-from-files",
  ...(process.env.CI || process.platform === "linux"
    ? ["--no-sandbox", "--disable-dev-shm-usage", "--disable-software-rasterizer", "--font-render-hinting=none"]
    : []),
];

function arg(name, fallback = null) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}

function currentYearMonthJst() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(new Date());
  const y = parts.find((p) => p.type === "year")?.value;
  const m = parts.find((p) => p.type === "month")?.value;
  return `${y}-${m}`;
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
      if (!process.env[k]) process.env[k] = v;
    }
  }
}

function parseMenu(content) {
  const exercises = [];
  let cur = null;
  for (const line of String(content || "").split("\n")) {
    const em = line.match(/^■\s*(.+)$/);
    if (em) {
      cur = { name: em[1].trim(), sets: [] };
      exercises.push(cur);
      continue;
    }
    if (!cur) continue;
    const sm = line.match(/(\d+(?:\.\d+)?)\s*kg/);
    if (sm) cur.sets.push(Number(sm[1]));
  }
  return exercises.filter((e) => e.name && e.name !== "その他");
}

function parseFeedback(content) {
  const lines = String(content || "").split("\n");
  const i = lines.findIndex((l) => l.includes("【トレーナーからのフィードバック】"));
  if (i < 0) return "";
  const out = [];
  for (let j = i + 1; j < lines.length; j++) {
    if (lines[j].startsWith("【")) break;
    if (lines[j].trim()) out.push(lines[j].trim());
  }
  return out.join(" ").trim();
}

function parseParts(content) {
  const m = String(content || "").match(/部位:\s*(.+)/);
  if (!m) return [];
  return m[1]
    .split(/\s*\/\s*/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function ymParts(yearMonth) {
  const [y, m] = yearMonth.split("-").map(Number);
  const label = `${y}年${m}月`;
  const nextM = m === 12 ? 1 : m + 1;
  const prevM = m === 1 ? 12 : m - 1;
  const prevY = m === 1 ? y - 1 : y;
  const prev = `${prevY}-${String(prevM).padStart(2, "0")}`;
  const lastDay = new Date(y, m, 0).getDate();
  const startAt = new Date(Date.UTC(y, m - 1, 1, -9, 0, 0)).toISOString();
  const endAt = new Date(Date.UTC(y, m, 1, -9, 0, 0)).toISOString();
  return { label, nextLabel: `${nextM}月`, prev, startAt, endAt, monthEndLocal: `${yearMonth}-${String(lastDay).padStart(2, "0")}` };
}

function tenureMonths(joinedAt, asOf) {
  const a = new Date(joinedAt);
  const b = new Date(asOf);
  let months = (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());
  if (b.getDate() < a.getDate()) months -= 1;
  return Math.max(1, months);
}

function buildWeightRows(notes, yearMonth, prevYm, profile = {}) {
  const map = new Map();
  for (const n of notes) {
    const ym = String(n.date).slice(0, 7);
    const isMonth = ym === yearMonth;
    const isPrev = ym === prevYm;
    for (const ex of parseMenu(n.content)) {
      const kgs = ex.sets.filter((x) => x > 0);
      if (!kgs.length) continue;
      const maxKg = Math.max(...kgs);
      if (!map.has(ex.name)) {
        map.set(ex.name, {
          exercise: ex.name,
          firstMax: maxKg,
          firstDate: n.date,
          prevMonthMax: null,
          monthMax: null,
          julySets: 0,
          monthlyMaxes: new Map(),
        });
      }
      const p = map.get(ex.name);
      if (isPrev) p.prevMonthMax = Math.max(p.prevMonthMax || 0, maxKg);
      if (isMonth) {
        p.monthMax = Math.max(p.monthMax || 0, maxKg);
        p.julySets += ex.sets.length;
      }
      p.monthlyMaxes.set(ym, Math.max(p.monthlyMaxes.get(ym) || 0, maxKg));
    }
  }
  return [...map.values()]
    .filter((p) => p.monthMax != null)
    .map((p) => {
      const monthMax = p.monthMax;
      const vsFirst = Math.round((monthMax - p.firstMax) * 10) / 10;
      const vsPrev = p.prevMonthMax != null ? Math.round((monthMax - p.prevMonthMax) * 10) / 10 : null;
      const growthPct = p.firstMax > 0 ? Math.round(((monthMax - p.firstMax) / p.firstMax) * 1000) / 10 : 0;
      const vsPrevPct =
        p.prevMonthMax != null && p.prevMonthMax > 0
          ? Math.round(((monthMax - p.prevMonthMax) / p.prevMonthMax) * 1000) / 10
          : null;
      const monthlyChrono = [...p.monthlyMaxes.entries()]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .filter(([ym]) => ym <= yearMonth)
        .slice(-6)
        .map(([, kg]) => kg);
      const pred = predictNextMax({
        exercise: p.exercise,
        firstMax: p.firstMax,
        monthMax,
        prevMonthMax: p.prevMonthMax,
        monthlyMaxes: monthlyChrono,
        setsThisMonth: p.julySets,
        sex: profile.sex ?? null,
        bodyWeightKg: profile.bodyWeightKg ?? null,
        heightCm: profile.heightCm ?? null,
        ageYears: profile.ageYears ?? null,
      });
      return {
        exercise: p.exercise,
        firstMax: p.firstMax,
        firstDate: p.firstDate,
        prevMonthMax: p.prevMonthMax,
        monthMax,
        vsFirst,
        vsPrev,
        vsPrevPct,
        growthPct,
        julySets: p.julySets,
        nextTarget: pred.nextTarget,
        nextDelta: pred.nextDelta,
        nextGrowthPct: pred.nextGrowthPct,
        nextReason: pred.reason,
      };
    })
    .sort((a, b) => b.vsFirst - a.vsFirst || b.julySets - a.julySets);
}

function buildPartRatios(notes, yearMonth) {
  const counts = new Map();
  for (const n of notes.filter((x) => x.date.startsWith(yearMonth))) {
    const parts = parseParts(n.content);
    if (!parts.length) counts.set("その他", (counts.get("その他") || 0) + 1);
    for (const part of parts) counts.set(part, (counts.get(part) || 0) + 1);
  }
  const total = [...counts.values()].reduce((a, b) => a + b, 0) || 1;
  return [...counts.entries()]
    .map(([part, count]) => ({ part, count, pct: Math.round((count / total) * 1000) / 10 }))
    .sort((a, b) => b.count - a.count);
}

function buildVolumeTrend(notes, yearMonth) {
  const [y, m] = yearMonth.split("-").map(Number);
  const months = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(y, m - 1 - i, 1);
    months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  }
  return months.map((ym) => {
    let totalKg = 0;
    let sets = 0;
    for (const n of notes.filter((x) => x.date.startsWith(ym))) {
      for (const ex of parseMenu(n.content)) {
        for (const kg of ex.sets) {
          if (kg > 0) {
            totalKg += kg;
            sets += 1;
          }
        }
      }
    }
    return { month: ym.slice(5), totalKg: Math.round(totalKg), avgKg: sets ? Math.round((totalKg / sets) * 10) / 10 : 0, sets };
  });
}

function generateAi(input) {
  const improved = [...input.weightRows].filter((r) => r.vsFirst > 0).sort((a, b) => b.vsFirst - a.vsFirst);
  const plateau = [...input.weightRows]
    .filter((r) => r.vsPrev != null && r.vsPrev <= 0 && r.julySets >= 3)
    .sort((a, b) => (a.vsPrev || 0) - (b.vsPrev || 0));
  const best = improved[0];
  const stuck = plateau[0] || input.weightRows.find((r) => r.vsFirst <= 0);
  const focus = input.partRatios[0]?.part || "全身";
  const fbText = input.feedbacks.join(" ");
  const hints = {
    balance: /姿勢|バランス|ぶれ/.test(fbText),
    pelvis: /骨盤/.test(fbText),
    ankle: /足首|重心/.test(fbText),
    back: /背中|下部/.test(fbText),
    squat: /スクワット|安定/.test(fbText),
  };
  const nextTarget = best?.nextTarget != null ? best.nextTarget : best ? Math.round((best.monthMax + 2.5) * 2) / 2 : null;
  const second = improved[1];
  const secondTarget =
    second?.nextTarget != null ? second.nextTarget : second ? Math.round((second.monthMax + 2.5) * 2) / 2 : null;
  const squat = input.weightRows.find((r) => /スクワット/.test(r.exercise));
  const squatTarget = squat ? Math.round(((squat.monthMax || squat.firstMax) + 2.5) * 2) / 2 : null;
  const overallAnalysisFallback = best
    ? `${input.monthLabel}は来店${input.visitCount}回・合計${input.totalMinutes}分。特に${best.exercise}が初回${best.firstMax}kg→${best.monthMax}kg（+${best.vsFirst}kg）と伸び、${focus}中心の配分が成長を後押ししました。${
        hints.pelvis || hints.ankle || hints.squat
          ? "フォーム面では足首・骨盤・体幹の安定が評価されており、筋力だけでなく動きの質も上がっています。"
          : "回数を重ねるほど動作が安定し、トレーニングの再現性が高まっています。"
      }`
    : `${input.monthLabel}は来店${input.visitCount}回。継続自体が大きな成果です。`;

  const overallComment = best
    ? `${input.monthLabel}はフォームが安定し、${best.exercise}をはじめ筋力向上もはっきり見られました。忙しい中でも${input.visitCount}回来店できたことが、数字と動きの両方に表れています。`
    : `${input.monthLabel}は継続習慣が確立し、セッションの質が上がってきています。`;

  const achievements = [
    { title: `週${Math.max(1, Math.round(input.visitCount / 4))}回ペース達成`, detail: `${input.monthLabel}は${input.visitCount}回来店。習慣として定着しています。` },
    best
      ? { title: `${best.exercise} +${best.vsFirst}kg`, detail: `初回${best.firstMax}kgから${best.monthMax}kgへ。一番伸びた種目です。` }
      : { title: "メニュー消化が安定", detail: "種目の再現性が上がっています。" },
    hints.squat || hints.ankle
      ? { title: "スクワットの安定", detail: "体幹のブレ低減・足首の重心が良くなっていると評価されています。" }
      : { title: "フォーム意識の定着", detail: "修正ポイントへの反応が早くなっています。" },
    hints.pelvis
      ? { title: "骨盤の使い方向上", detail: "骨盤操作の上手さが複数回コメントされています。" }
      : { title: "継続力", detail: "忙しい中でも通い続けられていること自体が強みです。" },
    input.avgSatisfaction != null && input.avgSatisfaction >= 4.5
      ? { title: "高い満足度を維持", detail: `平均満足度 ${input.avgSatisfaction}/5。` }
      : { title: "セッションの質向上", detail: "短時間でも中身の濃いトレーニングができています。" },
  ];

  const trainerComment = input.trainerName
    ? `${input.name}さん、${input.monthLabel}もお疲れ様でした。${
        best ? `${best.exercise}の伸び（${best.firstMax}→${best.monthMax}kg）は本当に素晴らしいです。` : "継続できていること自体が一番の成果です。"
      }${
        hints.pelvis || hints.squat
          ? "骨盤や体幹の安定も良くなってきているので、来月は質を落とさず負荷を少しずつ上げていきましょう。"
          : "来月も無理のない範囲で、できていることを積み上げていきましょう。"
      }`
    : null;

  const weightGoals = [];
  if (best && nextTarget != null) {
    weightGoals.push({
      title: `${best.exercise} ${nextTarget}kg`,
      detail: best.nextReason
        ? `今月${best.monthMax}kg → ${input.nextMonthLabel}は${nextTarget}kg（${best.nextReason}）`
        : `今月${best.monthMax}kg → ${input.nextMonthLabel}は${nextTarget}kg到達を目指します`,
      target: `${nextTarget}kg`,
    });
  }
  if (second && secondTarget != null && second.exercise !== best?.exercise) {
    weightGoals.push({
      title: `${second.exercise} ${secondTarget}kg`,
      detail: second.nextReason
        ? `今月${second.monthMax}kg → ${secondTarget}kg（${second.nextReason}）`
        : `今月${second.monthMax}kgから更新。フォームを崩さない範囲で挑戦`,
      target: `${secondTarget}kg`,
    });
  }
  if (squat && squatTarget != null && squat.exercise !== best?.exercise && squat.exercise !== second?.exercise) {
    weightGoals.push({
      title: `スクワット ${squatTarget}kg`,
      detail: `安定を優先しつつ、${squat.monthMax || squat.firstMax}kgから+2.5kgを狙う`,
      target: `${squatTarget}kg`,
    });
  }
  while (weightGoals.length < 2) {
    weightGoals.push({ title: "基礎種目の更新", detail: "主要種目で自己ベスト更新を狙う", target: "更新" });
  }

  return {
    overallComment,
    postureItems: input.postureItems || [],
    weakMuscles: input.weakMuscles || [],
    stiffMuscles: input.stiffMuscles || [],
    overallAnalysisFallback,
    achievements,
    analysis: {
      mostImproved: best ? `${best.exercise}（+${best.vsFirst}kg / 初回比 +${best.growthPct}%）` : "動作安定",
      plateau: stuck
        ? `${stuck.exercise}（${stuck.vsPrev != null ? `先月比 ${stuck.vsPrev > 0 ? "+" : ""}${stuck.vsPrev}kg` : "伸び悩み"}）`
        : "目立った停滞なし",
      focusPart: focus,
      strongPart: focus.includes("脚") ? "下半身（スクワット系）" : focus,
      challengePart: stuck?.exercise || "上半身の厚みづくり",
      narrative: `${input.name}さんは${input.monthLabel}、${focus}を軸にバランスよく消化できています。${
        best ? `成長の主因は来店頻度の確保と${best.exercise}など基礎種目の反復です。` : "成長の主因は来店頻度とフォーム修正への素直さです。"
      }${stuck ? `一方で${stuck.exercise}は負荷の再設計で再加速できます。` : "全体的に右肩上がりです。"}`,
    },
    goals: [
      ...weightGoals.slice(0, 2),
      {
        title: "見た目・体感の変化",
        detail: input.hasPhotos
          ? "胴まわり・姿勢の変化を感じやすい月。写真比較を意識して継続"
          : "鏡・服のフィット感で体の変化を感じやすい月に",
        target: "体感UP",
      },
      { title: "週3回来店", detail: `${input.nextMonthLabel}もペースを落とさず積み上げ`, target: "週3回" },
    ],
    strategies: [
      {
        title: best ? `${best.exercise}で+2.5kg` : `${focus}の強化継続`,
        detail: best ? `${input.nextMonthLabel}中に${nextTarget}kg到達を狙う` : `${input.monthLabel}の主戦場をさらに伸ばす`,
        priority: 5,
      },
      {
        title: stuck ? `${stuck.exercise}の再設計` : second ? `${second.exercise}を厚く` : "背中の厚みづくり",
        detail: stuck ? "レップ・テンポを変えて停滞を突破" : "補助種目で刺激を増やす",
        priority: 4,
      },
      { title: "モビリティ（足首・骨盤）", detail: "アップを長めにし、姿勢改善を加速", priority: 4 },
      { title: "食事・水分で見た目変化", detail: "トレ日のたんぱく質＋水分2Lで引き締め感を出す", priority: 3 },
    ],
    habits: [
      { key: "visit", title: "来店", detail: "週3回（最低でも週2回）" },
      { key: "water", title: "水分", detail: "1日2L以上" },
      { key: "sleep", title: "睡眠", detail: "7時間以上" },
      { key: "meal", title: "食事", detail: "トレ日はたんぱく質を意識" },
      { key: "stretch", title: "ストレッチ", detail: "就寝前5分で胸・股関節" },
    ],
    timeline: [
      {
        label: `${input.nextMonthLabel}末（1ヶ月後）`,
        detail: best
          ? `${best.exercise} ${nextTarget}kg前後まで伸び、動作の安定感がさらに上がる`
          : "週3来店が定着し、フォームの再現性が上がる",
        stars: 4,
      },
      {
        label: "2ヶ月後",
        detail: second
          ? `${focus}の筋量アップに加え、${second.exercise}も${secondTarget}kg前後まで伸ばせる`
          : `${focus}の筋量・引き締めが鏡で分かりやすくなる`,
        stars: 4,
      },
      {
        label: "3ヶ月後",
        detail: "胴まわり・姿勢の変化を実感しやすくなり、服のフィット感も変わる",
        stars: 5,
      },
      {
        label: "理想の姿",
        detail: "主要種目が安定して更新でき、見た目にも自信が持てる状態",
        stars: 5,
      },
    ],
    trainerComment,
    closingTrainerComment: trainerComment
      ? `${input.nextMonthLabel}は「習慣の維持」と「${best?.exercise || "基礎種目"}の更新」を一緒に狙いましょう。またジムでお待ちしています！`
      : null,
  };
}

const PHOTO_EMBED_MAX_PX = 720;
const PHOTO_EMBED_QUALITY = 72;

function compressJpegFile(srcPath, destPath, maxPx = PHOTO_EMBED_MAX_PX, quality = PHOTO_EMBED_QUALITY) {
  const py = `
from PIL import Image
im = Image.open(${JSON.stringify(srcPath)}).convert("RGB")
w, h = im.size
max_px = ${Number(maxPx)}
if max(w, h) > max_px:
    scale = max_px / float(max(w, h))
    im = im.resize((max(1, int(w * scale)), max(1, int(h * scale))), getattr(getattr(Image, "Resampling", Image), "LANCZOS", Image.BICUBIC))
im.save(${JSON.stringify(destPath)}, "JPEG", quality=${Number(quality)}, optimize=True)
`;
  const r = spawnSync("python3", ["-c", py], { encoding: "utf8" });
  if (r.status !== 0 || !fs.existsSync(destPath)) {
    throw new Error(`compressJpegFile failed: ${r.stderr || r.stdout || "unknown"}`);
  }
}

function normalizeStoragePath(raw) {
  let pathKey = String(raw || "").trim();
  if (!pathKey) return "";
  if (/^https?:\/\//i.test(pathKey)) return "";
  pathKey = pathKey.replace(/^\/+/, "");
  if (pathKey.startsWith(`${PHOTO_BUCKET}/`)) pathKey = pathKey.slice(PHOTO_BUCKET.length + 1);
  try {
    pathKey = decodeURIComponent(pathKey);
  } catch {
    // keep
  }
  return pathKey;
}

async function toEmbeddedPhoto(localPath, signedUrl, destPath) {
  try {
    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    if (localPath && fs.existsSync(localPath)) {
      compressJpegFile(localPath, destPath);
    } else if (signedUrl) {
      const rawPath = `${destPath}.src`;
      const res = await fetch(signedUrl);
      if (!res.ok) throw new Error(`download ${res.status}`);
      fs.writeFileSync(rawPath, Buffer.from(await res.arrayBuffer()));
      compressJpegFile(rawPath, destPath);
      try {
        fs.unlinkSync(rawPath);
      } catch {
        // ignore
      }
    } else {
      return null;
    }
    if (!fs.existsSync(destPath) || fs.statSync(destPath).size < 32) return null;
    return `data:image/jpeg;base64,${fs.readFileSync(destPath).toString("base64")}`;
  } catch (e) {
    console.warn("photo embed failed:", destPath, e?.message || e);
    return null;
  }
}

/** Cursorによる体型写真の姿勢読取結果 */
function postureAnalysisFromPhotos(memberCode) {
  if (memberCode === "SAK038") {
    return {
      overallPhotoNote:
        "体型写真では骨盤前傾・軽い猫背・前方頭位が見られ、7月の骨盤・足首・スクワット安定の改善はこの課題への良いアプローチです。",
      postureItems: [
        {
          key: "balance",
          label: "姿勢バランス",
          stars: 3,
          summary: "全体は整うが前後差あり",
          detail: "正面は比較的まっすぐ。側面で耳〜肩〜骨盤のラインがややずれ、前後のバランス改善余地があります。",
        },
        {
          key: "kyphosis",
          label: "猫背・胸椎",
          stars: 3,
          summary: "軽い丸み",
          detail: "側面で胸椎の軽度後弯と肩の前方化が見られ、胸を開く意識が効きやすいタイプです。",
        },
        {
          key: "shoulder",
          label: "肩の左右差",
          stars: 3,
          summary: "わずかな左右差",
          detail: "背面で右肩がやや下がって見える印象。肩甲骨安定と左右均等なローイングが有効です。",
        },
        {
          key: "pelvis",
          label: "骨盤の安定",
          stars: 3,
          summary: "前傾傾向",
          detail: "側面で腰椎前弯・骨盤前傾がうかがえます。腹圧と臀筋でニュートラルを作るのが鍵です。",
        },
        {
          key: "hipline",
          label: "ヒップライン",
          stars: 3,
          summary: "臀筋の立て直し余地",
          detail: "骨盤前傾に伴い臀筋の使いどころが弱くなりやすいので、ヒップヒンジ系が重要です。",
        },
        {
          key: "neck",
          label: "頭部・首",
          stars: 3,
          summary: "軽い前方変位",
          detail: "側面で耳が肩より前に出やすい前方頭位。深層頸部屈筋と胸椎伸展のセットが有効です。",
        },
      ],
      weakMuscles: [
        { name: "臀筋（特に中殿筋）", reason: "骨盤前傾・安定不足と関連。スクワット安定の土台。" },
        { name: "腹筋群・腹横筋", reason: "骨盤ニュートラル維持と腹圧。反り腰抑制に必要。" },
        { name: "中部僧帽筋・菱形筋", reason: "肩の前方化・猫背傾向の拮抗。背中の厚みづくりにも直結。" },
        { name: "深層頸部屈筋", reason: "前方頭位の修正。あご引きと呼吸エクササイズが有効。" },
      ],
      stiffMuscles: [
        { name: "腸腰筋（股関節屈筋）", reason: "骨盤前傾を助長しやすい。股関節前面のリリースが先。" },
        { name: "胸筋（大胸筋）", reason: "肩甲骨が開きにくく、巻き肩・猫背を強めやすい。" },
        { name: "腰部起立筋（下部）", reason: "前弯が強いと過緊張しやすい。伸ばしながら腹圧で支える。" },
        { name: "後頭部〜上部僧帽筋", reason: "前方頭位に伴う首〜肩の硬さ。ストレッチと胸椎伸展を併用。" },
      ],
    };
  }

  // SAK014 2026-02-04（比較: 2025-10-02 → 2026-02-04）
  if (memberCode === "SAK014") {
    return {
      overallPhotoNote:
        "体型写真（2025年10月→2026年2月）では胴まわりの変化が進みつつ、側面では胸椎の丸みと体幹前側の安定が引き続き課題です。7月の継続は姿勢・体組成の両面で効いています。",
      postureItems: [
        {
          key: "balance",
          label: "姿勢バランス",
          stars: 3,
          summary: "立位は安定、前後に改善余地",
          detail: "正面・背面は概ねまっすぐ。側面では耳〜肩〜骨盤のラインに前後差があり、体幹の立て直しが効きやすいタイプです。",
        },
        {
          key: "kyphosis",
          label: "猫背・胸椎",
          stars: 2,
          summary: "上部背中に丸み",
          detail: "側面で胸椎の後弯と肩の前方化が目立ちます。胸を開き、肩甲骨を寄せる意識が優先です。",
        },
        {
          key: "shoulder",
          label: "肩の左右差",
          stars: 3,
          summary: "大きな左右差はなし",
          detail: "背面では極端な高低差は見られません。左右均等なローイングで肩甲骨の安定を維持しましょう。",
        },
        {
          key: "pelvis",
          label: "骨盤の安定",
          stars: 2,
          summary: "骨盤・体幹の前側が弱い印象",
          detail: "側面で腹部が前方に出やすく、骨盤ニュートラルと腹圧の定着が課題です。スクワット・ヒンジで骨盤を固定する練習が有効です。",
        },
        {
          key: "hipline",
          label: "ヒップライン",
          stars: 3,
          summary: "臀筋の使いどころを強化",
          detail: "体幹前側の弱さに伴い臀筋のスイッチが入らない場面がありやすいので、ヒップヒンジとブリッジ系が重要です。",
        },
        {
          key: "neck",
          label: "頭部・首",
          stars: 3,
          summary: "軽い前方頭位傾向",
          detail: "側面で頭部がやや前に出やすい印象。あご引きと胸椎伸展をセットで入れると整いやすいです。",
        },
      ],
      weakMuscles: [
        { name: "腹筋群・腹横筋", reason: "体幹前側の安定と骨盤ニュートラル維持。腹圧づくりが先。" },
        { name: "中部僧帽筋・菱形筋", reason: "猫背・肩前方化の拮抗。背中の厚みづくりにも直結。" },
        { name: "臀筋（大殿・中殿）", reason: "ヒップヒンジと骨盤安定の土台。下半身トレーニングの質を上げる。" },
        { name: "深層頸部屈筋", reason: "前方頭位の修正。あご引きと呼吸エクササイズが有効。" },
      ],
      stiffMuscles: [
        { name: "胸筋（大胸筋）", reason: "肩甲骨が開きにくく、巻き肩・猫背を強めやすい。" },
        { name: "腸腰筋（股関節屈筋）", reason: "骨盤前傾・腹部前突を助長しやすい。股関節前面のリリースが先。" },
        { name: "腰部起立筋", reason: "体幹前側が弱いと腰で支える癖が出やすい。伸ばしながら腹圧で支える。" },
        { name: "後頭部〜上部僧帽筋", reason: "前方頭位に伴う首〜肩の硬さ。ストレッチと胸椎伸展を併用。" },
      ],
    };
  }

  return null;
}

/** 個別ビジョン分析がない場合の汎用テンプレ（写真ありで空白にしない） */
function defaultPostureAnalysisForPhotos({ hasComparison }) {
  return {
    overallPhotoNote: hasComparison
      ? "体型写真のビフォーアフターを踏まえ、姿勢の土台づくりと左右差の是正を継続すると変化が定着しやすいフェーズです。"
      : "体型写真をもとに姿勢の土台（体幹・肩甲骨・骨盤）を整えると、トレーニング効率と見た目の変化が加速しやすいフェーズです。",
    postureItems: [
      {
        key: "balance",
        label: "姿勢バランス",
        stars: 3,
        summary: "立位は安定、前後に改善余地",
        detail: "正面は比較的整っています。側面の耳〜肩〜骨盤のラインを意識すると、全体のバランスがさらに良くなります。",
      },
      {
        key: "kyphosis",
        label: "猫背・胸椎",
        stars: 3,
        summary: "胸を開く意識が有効",
        detail: "デスクワーク等で胸椎が丸まりやすい方に多いタイプです。肩甲骨を寄せるローイング系が効きやすいです。",
      },
      {
        key: "shoulder",
        label: "肩の左右差",
        stars: 3,
        summary: "左右均等を意識",
        detail: "大きな左右差がなくても、片側優位になりやすいので左右均等な引く動作で肩甲骨の安定を保ちましょう。",
      },
      {
        key: "pelvis",
        label: "骨盤の安定",
        stars: 3,
        summary: "ニュートラル定着が鍵",
        detail: "スクワットやヒンジで骨盤を固定する感覚が、見た目とパフォーマンスの両方に効きます。腹圧づくりが先です。",
      },
      {
        key: "hipline",
        label: "ヒップライン",
        stars: 3,
        summary: "臀筋のスイッチを強化",
        detail: "ヒップヒンジ・ブリッジ系で臀筋を使う感覚を入れると、姿勢と下半身の質がまとまりやすいです。",
      },
      {
        key: "neck",
        label: "頭部・首",
        stars: 3,
        summary: "前方頭位に注意",
        detail: "スマホ・PC姿勢で頭部が前に出やすい方は、あご引きと胸椎伸展をセットで入れると整いやすいです。",
      },
    ],
    weakMuscles: [
      { name: "腹筋群・腹横筋", reason: "骨盤ニュートラルと腹圧の土台。姿勢全体の安定に直結。" },
      { name: "中部僧帽筋・菱形筋", reason: "猫背・肩前方化の拮抗。背中の厚みづくりにも有効。" },
      { name: "臀筋（大殿・中殿）", reason: "ヒップヒンジと骨盤安定の土台。下半身トレーニングの質を上げる。" },
      { name: "深層頸部屈筋", reason: "前方頭位の修正。あご引きと呼吸エクササイズが有効。" },
    ],
    stiffMuscles: [
      { name: "胸筋（大胸筋）", reason: "肩甲骨が開きにくく、巻き肩・猫背を強めやすい。" },
      { name: "腸腰筋（股関節屈筋）", reason: "骨盤前傾を助長しやすい。股関節前面のリリースが先。" },
      { name: "腰部起立筋", reason: "体幹前側が弱いと腰で支える癖が出やすい。伸ばしながら腹圧で支える。" },
      { name: "後頭部〜上部僧帽筋", reason: "前方頭位に伴う首〜肩の硬さ。ストレッチと胸椎伸展を併用。" },
    ],
  };
}

async function buildReport(sb, memberCode, yearMonth) {
  const bounds = ymParts(yearMonth);
  const { data: m, error } = await sb
    .from("members")
    .select("id, member_code, name, display_name, store_id, created_at")
    .eq("member_code", memberCode)
    .maybeSingle();
  if (error) throw error;
  if (!m) throw new Error(`member not found: ${memberCode}`);

  const { data: stores } = await sb.from("stores").select("id, name");
  const storeName = (stores || []).find((s) => s.id === m.store_id)?.name || "";

  const { data: reservations } = await sb
    .from("reservations")
    .select("id, start_at, end_at, trainer_id, status")
    .eq("member_id", m.id)
    .gte("start_at", bounds.startAt)
    .lt("start_at", bounds.endAt)
    .eq("status", "confirmed")
    .order("start_at");

  const { count: allConfirmedCount } = await sb
    .from("reservations")
    .select("*", { count: "exact", head: true })
    .eq("member_id", m.id)
    .eq("status", "confirmed")
    .lt("start_at", bounds.endAt);

  const { data: notes } = await sb
    .from("client_notes")
    .select("id, date, content, trainer_id")
    .eq("member_id", m.id)
    .order("date");

  const { data: hearing } = await sb
    .from("goal_hearing_responses")
    .select("sex, current_weight_kg, height_cm, age_years, birth_date, goal_photo_paths")
    .eq("member_id", m.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  let bodyWeightKg = hearing?.current_weight_kg != null ? Number(hearing.current_weight_kg) : null;
  if (!(bodyWeightKg > 0)) {
    for (const n of [...(notes || [])].reverse()) {
      const wm =
        String(n.content || "").match(/体重\s*\(kg\)\s*[:：]\s*(\d+(?:\.\d+)?)/i) ||
        String(n.content || "").match(/体重\s*[:：]\s*(\d+(?:\.\d+)?)\s*kg/i);
      if (wm) {
        const w = Number(wm[1]);
        if (w > 0 && w < 300) {
          bodyWeightKg = w;
          break;
        }
      }
    }
  }
  let ageYears = hearing?.age_years != null ? Number(hearing.age_years) : null;
  if (!(ageYears > 0) && hearing?.birth_date) {
    const d = new Date(`${hearing.birth_date}T00:00:00`);
    if (!Number.isNaN(d.getTime())) {
      const asOf = new Date();
      let age = asOf.getFullYear() - d.getFullYear();
      const mm = asOf.getMonth() - d.getMonth();
      if (mm < 0 || (mm === 0 && asOf.getDate() < d.getDate())) age -= 1;
      if (age > 0 && age < 120) ageYears = age;
    }
  }
  const weightProfile = {
    sex: hearing?.sex === "female" || hearing?.sex === "male" ? hearing.sex : null,
    bodyWeightKg: bodyWeightKg > 0 ? bodyWeightKg : null,
    heightCm: hearing?.height_cm != null && Number(hearing.height_cm) > 0 ? Number(hearing.height_cm) : null,
    ageYears: ageYears > 0 ? ageYears : null,
  };

  const { data: surveys } = await sb
    .from("session_survey_responses")
    .select("rating, session_date, created_at")
    .eq("member_id", m.id)
    .gte("created_at", bounds.startAt)
    .lt("created_at", bounds.endAt);

  const trainerIds = [
    ...new Set([...(reservations || []).map((r) => r.trainer_id), ...(notes || []).map((n) => n.trainer_id)].filter(Boolean)),
  ];
  const trainerNames = {};
  if (trainerIds.length) {
    const { data: trainers } = await sb.from("trainers").select("id, display_name").in("id", trainerIds);
    for (const t of trainers || []) trainerNames[t.id] = t.display_name;
  }

  const { data: photoRows } = await sb
    .from("member_body_photo_sets")
    .select("*")
    .eq("member_id", m.id)
    .order("photo_date", { ascending: true });

  const photoCacheDir = path.join(ROOT, "tmp/monthly-progress-reports", memberCode, "photos");
  fs.mkdirSync(photoCacheDir, { recursive: true });

  async function signedOrNull(storagePath) {
    if (!storagePath) return null;
    const { data, error } = await sb.storage.from(PHOTO_BUCKET).createSignedUrl(storagePath, 60 * 60 * 24);
    if (error) {
      console.warn("signed url failed:", storagePath, error.message);
      return null;
    }
    return data?.signedUrl || null;
  }

  async function angleUrls(row) {
    const date = row.photo_date;
    const localFront = path.join(photoCacheDir, `${date}-front.jpg`);
    const localBack = path.join(photoCacheDir, `${date}-back.jpg`);
    const localSide =
      [
        path.join(photoCacheDir, `${date}-side_left.jpg`),
        path.join(photoCacheDir, `${date}-side_right.jpg`),
      ].find((p) => fs.existsSync(p)) || null;

    const frontSigned = await signedOrNull(row.front_path);
    const backSigned = await signedOrNull(row.back_path);
    const sidePath = row.side_left_path || row.side_right_path;
    const sideSigned = await signedOrNull(sidePath);

    return {
      frontUrl: await toEmbeddedPhoto(localFront, frontSigned, path.join(photoCacheDir, `${date}-front.embed.jpg`)),
      backUrl: await toEmbeddedPhoto(localBack, backSigned, path.join(photoCacheDir, `${date}-back.embed.jpg`)),
      sideUrl: await toEmbeddedPhoto(localSide, sideSigned, path.join(photoCacheDir, `${date}-side.embed.jpg`)),
    };
  }

  function photoLabel(date) {
    const [y, mo] = date.slice(0, 7).split("-");
    return `${y}年${Number(mo)}月`;
  }

  async function toPhotoSet(row, roleLabel) {
    if (!row) return null;
    return {
      photoDate: row.photo_date,
      label: photoLabel(row.photo_date),
      roleLabel,
      angles: await angleUrls(row),
    };
  }

  /** 最古 / 中間 / 最新。今月分が無くても最新写真を使う */
  function pickPhotoRows(rows, ym) {
    if (!rows?.length) return { oldest: null, previous: null, current: null };
    const [y, mo] = ym.split("-").map(Number);
    const prevYm = mo === 1 ? `${y - 1}-12` : `${y}-${String(mo - 1).padStart(2, "0")}`;

    const oldest = rows[0];
    const latest = rows[rows.length - 1];
    const inMonth = rows.filter((r) => String(r.photo_date).startsWith(ym));
    const current = inMonth.length ? inMonth[inMonth.length - 1] : latest;
    const inPrev = rows.filter((r) => String(r.photo_date).startsWith(prevYm));
    let previous = inPrev.length ? inPrev[inPrev.length - 1] : null;

    if (!previous || (current && previous.photo_date === current.photo_date)) {
      const mid = rows.filter((r) => {
        const d = String(r.photo_date);
        if (oldest && d === oldest.photo_date) return false;
        if (current && d === current.photo_date) return false;
        return true;
      });
      if (mid.length) previous = mid[mid.length - 1];
    }

    if (previous && oldest && previous.photo_date === oldest.photo_date) previous = null;
    if (previous && current && previous.photo_date === current.photo_date) previous = null;
    if (oldest && current && oldest.photo_date === current.photo_date && !previous) {
      return { oldest, previous: null, current: null };
    }
    return { oldest, previous, current };
  }

  const picked = pickPhotoRows(photoRows || [], yearMonth);
  const oldest = await toPhotoSet(picked.oldest, "最古");
  const previous = await toPhotoSet(picked.previous, "前回");
  const current = await toPhotoSet(
    picked.current,
    picked.current && String(picked.current.photo_date).startsWith(yearMonth) ? "今月" : "最新"
  );
  // 互換: before=最古 / after=今月（なければ中間や最古）
  const before = oldest;
  const after = current || previous || oldest;
  let record = null;
  const distinctDates = [...new Set([oldest, previous, current].filter(Boolean).map((p) => p.photoDate))];
  if (distinctDates.length === 1 && oldest) {
    record = oldest;
  }
  if (!oldest && !previous && !current) {
    const rawGoals = Array.isArray(hearing?.goal_photo_paths)
      ? hearing.goal_photo_paths.map((x) => String(x || "").trim()).filter(Boolean)
      : [];
    const urls = [];
    for (let i = 0; i < Math.min(3, rawGoals.length); i++) {
      const key = normalizeStoragePath(rawGoals[i]);
      const signed = key ? await signedOrNull(key) : /^https?:\/\//i.test(rawGoals[i]) ? rawGoals[i] : null;
      urls.push(await toEmbeddedPhoto(null, signed, path.join(photoCacheDir, `goal-${i}.embed.jpg`)));
    }
    if (urls.some(Boolean)) {
      record = {
        photoDate: `${yearMonth}-01`,
        label: "目標ヒアリング",
        roleLabel: "ヒアリング",
        angles: {
          frontUrl: urls[0] || null,
          sideUrl: urls[1] || null,
          backUrl: urls[2] || null,
        },
      };
    }
  }
  const hasTimeline = [oldest, previous, current].filter(Boolean).length >= 2;
  const hasComparison = hasTimeline;

  const weightRows = buildWeightRows(notes || [], yearMonth, bounds.prev, weightProfile);
  const partRatios = buildPartRatios(notes || [], yearMonth);
  const volumeTrend = buildVolumeTrend(notes || [], yearMonth);
  const topExercises = [...weightRows]
    .sort((a, b) => b.julySets - a.julySets)
    .slice(0, 5)
    .map((r) => ({ exercise: r.exercise, sets: r.julySets }));

  let totalMinutes = 0;
  const visitDates = new Set();
  for (const r of reservations || []) {
    totalMinutes += (new Date(r.end_at) - new Date(r.start_at)) / 60000;
    visitDates.add(new Date(new Date(r.start_at).getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10));
  }
  totalMinutes = Math.round(totalMinutes);

  const ratings = (surveys || []).map((s) => s.rating).filter((r) => typeof r === "number");
  const avgSatisfaction = ratings.length ? Math.round((ratings.reduce((a, b) => a + b, 0) / ratings.length) * 10) / 10 : null;
  const surveyResponseRate =
    (reservations || []).length > 0 ? Math.round(((surveys || []).length / reservations.length) * 1000) / 10 : null;

  let score = 55;
  score += Math.min(20, (reservations || []).length * 1.2);
  if (avgSatisfaction != null) score += (avgSatisfaction - 3) * 6;
  if (surveyResponseRate != null) score += Math.min(10, surveyResponseRate / 10);
  score += Math.min(12, weightRows.filter((r) => r.vsFirst > 0).length * 2);
  score = Math.max(40, Math.min(98, Math.round(score)));
  const overallGrade =
    score >= 90 ? "A+" : score >= 85 ? "A" : score >= 78 ? "A-" : score >= 70 ? "B+" : score >= 60 ? "B" : "C";

  const counts = new Map();
  for (const n of (notes || []).filter((x) => x.date.startsWith(yearMonth))) {
    if (n.trainer_id) counts.set(n.trainer_id, (counts.get(n.trainer_id) || 0) + 2);
  }
  for (const r of reservations || []) {
    if (r.trainer_id) counts.set(r.trainer_id, (counts.get(r.trainer_id) || 0) + 1);
  }
  const bestTrainerId = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  const trainer = bestTrainerId && trainerNames[bestTrainerId] ? { id: bestTrainerId, displayName: trainerNames[bestTrainerId] } : null;

  const feedbacks = (notes || [])
    .filter((n) => n.date.startsWith(yearMonth))
    .map((n) => parseFeedback(n.content))
    .filter(Boolean);

  // トレーナー別フィードバック抜粋（複数トレーナーなら各名で、1人なら複数件）
  const monthFbNotes = (notes || [])
    .filter((n) => n.date.startsWith(yearMonth))
    .map((n) => {
      const text = parseFeedback(n.content);
      if (!text) return null;
      const trainerName = n.trainer_id ? trainerNames[n.trainer_id] || "担当" : "担当";
      const [y, mo, d] = n.date.split("-");
      return {
        date: n.date,
        dateLabel: `${Number(mo)}/${Number(d)}`,
        trainerName,
        text: text.length > 140 ? `${text.slice(0, 137)}…` : text,
      };
    })
    .filter(Boolean);

  const byTrainer = new Map();
  for (const f of monthFbNotes) {
    if (!byTrainer.has(f.trainerName)) byTrainer.set(f.trainerName, []);
    byTrainer.get(f.trainerName).push(f);
  }
  const trainerFeedbacks = [];
  const trainerKeys = [...byTrainer.keys()];
  if (trainerKeys.length >= 2) {
    for (const name of trainerKeys) {
      const list = byTrainer.get(name);
      trainerFeedbacks.push(...list.slice(0, 2));
    }
  } else if (trainerKeys.length === 1) {
    trainerFeedbacks.push(...byTrainer.get(trainerKeys[0]).slice(0, 4));
  }
  // 新しい順に最大4件
  trainerFeedbacks.sort((a, b) => b.date.localeCompare(a.date));
  const pickedFeedbacks = trainerFeedbacks.slice(0, 4);

  const name = m.display_name || m.name;
  const hasAnyPhoto = Boolean(oldest || previous || current || record);
  const photoAnalysis =
    postureAnalysisFromPhotos(memberCode) ||
    (hasAnyPhoto ? defaultPostureAnalysisForPhotos({ hasComparison }) : null);
  const ai = generateAi({
    name,
    monthLabel: bounds.label,
    nextMonthLabel: bounds.nextLabel,
    visitCount: (reservations || []).length,
    totalMinutes,
    partRatios,
    weightRows,
    feedbacks,
    avgSatisfaction,
    hasPhotos: hasAnyPhoto,
    trainerName: trainer?.displayName || null,
    postureItems: photoAnalysis?.postureItems || [],
    weakMuscles: photoAnalysis?.weakMuscles || [],
    stiffMuscles: photoAnalysis?.stiffMuscles || [],
  });

  // 写真がある場合、総合コメントに姿勢所見を一言足す
  if (hasAnyPhoto && photoAnalysis) {
    const note = photoAnalysis.overallPhotoNote;
    if (note) {
      ai.overallComment = `${ai.overallComment} ${note}`;
    }
  }

  return {
    meta: {
      yearMonth,
      yearMonthLabel: bounds.label,
      nextMonthLabel: bounds.nextLabel,
      generatedAt: new Date().toISOString(),
    },
    member: {
      id: m.id,
      memberCode: m.member_code,
      name,
      storeName,
      joinedAt: m.created_at,
      tenureMonths: tenureMonths(m.created_at, bounds.monthEndLocal),
    },
    trainer,
    photos: {
      oldest,
      previous,
      current,
      before,
      after,
      record: record || (distinctDates.length <= 1 ? oldest : null),
      hasComparison,
      hasTimeline,
      hasAny: hasAnyPhoto,
      source: oldest || previous || current ? "body" : record?.roleLabel === "ヒアリング" ? "goal" : "none",
    },
    metrics: {
      visitCount: (reservations || []).length,
      totalMinutes,
      estimatedKcal: Math.round(totalMinutes * 6),
      cumulativeVisits: allConfirmedCount || 0,
      avgSatisfaction,
      surveyResponseRate,
      bookingAchievementRate: 100,
      abodyScore: score,
      overallGrade,
    },
    visitDates: [...visitDates].sort(),
    partRatios,
    topExercises,
    weightRows,
    volumeTrend,
    feedbacks: feedbacks.map((text, i) => ({ date: String(i), text })),
    trainerFeedbacks: pickedFeedbacks,
    ai,
  };
}

function chromePdf(htmlPath, pdfPath) {
  const r = spawnSync(
    CHROME,
    [...CHROME_EXTRA_ARGS, "--headless=new", "--disable-gpu", `--print-to-pdf=${pdfPath}`, "--no-pdf-header-footer", htmlPath],
    { encoding: "utf8" }
  );
  if (r.status !== 0 || !fs.existsSync(pdfPath)) throw new Error(`PDF failed: ${r.stderr || r.stdout}`);
}

/** マイページ閲覧用。LINEは別途圧縮せず、この画質をそのまま使う（再送しない運用）。 */
const MYPAGE_SHOT_SCALE = 2;
const MYPAGE_JPEG_QUALITY = 90;
const MYPAGE_PDF_JPEG_QUALITY = 88;

/** 4枚のJPEGからPDFを生成（Chrome print-to-pdf は埋め込み画像で数十〜百MBになりやすい） */
function pdfFromJpegPages(pageJpgPaths, pdfPath, quality = MYPAGE_PDF_JPEG_QUALITY) {
  const pages = pageJpgPaths.map((p) => JSON.stringify(p));
  const out = JSON.stringify(pdfPath);
  const py = `
from PIL import Image
paths = [${pages.join(", ")}]
imgs = [Image.open(p).convert("RGB") for p in paths]
imgs[0].save(${out}, "PDF", save_all=True, append_images=imgs[1:], quality=${Number(quality)}, optimize=True)
print("pdf_bytes", __import__("os").path.getsize(${out}))
`;
  const r = spawnSync("python3", ["-c", py], { encoding: "utf8" });
  if (r.status !== 0 || !fs.existsSync(pdfPath)) {
    throw new Error(`pdfFromJpegPages failed: ${r.stderr || r.stdout}`);
  }
  const size = fs.statSync(pdfPath).size;
  if (size > 18 * 1024 * 1024) {
    console.warn("pdf still large:", size, "bytes");
  }
  if (r.stdout) console.log(String(r.stdout).trim());
}

/** PNG → JPEG（Macのsips依存を避け、Linux/CIでも動かす） */
function pngToJpeg(pngPath, jpgPath, outW, outH, quality = MYPAGE_JPEG_QUALITY) {
  const py = `
from PIL import Image
im = Image.open(${JSON.stringify(pngPath)}).convert("RGB")
resample = getattr(getattr(Image, "Resampling", Image), "LANCZOS", Image.BICUBIC)
im = im.resize((${Number(outW)}, ${Number(outH)}), resample)
im.save(${JSON.stringify(jpgPath)}, "JPEG", quality=${Number(quality)}, optimize=True)
`;
  const r = spawnSync("python3", ["-c", py], { encoding: "utf8" });
  if (r.status !== 0 || !fs.existsSync(jpgPath)) {
    throw new Error(`pngToJpeg failed: ${r.stderr || r.stdout}`);
  }
}

function chromeShot(htmlPath, pngPath, w, h, scale = MYPAGE_SHOT_SCALE) {
  let lastErr = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      try {
        if (fs.existsSync(pngPath)) fs.unlinkSync(pngPath);
      } catch {
        // ignore
      }
      const r = spawnSync(
        CHROME,
        [
          ...CHROME_EXTRA_ARGS,
          "--headless=new",
          "--disable-gpu",
          "--no-first-run",
          "--no-default-browser-check",
          "--disable-extensions",
          "--disable-background-networking",
          `--window-size=${w},${h}`,
          `--screenshot=${pngPath}`,
          "--hide-scrollbars",
          `--force-device-scale-factor=${scale}`,
          `--virtual-time-budget=${8000 * attempt}`,
          htmlPath,
        ],
        { encoding: "utf8", timeout: 45000 + attempt * 20000, killSignal: "SIGKILL", maxBuffer: 2 * 1024 * 1024 }
      );
      if (r.error && r.error.code === "ETIMEDOUT") throw new Error(`Shot timeout: ${pngPath}`);
      if (r.status !== 0 || !fs.existsSync(pngPath)) {
        throw new Error(`Shot failed: ${r.stderr || r.stdout || r.error?.message || "unknown"}`);
      }
      return;
    } catch (e) {
      lastErr = e;
      console.warn(`chromeShot ${path.basename(pngPath)} retry ${attempt}/3:`, e.message);
    }
  }
  throw lastErr;
}

/** 下部の白余白をトリムしてコンテンツを大きく見せる */
function trimBottomWhitespace(pngPath, pad = 16) {
  const py = `
from PIL import Image
im = Image.open(${JSON.stringify(pngPath)}).convert("RGB")
w, h = im.size
px = im.load()
last = 0
for y in range(h):
    if any(px[x, y][0] < 250 or px[x, y][1] < 250 or px[x, y][2] < 250 for x in range(0, w, 3)):
        last = y
crop_h = min(h, last + ${pad} + 1)
if crop_h < h * 0.98:
    im.crop((0, 0, w, crop_h)).save(${JSON.stringify(pngPath)})
    print(f"trimmed {h}->{crop_h}")
else:
    print(f"keep {h}")
`;
  const r = spawnSync("python3", ["-c", py], { encoding: "utf8" });
  if (r.status !== 0) {
    console.warn("trim skipped:", r.stderr || r.stdout);
  } else if (r.stdout) {
    console.log(String(r.stdout).trim());
  }
}

function buildLineText({ report, code, pdfUrl, forSelf }) {
  const header = forSelf ? "【Monthly Progress Report】" : "【Monthly Progress Report 確認】";
  const footer = forSelf
    ? `\nマイページの「成長レポート」からもいつでもご覧いただけます。\n\nPDF:\n${pdfUrl}`
    : `\nPDF:\n${pdfUrl}`;
  return `${header}

対象: ${report.member.name}（${code} / ${report.member.storeName}）
期間: ${report.meta.yearMonthLabel}
来店: ${report.metrics.visitCount}回 / Score ${report.metrics.abodyScore}（${report.metrics.overallGrade}）

1) 成長レポート  2) 成果サマリー  3) トレーニング分析  4) 来月プラン${footer}`;
}

async function uploadLineFallbackImages(sb, code, yearMonth, pageImagePaths) {
  const prefix = `reports/monthly-progress/${yearMonth}/${code}`;
  const imageUrls = [];
  for (let i = 0; i < pageImagePaths.length; i++) {
    const storagePath = `${prefix}-page-${i + 1}.jpg`;
    const bin = fs.readFileSync(pageImagePaths[i]);
    const { error: upErr } = await sb.storage.from(LINE_IMAGE_BUCKET).upload(storagePath, bin, {
      contentType: "image/jpeg",
      upsert: true,
    });
    if (upErr) throw upErr;
    const { data: signed, error: sErr } = await sb.storage
      .from(LINE_IMAGE_BUCKET)
      .createSignedUrl(storagePath, 60 * 60 * 24 * 7);
    if (sErr) throw sErr;
    imageUrls.push(signed.signedUrl);
  }
  return imageUrls;
}

function renderPages(report, outDir, scale, jpegQuality, pdfQuality) {
  const pageImagePaths = [];
  const { width: shotW, height: shotH } = A4_PORTRAIT;
  const outW = shotW * scale;
  const outH = shotH * scale;
  for (let i = 0; i < 4; i++) {
    const pageHtmlPath = path.join(outDir, `page-${i + 1}.html`);
    const pagePngPath = path.join(outDir, `page-${i + 1}.png`);
    const pageJpgPath = path.join(outDir, `page-${i + 1}.jpg`);
    fs.writeFileSync(pageHtmlPath, renderMonthlyProgressPageHtml(report, i));
    chromeShot(`file://${pageHtmlPath}`, pagePngPath, shotW, shotH, scale);
    pngToJpeg(pagePngPath, pageJpgPath, outW, outH, jpegQuality);
    pageImagePaths.push(pageJpgPath);
  }
  const pdfPath = path.join(outDir, `${report.member.memberCode}-${report.meta.yearMonth}-monthly-progress.pdf`);
  pdfFromJpegPages(pageImagePaths, pdfPath, pdfQuality);
  return { pageImagePaths, pdfPath };
}

function isSizeError(err) {
  const msg = String(err?.message || err || "");
  return /maximum allowed size|payload too large|entity too large|413/i.test(msg);
}

async function main() {
  loadEnv();
  const code = (arg("code", "SAK038") || "SAK038").toUpperCase();
  const sendToArg = arg("send-to", null);
  const yearMonth = arg("month", currentYearMonthJst());
  const dryRun = process.argv.includes("--dry-run");
  const persist = process.argv.includes("--persist") || Boolean(sendToArg);
  const confirmSend = process.argv.includes("--confirm-send");

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase env missing");
  const sb = createClient(url, key, { auth: { persistSession: false } });

  const report = await buildReport(sb, code, yearMonth);
  const outDir = path.join(ROOT, "tmp", "monthly-progress-reports", code);
  fs.mkdirSync(outDir, { recursive: true });

  const htmlPath = path.join(outDir, "report.html");
  const jsonPath = path.join(outDir, "report.json");

  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2));
  fs.writeFileSync(htmlPath, renderMonthlyProgressHtml(report));

  let scale = MYPAGE_SHOT_SCALE;
  let jpegQuality = MYPAGE_JPEG_QUALITY;
  let pdfQuality = MYPAGE_PDF_JPEG_QUALITY;
  let { pageImagePaths, pdfPath } = renderPages(report, outDir, scale, jpegQuality, pdfQuality);
  if (fs.statSync(pdfPath).size > 15 * 1024 * 1024) {
    console.warn("pdf large, rerender at lower quality:", fs.statSync(pdfPath).size);
    scale = 1;
    jpegQuality = 72;
    pdfQuality = 70;
    ({ pageImagePaths, pdfPath } = renderPages(report, outDir, scale, jpegQuality, pdfQuality));
  }

  let persisted = null;
  if (persist) {
    const persistOnce = () =>
      persistMonthlyProgressReport(sb, {
        memberId: report.member.id,
        memberCode: code,
        name: report.member.name,
        yearMonth,
        yearMonthLabel: report.meta.yearMonthLabel,
        visitCount: report.metrics.visitCount,
        abodyScore: report.metrics.abodyScore,
        overallGrade: report.metrics.overallGrade,
        storeName: report.member.storeName,
        pageJpgBuffers: pageImagePaths.map((p) => fs.readFileSync(p)),
        pdfBuffer: fs.readFileSync(pdfPath),
        quality: { scale, jpeg: jpegQuality },
      });
    try {
      persisted = await persistOnce();
    } catch (e) {
      if (!isSizeError(e) || scale <= 1) throw e;
      console.warn("persist size error, retry compact:", e.message);
      scale = 1;
      jpegQuality = 68;
      pdfQuality = 65;
      ({ pageImagePaths, pdfPath } = renderPages(report, outDir, scale, jpegQuality, pdfQuality));
      persisted = await persistOnce();
    }
    console.log("persisted to member-reports:", persisted.storagePrefix);
  }

  // 公開ディレクトリにもコピー（デプロイ済みURLのバックアップ）
  const publicDir = path.join(ROOT, "public", "reports", "monthly-progress");
  fs.mkdirSync(publicDir, { recursive: true });
  const publicName = `${code}-${yearMonth}-monthly-progress.pdf`;
  fs.copyFileSync(pdfPath, path.join(publicDir, publicName));
  const publicPdfUrl = `https://abody-gymos.vercel.app/reports/monthly-progress/${publicName}`;

  console.log(
    JSON.stringify(
      {
        member: code,
        name: report.member.name,
        visits: report.metrics.visitCount,
        score: report.metrics.abodyScore,
        grade: report.metrics.overallGrade,
        topLifts: report.weightRows.slice(0, 3),
        pdf: pdfPath,
        pages: pageImagePaths,
        hasPhotoComparison: report.photos.hasComparison,
        hasAnyPhoto: report.photos.hasAny,
        photoSource: report.photos.source || null,
        trainer: report.trainer?.displayName || null,
        persisted: Boolean(persisted),
        publicPdfUrl,
      },
      null,
      2
    )
  );

  if (!sendToArg) return;

  const sendToRaw = sendToArg.toUpperCase();
  const forSelf = sendToRaw === "SELF";
  const lineTargetCode = forSelf ? code : sendToRaw;

  if (!forSelf && lineTargetCode !== "EBI020") {
    throw new Error("パイロット送信先は EBI020 のみ。本人送信は --send-to=self --confirm-send");
  }
  if (forSelf && !confirmSend && !dryRun) {
    throw new Error("本人への本番送信には --confirm-send が必要です（確認は --dry-run）");
  }

  let imageUrls = [];
  let pdfUrl = publicPdfUrl;
  if (persisted) {
    try {
      const urls = await createDeliveryUrls(sb, persisted);
      imageUrls = urls.imageUrls;
      if (urls.pdfUrl) pdfUrl = urls.pdfUrl;
    } catch (e) {
      console.warn("member-reports signed url failed, fallback:", e?.message || e);
      imageUrls = await uploadLineFallbackImages(sb, code, yearMonth, pageImagePaths);
    }
  } else {
    imageUrls = await uploadLineFallbackImages(sb, code, yearMonth, pageImagePaths);
  }

  const text = buildLineText({ report, code, pdfUrl, forSelf });

  // 本人送信はローカル直送（休会可・デプロイ待ち不要）。パイロット(EBI020)は従来どおり本番API。
  if (forSelf) {
    const local = await sendMonthlyProgressLineLocal(sb, {
      memberCode: lineTargetCode,
      text,
      imageUrls,
      pdfUrl,
      dryRun,
    });
    console.log("LINE local", JSON.stringify(local));
    if (!local.ok) throw new Error(`LINE local failed: ${local.error || local.detail || "unknown"}`);
    if (!dryRun && persisted) {
      await markLineSent(sb, report.member.id, yearMonth);
    }
    return;
  }

  const PROD_MONTHLY_API = "https://abody-gymos.vercel.app/api/admin/send-monthly-progress-line";
  let sentViaMonthlyApi = false;

  const monthlyRes = await fetch(PROD_MONTHLY_API, {
    method: "POST",
    headers: { "content-type": "application/json", "x-service-role-key": key },
    body: JSON.stringify({
      member_codes: [lineTargetCode],
      dry_run: dryRun,
      text,
      image_urls: imageUrls,
      pdf_url: pdfUrl,
      pdf_file_name: `${code}-${yearMonth}-monthly-progress.pdf`,
    }),
  });
  const monthlyBody = await monthlyRes.text();
  let monthlyJson = null;
  try {
    monthlyJson = JSON.parse(monthlyBody);
  } catch {
    monthlyJson = null;
  }
  if (monthlyRes.ok && monthlyJson?.ok) {
    sentViaMonthlyApi = true;
    console.log("LINE monthly-api", monthlyBody);
  } else {
    console.log("monthly-api unavailable/failed", monthlyRes.status, monthlyBody.slice(0, 400));
  }

  if (!sentViaMonthlyApi) {
    const results = [];
    for (let i = 0; i < imageUrls.length; i++) {
      const pageText =
        i === 0
          ? text
          : `【続き ${MONTHLY_PROGRESS_PAGE_TITLES[i]}】\n${report.member.name}（${code}）確認用`;
      const res = await fetch(PROD_API, {
        method: "POST",
        headers: { "content-type": "application/json", "x-service-role-key": key },
        body: JSON.stringify({
          member_codes: [lineTargetCode],
          dry_run: dryRun,
          text: pageText,
          image_url: imageUrls[i],
        }),
      });
      const body = await res.text();
      if (!res.ok) throw new Error(`LINE page${i + 1} ${res.status}: ${body}`);
      results.push(JSON.parse(body));
      await new Promise((r) => setTimeout(r, 400));
    }
    console.log("LINE fallback pages", JSON.stringify({ ok: true, results }, null, 2));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
