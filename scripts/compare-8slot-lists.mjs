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
const NEXT_MONTH = "2026-09";
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
  const sepStart = `${NEXT_MONTH}-01T00:00:00+09:00`;
  const sepEnd = "2026-10-01T00:00:00+09:00";

  const [{ data: members }, { data: augRes }, { data: sepRes }] = await Promise.all([
    supabase.from("members").select("id, member_code, name, display_name, is_active, membership_status, created_at, line_user_id, store_id"),
    supabase
      .from("reservations")
      .select("member_id")
      .gte("start_at", monthStart)
      .lt("start_at", monthEnd)
      .neq("status", "cancelled")
      .not("member_id", "is", null),
    supabase
      .from("reservations")
      .select("member_id")
      .gte("start_at", sepStart)
      .lt("start_at", sepEnd)
      .neq("status", "cancelled")
      .not("member_id", "is", null),
  ]);

  const augCounts = new Map();
  for (const r of augRes ?? []) {
    augCounts.set(r.member_id, (augCounts.get(r.member_id) ?? 0) + 1);
  }
  const sepCounts = new Map();
  for (const r of sepRes ?? []) {
    sepCounts.set(r.member_id, (sepCounts.get(r.member_id) ?? 0) + 1);
  }

  const dynamic = [];
  for (const m of members ?? []) {
    if (!isActive(m)) continue;
    const code = String(m.member_code ?? "").toUpperCase();
    if (code === "EBI020" || code === "UEN055") continue;
    const joinedThisMonth = String(m.created_at ?? "").slice(0, 7) === MONTH;
    if (joinedThisMonth) continue;
    const augCount = augCounts.get(m.id) ?? 0;
    const sepCount = sepCounts.get(m.id) ?? 0;
    if (augCount > MAX_COUNT) continue;
    dynamic.push({
      memberCode: code,
      displayName: m.display_name || m.name || "",
      augCount,
      sepCount,
      hasLine: Boolean(m.line_user_id),
    });
  }
  dynamic.sort((a, b) => a.augCount - b.augCount || a.memberCode.localeCompare(b.memberCode));

  const otherDetails = OTHER_CURSOR_CODES.map((code) => {
    const row = dynamic.find((d) => d.memberCode === code);
    const m = (members ?? []).find((x) => String(x.member_code).toUpperCase() === code);
    return {
      code,
      inAugDynamic: Boolean(row),
      augCount: row?.augCount ?? (m ? (augCounts.get(m.id) ?? 0) : null),
      sepCount: m ? (sepCounts.get(m.id) ?? 0) : null,
      hasLine: m ? Boolean(m.line_user_id) : null,
    };
  });

  const sepMatch = otherDetails.filter((o) => o.sepCount !== null && OTHER_CURSOR_CODES.includes(o.code));
  const sepExactMatch = OTHER_CURSOR_CODES.filter((code) => {
    const m = (members ?? []).find((x) => String(x.member_code).toUpperCase() === code);
    if (!m) return false;
    const userCounts = {
      EBI004: 8, EBI005: 6, EBI006: 8, EBI015: 7, EBI016: 8, EBI021: 8, EBI024: 8, EBI025: 7, EBI026: 6, EBI027: 0, EBI029: 8,
      FUK006: 6, FUK007: 8, FUK008: 8, ON001: 8,
      SAK009: 7, SAK017: 8, SAK025: 8, SAK030: 0, SAK035: 4, SAK036: 8, SAK043: 7, SAK044: 4, SAK047: 0, SAK050: 0, SAK051: 1, SAK053: 6, SAK057: 8,
      SHI001: 5, SHI003: 1, SHI005: 5, SHI012: 0, SHI014: 8, SHI015: 6, SHI016: 7, SHI019: 7, SHI020: 5, SHI024: 5, SHI028: 6, SHI029: 6,
      UEN001: 6, UEN002: 8, UEN018: 3, UEN031: 5, UEN033: 6, UEN037: 5, UEN040: 8, UEN042: 0, UEN049: 4, UEN050: 0, UEN051: 8, UEN052: 6, UEN053: 3, UEN055: 6,
    };
    return (sepCounts.get(m.id) ?? 0) === userCounts[code];
  });

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
        otherCursorSepCountExactMatch: sepExactMatch.length,
        otherCursorDetails: otherDetails,
        sampleSepVsAug: OTHER_CURSOR_CODES.slice(0, 8).map((code) => {
          const m = (members ?? []).find((x) => String(x.member_code).toUpperCase() === code);
          return { code, aug: m ? (augCounts.get(m.id) ?? 0) : null, sep: m ? (sepCounts.get(m.id) ?? 0) : null };
        }),
        dynamicList: dynamic.map((d) => `${d.memberCode}|${d.displayName}|aug${d.augCount}|sep${d.sepCount}`),
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
