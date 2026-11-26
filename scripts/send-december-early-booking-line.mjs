/**
 * 12月先行予約の案内を、対象会員の公式LINEへ送る。
 * LINEトークンは本番API側のものを使う。
 *
 *   node scripts/send-december-early-booking-line.mjs
 *   node scripts/send-december-early-booking-line.mjs --confirm
 */
const PRODUCTION_API = process.env.MEMBER_PLANS_API_URL?.trim() || "https://abody-gymos.vercel.app";

const MEMBER_CODES = [
  "UEN013",
  "SAK063",
  "SHI003",
  "SHI032",
  "EBI034",
  "UEN038",
  "EBI016",
  "UEN010",
  "SAK060",
  "SHI013",
  "EBI004",
  "EBI026",
  "SAK065",
  "SAK036",
  "EBI009",
  "EBI008",
  "UEN033",
  "UEN039",
  "SHI028",
  "SHI030",
  "EBI010",
  "EBI012",
  "UEN034",
  "SAK009",
  "SAK018",
  "SAK044",
  "SAK062",
  "SAK066",
  "SHI019",
  "SHI023",
  "SHI024",
  "SHI029",
  "EBI005",
  "UEN001",
  "UEN003",
  "UEN026",
  "UEN040",
  "SAK061",
  "SHI020",
];

const MESSAGE = `こんにちは！
パーソナルジムAbodyです😊

今月なかなかご来店できなかった方へ、12月分のご予約を先行開放いたしました！
スケジュールをご確認のうえ、ぜひお早めにご予約くださいませ🤝

誠に勝手ながら、12月30日〜1月3日の5日間は全店お休みをいただきます。

年末はお仕事やプライベートで何かと忙しくなる時期かと思いますので、ご予約についてお困りのことがございましたら、お気軽にご相談ください🙌
また、日に日に寒さも増してきましたので、体調を崩さないようお気をつけくださいね！

今年も残り約1ヶ月！
気持ちよく新年を迎えられるよう、12月も私たちトレーナーが全力でサポートいたしますので、一緒に頑張っていきましょう🔥`;

function summarize(results) {
  return (results ?? []).map((row) => ({
    member_code: row.member_code,
    ok: row.ok,
    dry_run: row.dry_run,
    channel: row.channel,
    error: row.error,
  }));
}

async function main() {
  const confirm = process.argv.includes("--confirm");
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!serviceKey) throw new Error("SUPABASE_SERVICE_ROLE_KEY missing");
  if (MEMBER_CODES.length !== 39) throw new Error(`expected 39 codes, got ${MEMBER_CODES.length}`);

  const res = await fetch(`${PRODUCTION_API.replace(/\/$/, "")}/api/admin/send-typhoon-sep21-notice-line`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-service-role-key": serviceKey,
    },
    body: JSON.stringify({
      member_codes: MEMBER_CODES,
      text: MESSAGE,
      dry_run: !confirm,
    }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error(`API error HTTP ${res.status}`, json.error ?? "request_failed");
    process.exit(1);
  }

  const results = summarize(json.results);
  const failed = results.filter((row) => !row.ok);
  console.log(
    JSON.stringify(
      {
        ok: json.ok,
        dry_run: !confirm,
        member_count: MEMBER_CODES.length,
        sent: json.sent,
        ready: json.ready,
        failed: json.failed,
        failed_members: failed,
      },
      null,
      2,
    ),
  );
  if (!json.ok) process.exit(1);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
