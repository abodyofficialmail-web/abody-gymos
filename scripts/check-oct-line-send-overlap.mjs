/**
 * 10月LINE送信の対象外会員が、送信した会員と同じLINE IDを共有していないか調べる。
 * node scripts/check-oct-line-send-overlap.mjs
 */
import { createClient } from "@supabase/supabase-js";
import { fetchAllChecked } from "./lib/supabaseFetchAll.mjs";

const SENT = [
  "EBI026",
  "EBI027",
  "ZAI001",
  "EBI010",
  "SAK060",
  "UEN048",
  "UEN031",
  "SHI003",
  "SHI012",
  "SHI032",
  "FUK001",
];

const EXCLUDED = [
  "UEN027", // 浅野清香
  "EBI031", // 鈴木大輝
  "SAK053", // 井上京介
  "UEN014", // 井口誠
  "UEN050", // 福田翔吾
  "SAK050", // 北山潤美
  "YUT001", // ゆうと
  "MPS001", // あ
];

const SEP_DEFAULT = [
  "FUK001", "SAK035", "SAK050", "SHI001", "SHI003", "SHI012", "UEN050", "EBI027", "SAK009",
  "EBI026", "EBI020", "UEN053", "SAK044", "FUK012", "UEN031", "FUK011", "UEN039", "UEN048",
  "SAK051", "SHI011", "SHI019", "SHI024", "UEN045", "SAK002", "SAK017", "SAK043", "SAK036",
];

function tail(id) {
  const s = String(id ?? "");
  if (!s) return "";
  return `…${s.slice(-6)}`;
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("DB未接続");
    process.exit(1);
  }
  const supabase = createClient(url, key, { auth: { persistSession: false } });
  const { rows } = await fetchAllChecked(
    supabase,
    "members",
    "id, member_code, display_name, name, line_user_id, line_channel_key, membership_status, is_active, store_id",
    undefined,
    "members",
  );

  const byLine = new Map();
  for (const m of rows) {
    const line = String(m.line_user_id ?? "").trim();
    if (!line) continue;
    const list = byLine.get(line) ?? [];
    list.push(m);
    byLine.set(line, list);
  }

  const wanted = new Set([...SENT, ...EXCLUDED, ...SEP_DEFAULT]);
  const focused = rows.filter((m) => wanted.has(String(m.member_code ?? "").toUpperCase()));
  const nameHits = rows.filter((m) => /北山|浅野|井上|井口|福田|鈴木大輝|ゆうと/.test(`${m.display_name ?? ""}${m.name ?? ""}`));

  const overlaps = [];
  for (const m of focused) {
    const line = String(m.line_user_id ?? "").trim();
    if (!line) continue;
    const mates = (byLine.get(line) ?? []).filter((x) => x.id !== m.id);
    if (!mates.length) continue;
    overlaps.push({
      memberCode: String(m.member_code ?? "").toUpperCase(),
      name: m.display_name ?? m.name,
      lineTail: tail(line),
      mates: mates.map((x) => ({
        memberCode: String(x.member_code ?? "").toUpperCase(),
        name: x.display_name ?? x.name,
        status: x.membership_status,
      })),
    });
  }

  const excludedRows = EXCLUDED.map((code) => {
    const matches = rows.filter((m) => String(m.member_code ?? "").toUpperCase() === code);
    return {
      code,
      rows: matches.map((m) => ({
        name: m.display_name ?? m.name,
        status: m.membership_status,
        hasLine: Boolean(String(m.line_user_id ?? "").trim()),
        lineTail: tail(m.line_user_id),
        channel: m.line_channel_key ?? null,
      })),
    };
  });

  console.log(
    JSON.stringify(
      {
        memberCount: rows.length,
        duplicateLineGroups: [...byLine.values()].filter((g) => g.length > 1).length,
        excluded: excludedRows,
        nameHits: nameHits.map((m) => ({
          memberCode: String(m.member_code ?? "").toUpperCase(),
          name: m.display_name ?? m.name,
          status: m.membership_status,
          hasLine: Boolean(String(m.line_user_id ?? "").trim()),
          lineTail: tail(m.line_user_id),
        })),
        overlaps,
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
