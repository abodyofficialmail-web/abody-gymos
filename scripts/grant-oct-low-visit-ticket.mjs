/**
 * 10月来店+20日以降予約が5回以下の残り27名へ、30分チケットを1枚付与する。
 * bonus_ticket_koma を +1 し、member_ticket_ledger に残す。
 * 同じ reason が既にあれば付与しない。
 * node scripts/grant-oct-low-visit-ticket.mjs
 */
import { createClient } from "@supabase/supabase-js";
import { fetchAllChecked } from "./lib/supabaseFetchAll.mjs";

const REASON = "oct2026_low_visit_ticket_30";
const NOTE = "10月来店5回以下 30分チケット1枚";
const DELTA = 1;

/** 会員番号と、リスト上の名前 */
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

function norm(value) {
  return String(value ?? "")
    .replace(/\s+/g, "")
    .toLowerCase();
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("DB未接続");
    process.exit(1);
  }
  const supabase = createClient(url, key, { auth: { persistSession: false } });
  const codes = TARGETS.map(([code]) => code);

  const membersResult = await fetchAllChecked(
    supabase,
    "members",
    "id, member_code, display_name, name, bonus_ticket_koma, membership_status",
    (q) => q.in("member_code", codes),
    "members.ticket27",
  );
  const byCode = new Map(membersResult.rows.map((m) => [String(m.member_code).toUpperCase(), m]));
  const missing = [];
  const nameMismatch = [];
  for (const [code, expected] of TARGETS) {
    const row = byCode.get(code);
    if (!row) {
      missing.push(code);
      continue;
    }
    const names = [norm(row.display_name), norm(row.name)];
    if (!names.includes(norm(expected))) nameMismatch.push({ code, expected, display_name: row.display_name, name: row.name });
  }
  if (missing.length || nameMismatch.length || byCode.size !== TARGETS.length) {
    console.error(JSON.stringify({ missing, nameMismatch, found: byCode.size, expected: TARGETS.length }, null, 2));
    process.exit(1);
  }

  const ids = membersResult.rows.map((m) => m.id);
  const prior = await fetchAllChecked(
    supabase,
    "member_ticket_ledger",
    "member_id, delta, reason, note",
    (q) => q.in("member_id", ids).eq("reason", REASON),
    "member_ticket_ledger.oct2026",
  );
  const already = new Set(prior.rows.map((r) => r.member_id));

  const granted = [];
  const skipped = [];
  const failed = [];
  for (const [code, expected] of TARGETS) {
    const member = byCode.get(code);
    if (already.has(member.id)) {
      skipped.push({ code, name: expected, bonus_ticket_koma: member.bonus_ticket_koma ?? 0 });
      continue;
    }
    const current = Math.max(0, Number(member.bonus_ticket_koma ?? 0) || 0);
    const next = current + DELTA;
    let q = supabase
      .from("members")
      .update({ bonus_ticket_koma: next, updated_at: new Date().toISOString() })
      .eq("id", member.id);
    q = member.bonus_ticket_koma == null ? q.is("bonus_ticket_koma", null) : q.eq("bonus_ticket_koma", member.bonus_ticket_koma);
    const updated = await q.select("bonus_ticket_koma").maybeSingle();
    if (updated.error || !updated.data) {
      failed.push({ code, name: expected, error: updated.error?.message ?? "更新が一致しませんでした" });
      continue;
    }
    const ledger = await supabase.from("member_ticket_ledger").insert({
      member_id: member.id,
      delta: DELTA,
      reason: REASON,
      note: NOTE,
    });
    if (ledger.error) {
      failed.push({
        code,
        name: expected,
        error: `付与後の記録に失敗: ${ledger.error.message}`,
        bonus_ticket_koma: updated.data.bonus_ticket_koma,
      });
      continue;
    }
    granted.push({
      code,
      name: expected,
      before: current,
      after: Number(updated.data.bonus_ticket_koma),
    });
  }

  console.log(JSON.stringify({ reason: REASON, note: NOTE, granted, skipped, failed }, null, 2));
  if (failed.length) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
