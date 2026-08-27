/** 8コマ先取り: 固定リスト vs 8月予約数<=8の動的リストを比較 */
import { createClient } from "@supabase/supabase-js";

const STATIC_CODES = [
  "EBI006", "EBI012", "EBI026", "EBI024", "EBI009", "EBI021", "EBI010", "EBI015", "EBI031",
  "SAK009", "SAK043", "SAK033", "SAK049", "SAK050", "SAK044", "SAK025", "SAK028", "SAK017", "SAK030",
  "UEN052", "UEN053", "UEN042", "UEN001", "UEN033", "UEN058", "UEN051", "UEN049", "UEN031",
  "UEN009", "UEN039", "UEN002",
];

const OTHER_CURSOR_CODES = [
  "EBI004", "EBI005", "EBI006", "EBI015", "EBI016", "EBI021", "EBI024", "EBI025", "EBI026", "EBI027", "EBI029",
  "FUK006", "FUK007", "FUK008", "ON001",
  "SAK009", "SAK017", "SAK025", "SAK030", "SAK035", "SAK036", "SAK043", "SAK044", "SAK047", "SAK050", "SAK051", "SAK053", "SAK057",
  "SHI001", "SHI003", "SHI005", "SHI012", "SHI014", "SHI015", "SHI016", "SHI019", "SHI020", "SHI024", "SHI028", "SHI029",
  "UEN001", "UEN002", "UEN018", "UEN031", "UEN033", "UEN037", "UEN040", "UEN042", "UEN049", "UEN050", "UEN051", "UEN052", "UEN053", "UEN055",
];

const MONTH = "2026-08";
const MAX_COUNT = 8;

function isActive(m) {
  const ms = String(m.membership_status ?? "").toLowerCase();
  if (ms === "active") return true;
  if (ms === "hiatus" || ms === "withdrawn") return false;
  return m.is_active === true;
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase env missing");

  const supabase = createClient(url, key, { auth: { persistSession: false } });
  const monthStart = `${MONTH}-01T00:00:00+09:00`;
  const monthEnd = "2026-09-01T00:00:00+09:00";

  const [{ data: members }, { data: reservations }] = await Promise.all([
    supabase.from("members").select("id, member_code, name, display_name, is_active, membership_status, created_at"),
    supabase
      .from("reservations")
      .select("member_id")
      .gte("start_at", monthStart)
      .lt("start_at", monthEnd)
      .neq("status", "cancelled")
      .not("member_id", "is", null),
  ]);

  const counts = new Map();
  for (const r of reservations ?? []) {
    counts.set(r.member_id, (counts.get(r.member_id) ?? 0) + 1);
  }

  const dynamic = [];
  for (const m of members ?? []) {
    if (!isActive(m)) continue;
    const code = String(m.member_code ?? "").toUpperCase();
    if (code === "EBI020" || code === "UEN055") continue;
    const joinedThisMonth = String(m.created_at ?? "").slice(0, 7) === MONTH;
    if (joinedThisMonth) continue;
    const count = counts.get(m.id) ?? 0;
    if (count > MAX_COUNT) continue;
    dynamic.push({
      memberCode: code,
      displayName: m.display_name || m.name || "",
      count,
    });
  }
  dynamic.sort((a, b) => a.count - b.count || a.memberCode.localeCompare(b.memberCode));

  const dynamicCodes = new Set(dynamic.map((d) => d.memberCode));
  const staticSet = new Set(STATIC_CODES);
  const otherSet = new Set(OTHER_CURSOR_CODES);

  const overlapStaticOther = STATIC_CODES.filter((c) => otherSet.has(c));
  const overlapDynamicOther = dynamic.filter((d) => otherSet.has(d.memberCode));
  const onlyStatic = STATIC_CODES.filter((c) => !otherSet.has(c));
  const onlyOther = OTHER_CURSOR_CODES.filter((c) => !staticSet.has(c));

  console.log(
    JSON.stringify(
      {
        month: MONTH,
        criterion: `active, 今月入会除外, count<=${MAX_COUNT}, EBI020/UEN055除外`,
        dynamicCount: dynamic.length,
        staticCount: STATIC_CODES.length,
        otherCursorCount: OTHER_CURSOR_CODES.length,
        dynamicMatchesOtherCursor: overlapDynamicOther.length,
        otherCursorMatchesDynamic: OTHER_CURSOR_CODES.filter((c) => dynamicCodes.has(c)).length,
        staticOverlapOther: overlapStaticOther.length,
        onlyInStatic: onlyStatic,
        onlyInOtherCursor: onlyOther.length,
        onlyInOtherCursorSample: onlyOther.slice(0, 5),
        dynamicList: dynamic.map((d) => `${d.memberCode}|${d.displayName}|${d.count}`),
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
