/**
 * 10月来店少なめ14名へ、テキスト＋動画LINE一括送信（動画はテキストの直後）
 *
 *   node scripts/send-oct-low-booking-line.mjs --dry-run
 *   node scripts/send-oct-low-booking-line.mjs --confirm \
 *     --video-url=https://.../video.mp4 --preview-url=https://.../thumb.jpg
 */
const MEMBER_CODES = [
  "EBI026", // 平林沙希子
  "EBI027", // 佐藤光司
  "ZAI001", // 川畠絢子
  "EBI010", // 宗本龍享
  "SAK060", // 三藤昌弘
  "UEN013", // 高木桂一
  "UEN022", // 岡田強志
  "UEN057", // 森貴昭
  "UEN048", // 田中晃
  "UEN031", // 立野久美子
  "SHI003", // 相川翔
  "SHI012", // 高山紗希
  "SHI032", // bren
  "FUK001", // 山口
];

const MESSAGE = `お忙しい中失礼します！abodyのたけはるです！

今月始まってパーソナルトレーニングがあまりできてないのでご予約どうかなとご連絡させて頂きました！

15日までに可能でしたら4〜5コマ、60分コマ併用しながらご予約頂けたら嬉しいです😊
軽めのトレーニングやストレッチ、筋膜リリースだけでも大丈夫です！お忙しいとは思いますが気晴らしにでもご予約頂けますと嬉しいです！

年末に向けて忙しくなると思いますので今のうちにトレーニングしていきましょう！
セッションチケットもお渡ししますので60分コマ併用しながらでもご利用ください！

今年も残り3ヶ月です！今年も少しでもかっこいい体で終えれるようにサポートさせて頂きます🔥
ご予約取りづらいなどあれば個別でご相談も可能ですのでお気軽にご相談ください！`;

const PRODUCTION_API = process.env.MEMBER_PLANS_API_URL?.trim() || "https://abody-gymos.vercel.app";

function parseArgs(argv) {
  const dryRun = !argv.includes("--confirm");
  const codesArg = argv.find((a) => a.startsWith("--codes="));
  const videoArg = argv.find((a) => a.startsWith("--video-url="));
  const previewArg = argv.find((a) => a.startsWith("--preview-url="));
  const codes = codesArg
    ? codesArg
        .slice("--codes=".length)
        .split(",")
        .map((c) => c.trim().toUpperCase())
        .filter(Boolean)
    : MEMBER_CODES;
  return {
    dryRun,
    codes,
    videoUrl: videoArg ? videoArg.slice("--video-url=".length).trim() : process.env.OCT_LOW_BOOKING_VIDEO_URL?.trim() || null,
    previewUrl: previewArg
      ? previewArg.slice("--preview-url=".length).trim()
      : process.env.OCT_LOW_BOOKING_VIDEO_PREVIEW_URL?.trim() || null,
  };
}

async function main() {
  const { dryRun, codes, videoUrl, previewUrl } = parseArgs(process.argv);
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!serviceKey) throw new Error("SUPABASE_SERVICE_ROLE_KEY missing");

  console.log(`mode: ${dryRun ? "DRY-RUN" : "SEND"}`);
  console.log(`targets: ${codes.length}`);
  console.log(codes.join(", "));
  if (!dryRun && (!videoUrl || !previewUrl)) {
    throw new Error("本番送信には動画URLとプレビューURLが必要です");
  }
  if (videoUrl) console.log(`video: ${videoUrl.slice(0, 80)}...`);
  if (previewUrl) console.log(`preview: ${previewUrl.slice(0, 80)}...`);

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
  if (!json.ok) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
