/**
 * 8コマ先取り案内LINE送信対象リスト（scripts/send-june-low-booking-line.mjs）
 * node --env-file=.env.local scripts/list-8slot-priority-line-targets.mjs
 */
import { createClient } from "@supabase/supabase-js";

const MEMBER_CODES = [
  "EBI006", "EBI012", "EBI026", "EBI024", "EBI009", "EBI021", "EBI010", "EBI015", "EBI031",
  "SAK009", "SAK043", "SAK033", "SAK049", "SAK050", "SAK044", "SAK025", "SAK028", "SAK017", "SAK030",
  "UEN052", "UEN053", "UEN042", "UEN001", "UEN033", "UEN058", "UEN051", "UEN049", "UEN031",
  "UEN009", "UEN039", "UEN002",
];

const MESSAGE_PREVIEW =
  "まずは7月分のご予約を先に8コマお取りいただき、その後ご都合が合いそうでしたら追加でご予約いただけたら嬉しいです！";

function storeFromCode(code) {
  if (code.startsWith("EBI") || code.startsWith("ON") || code.startsWith("ZAI")) return "恵比寿";
  if (code.startsWith("SAK")) return "桜木町";
  if (code.startsWith("UEN")) return "上野";
  if (code.startsWith("SHI") || code.startsWith("SHJ")) return "新宿";
  return "—";
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.log(JSON.stringify({ memberCodes: MEMBER_CODES, count: MEMBER_CODES.length }, null, 2));
    return;
  }

  const supabase = createClient(url, key, { auth: { persistSession: false } });
  const { data: members } = await supabase
    .from("members")
    .select("member_code, display_name, name, store_id, line_user_id, membership_status")
    .in("member_code", MEMBER_CODES);

  const { data: stores } = await supabase.from("stores").select("id, name");
  const storeNameById = Object.fromEntries((stores ?? []).map((s) => [s.id, s.name]));
  const byCode = Object.fromEntries((members ?? []).map((m) => [m.member_code, m]));

  const list = MEMBER_CODES.map((code) => {
    const m = byCode[code];
    return {
      memberCode: code,
      displayName: m?.display_name ?? m?.name ?? "（DB未登録）",
      storePrefix: storeFromCode(code),
      homeStore: m ? (storeNameById[m.store_id] ?? null) : null,
      hasLine: Boolean(m?.line_user_id),
      membershipStatus: m?.membership_status ?? null,
      inDb: Boolean(m),
    };
  });

  const byStore = {};
  for (const row of list) {
    byStore[row.storePrefix] = (byStore[row.storePrefix] ?? 0) + 1;
  }

  console.log(
    JSON.stringify(
      {
        source: "scripts/send-june-low-booking-line.mjs",
        messageKey: MESSAGE_PREVIEW,
        note: "6月予約数が少なかった会員へ「7月分を先に8コマ」案内LINEを送った対象リスト",
        count: list.length,
        byStorePrefix: byStore,
        members: list,
      },
      null,
      2,
    ),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
