/**
 * 10月来店+予約が5回以下の27名へ、ともきの文章と動画を送る。
 * 本文にDriveのURLは入れない。動画はテキストの直後の別メッセージ。
 * 会員番号はこの27名だけ。省略や別リストにはしない。
 *
 *   node scripts/send-oct27-ticket-line.mjs --dry-run
 *   node scripts/send-oct27-ticket-line.mjs --confirm
 */
const TARGETS = [
  ["SAK050", "北山潤美"],
  ["SAK052", "小高祐希"],
  ["UEN022", "岡田強志"],
  ["UEN050", "福田翔吾"],
  ["SHI003", "相川翔"],
  ["SHI012", "高山紗希"],
  ["FUK001", "山口"],
  ["UEN048", "田中晃"],
  ["SHI032", "bren"],
  ["EBI027", "佐藤光司"],
  ["UEN031", "立野久美子"],
  ["UEN053", "中尾啓史"],
  ["SHI023", "鈴木昌輝"],
  ["FUK012", "今門愛"],
  ["EBI010", "宗本龍享"],
  ["ON001", "今井浩美"],
  ["SAK060", "三藤昌弘"],
  ["SHI024", "松田雄陽"],
  ["UEN039", "高橋明久"],
  ["EBI006", "菊橋孔明"],
  ["SHI020", "隨木輝"],
  ["EBI016", "福島二三枝"],
  ["SAK061", "黒田遼"],
  ["SHI028", "望田帆乃"],
  ["SAK049", "藤咲彩香"],
  ["FUK006", "小斉啓祐"],
  ["FUK010", "井口香奈江"],
];

const MESSAGE = [
  "こんにちは！",
  "abodyのともきです\u{1F4AA}",
  "",
  "10月も下旬になりましたね！",
  "最近のトレーニングやお身体の調子はいかがでしょうか？",
  "お仕事やプライベートなどで忙しい時期もあると思いますが、せっかく続けてきた運動習慣を少しずつでも維持していけると嬉しいです！",
  "",
  "今回は、少しでもトレーニングの機会を増やしていただけるように、【追加チケットを1枚プレゼント】させていただきます\u{1F381}",
  "通常の予約2コマと合わせて、合計3コマ分ご利用いただけます！",
  "60分のトレーニングと30分のトレーニングを組み合わせることもできますので、ぜひご自身のスケジュールに合わせてご活用ください\u{1FAF1}\u{1F3FC}\u200D\u{1FAF2}\u{1F3FB}",
  "",
  "また、最近通えていない理由や、通ううえで困っていることなどがあれば、こちらのLINEでお気軽にご連絡ください！",
  "少しでも通いやすくなるようにサポートさせていただきます。",
  "",
  "今月も残りわずかですが、ご自身のペースで一緒に身体を動かしていきましょう！",
  "ご予約お待ちしております！\u{1F525}",
].join("\n");

const PRODUCTION_API = process.env.MEMBER_PLANS_API_URL?.trim() || "https://abody-gymos.vercel.app";
const ALLOWED = new Set(TARGETS.map(([code]) => code));
const NAME_BY_CODE = new Map(TARGETS);
const SOFT_ERRORS = new Set(["no_line_user_id", "withdrawn", "hiatus"]);

function norm(value) {
  return String(value ?? "")
    .replace(/\s+/g, "")
    .toLowerCase();
}

function assertMessage() {
  if (MESSAGE.includes("drive.google.com") || MESSAGE.includes("http://") || MESSAGE.includes("https://")) {
    throw new Error("本文にURLが含まれています");
  }
  if (!MESSAGE.startsWith("こんにちは！") || !MESSAGE.includes("abodyのともきです")) {
    throw new Error("本文が指定の文章ではありません");
  }
  if (!MESSAGE.includes("【追加チケットを1枚プレゼント】")) {
    throw new Error("本文にチケットの案内がありません");
  }
}

function assertMediaUrl(url, label) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`${label} がURLではありません`);
  }
  if (parsed.protocol !== "https:") throw new Error(`${label} はHTTPSが必要です`);
  const host = parsed.hostname.toLowerCase();
  if (host.includes("drive.google.com") || host.includes("drive.usercontent.google.com")) {
    throw new Error(`${label} がGoogle DriveのURLです`);
  }
  if (!host.endsWith(".supabase.co")) throw new Error(`${label} の保存先が違います`);
  if (!parsed.pathname.includes("/oct-low-visit-ticket-2026-10/")) {
    throw new Error(`${label} のファイル名が違います`);
  }
  return `${parsed.origin}${parsed.pathname}`;
}

function lineDetail(row) {
  return String(row?.detail ?? "")
    .replace(/https?:\/\/\S+/g, "[url]")
    .slice(0, 300);
}

function summarize(results) {
  return results.map((row) => ({
    member_code: row.member_code,
    name: row.name ?? null,
    ok: row.ok,
    error: row.error ?? null,
    has_video: row.has_video ?? false,
    status: row.status ?? null,
    detail: lineDetail(row) || null,
  }));
}

function selectedCodes(argv) {
  const hit = argv.find((arg) => arg.startsWith("--only="));
  if (!hit) return TARGETS.map(([code]) => code);
  const codes = hit
    .slice("--only=".length)
    .split(",")
    .map((code) => code.trim().toUpperCase())
    .filter(Boolean);
  if (!codes.length || new Set(codes).size !== codes.length) throw new Error("再送対象の会員番号が空か重複しています");
  for (const code of codes) {
    if (!ALLOWED.has(code)) throw new Error(`対象外の会員番号です: ${code}`);
  }
  return codes;
}

function assertResults(json, dryRun, expectedCodes) {
  const results = Array.isArray(json.results) ? json.results : [];
  if (json.member_count !== expectedCodes.length || results.length !== expectedCodes.length) {
    throw new Error(`対象人数が一致しません (${json.member_count}/${results.length})`);
  }
  if (Boolean(json.dry_run) !== dryRun) throw new Error("dry_run の結果が一致しません");
  const expected = new Set(expectedCodes);
  const seen = new Set();
  for (const row of results) {
    const code = String(row.member_code ?? "").toUpperCase();
    if (!expected.has(code) || seen.has(code)) throw new Error(`対象外の会員番号です: ${code}`);
    seen.add(code);
    if (row.ok) {
      if (!row.has_video) throw new Error(`${code} に動画が付いていません`);
      const expected = NAME_BY_CODE.get(code);
      if (norm(row.name) !== norm(expected)) {
        throw new Error(`${code} の名前が違います: ${row.name}`);
      }
    }
  }
  if (seen.size !== expected.size) throw new Error("対象の会員番号が足りません");
  const hard = results.filter((row) => !row.ok && !SOFT_ERRORS.has(row.error));
  return hard;
}

async function postOne({ code, dryRun, videoUrl, previewUrl, serviceKey }) {
  const body = {
    member_codes: [code],
    text: MESSAGE,
    video_url: videoUrl,
    preview_image_url: previewUrl,
    dry_run: dryRun,
  };
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
    console.error(`API error HTTP ${res.status}`, json.error ?? "");
    process.exit(1);
  }
  assertResults(json, dryRun, [code]);
  return json.results[0];
}

async function main() {
  assertMessage();
  const dryRun = !process.argv.includes("--confirm");
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!serviceKey) throw new Error("SUPABASE_SERVICE_ROLE_KEY missing");
  const videoUrl = process.env.OCT27_VIDEO_URL?.trim() || "";
  const previewUrl = process.env.OCT27_PREVIEW_URL?.trim() || "";
  if (!videoUrl || !previewUrl) throw new Error("動画URLとプレビューURLが必要です");

  const codes = selectedCodes(process.argv);
  if (new Set(TARGETS.map(([code]) => code)).size !== 27) throw new Error("会員番号リストが27名ではありません");

  console.log(`mode: ${dryRun ? "DRY-RUN" : "SEND"}`);
  console.log(`targets: ${codes.join(", ")}`);
  console.log(`video: ${assertMediaUrl(videoUrl, "動画")}`);
  console.log(`preview: ${assertMediaUrl(previewUrl, "プレビュー")}`);
  console.log("--- message ---");
  console.log(MESSAGE);
  console.log("--- end message ---");

  const results = [];
  for (let index = 0; index < codes.length; index += 1) {
    const code = codes[index];
    let row = null;
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      row = await postOne({ code, dryRun, videoUrl, previewUrl, serviceKey });
      const detail = lineDetail(row);
      if (detail) console.log(`${code} detail: ${detail}`);
      const monthly = /monthly limit/i.test(detail);
      if (dryRun || row.ok || row.error !== "line_push_failed" || row.status !== 429 || monthly) break;
      console.log(`${code}: LINEの送信制限。${attempt}回目のあと60秒待って再送します`);
      await new Promise((resolve) => setTimeout(resolve, 60000));
    }
    results.push(row);
    if (!dryRun && index < codes.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, 20000));
    }
  }
  const hard = results.filter((row) => !row.ok && !SOFT_ERRORS.has(row.error));
  console.log(JSON.stringify({
    dry_run: dryRun,
    member_count: results.length,
    sent: results.filter((row) => row.ok && !dryRun).length,
    ready: results.filter((row) => row.ok && dryRun).length,
    failed: results.filter((row) => !row.ok).length,
    results: summarize(results),
  }, null, 2));
  if (hard.length) {
    console.error(`送信できない会員がいます: ${hard.map((row) => `${row.member_code}:${row.error}`).join(", ")}`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
