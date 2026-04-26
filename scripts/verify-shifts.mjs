import { createClient } from "@supabase/supabase-js";

/**
 * このスクリプトは「期待CSV」とDBの2026-05シフトを突合します。
 * - is_break=true は除外（休憩ブロック）
 * - 比較キー: date,start_time,end_time,trainer_name,store_name,break_minutes
 */

const EXPECTED_CSV = `
date,start_time,end_time,trainer_name,store_name,break_minutes
2026-05-01,16:00,22:00,ともき,恵比寿,0
2026-05-01,09:30,10:30,だいき,恵比寿,0
2026-05-01,10:00,13:00,ひろむ,上野,0
2026-05-01,16:00,22:00,ひろむ,上野,0
2026-05-01,10:00,13:00,りょう,桜木町,0
2026-05-01,16:00,21:30,りょう,桜木町,0
2026-05-02,10:00,17:00,ひろむ,上野,0
2026-05-02,10:00,17:00,ともき,桜木町,0
2026-05-03,10:00,16:00,ともき,恵比寿,0
2026-05-03,10:00,18:00,りょう,桜木町,0
2026-05-04,10:00,16:00,ひろむ,上野,0
2026-05-04,09:00,16:00,りょう,桜木町,0
2026-05-05,10:00,16:00,ともき,恵比寿,0
2026-05-05,10:00,17:00,ひろむ,上野,0
2026-05-05,10:00,17:00,りょう,桜木町,0
2026-05-06,10:00,16:00,せいや,恵比寿,0
2026-05-06,10:00,16:00,ひろむ,上野,0
2026-05-06,09:00,17:00,りょう,桜木町,0
2026-05-07,16:00,22:00,ともき,恵比寿,0
2026-05-07,10:00,13:00,ひろむ,上野,0
2026-05-07,16:00,22:00,ひろむ,上野,0
2026-05-07,14:00,21:30,りょう,桜木町,0
2026-05-08,09:30,10:30,ともき,恵比寿,0
2026-05-08,16:00,21:00,ともき,恵比寿,0
2026-05-08,14:00,22:00,ひろむ,上野,0
2026-05-08,09:00,13:00,りょう,桜木町,0
2026-05-08,16:00,21:30,りょう,桜木町,0
2026-05-09,10:00,18:00,せいや,上野,0
2026-05-09,10:00,18:00,りょう,桜木町,0
2026-05-10,16:00,22:00,ともき,恵比寿,0
2026-05-10,10:00,17:00,ひろむ,上野,0
2026-05-10,10:00,17:00,りょう,桜木町,0
2026-05-11,10:00,13:00,ひろむ,上野,0
2026-05-11,16:00,20:00,ひろむ,上野,0
2026-05-11,10:00,13:00,りょう,桜木町,0
2026-05-11,16:00,21:30,りょう,桜木町,0
2026-05-12,09:30,11:00,だいき,恵比寿,0
2026-05-12,16:00,22:00,ともき,恵比寿,0
2026-05-12,10:00,13:00,ひろむ,上野,0
2026-05-12,16:00,22:00,ひろむ,上野,0
2026-05-12,15:00,21:00,りょう,桜木町,0
2026-05-13,16:00,22:00,ひろむ,恵比寿,0
2026-05-13,14:00,22:00,せいや,上野,0
2026-05-14,16:00,22:00,ともき,恵比寿,0
2026-05-14,10:00,13:00,ひろむ,上野,0
2026-05-14,16:00,22:00,ひろむ,上野,0
2026-05-14,14:00,21:30,りょう,桜木町,0
2026-05-15,16:00,22:00,ともき,恵比寿,0
2026-05-15,09:30,10:30,だいき,恵比寿,0
2026-05-15,15:00,22:00,ひろむ,上野,0
2026-05-15,09:00,13:00,りょう,桜木町,0
2026-05-15,16:00,20:00,りょう,桜木町,0
2026-05-16,10:00,16:00,ともき,恵比寿,0
2026-05-16,10:00,18:00,せいや,上野,0
2026-05-16,10:00,18:00,りょう,桜木町,0
2026-05-17,10:00,17:00,ひろむ,上野,0
2026-05-17,10:00,17:00,りょう,桜木町,0
2026-05-18,16:00,22:00,ひろむ,恵比寿,0
2026-05-18,09:00,16:00,せいや,上野,0
2026-05-18,16:00,22:00,ともき,桜木町,0
2026-05-19,16:00,22:00,ともき,恵比寿,0
2026-05-19,09:30,11:00,だいき,恵比寿,0
2026-05-19,10:00,13:00,せいや,上野,0
2026-05-19,16:00,22:00,せいや,上野,0
2026-05-19,09:00,13:00,りょう,桜木町,0
2026-05-19,16:00,19:00,りょう,桜木町,0
2026-05-20,16:00,22:00,ともき,恵比寿,0
2026-05-20,10:00,13:00,せいや,上野,0
2026-05-20,16:00,22:00,せいや,上野,0
2026-05-20,13:00,22:00,ひろむ,桜木町,0
2026-05-21,16:00,22:00,だいき,恵比寿,0
2026-05-21,11:00,13:00,ひろむ,上野,0
2026-05-21,16:00,20:00,ひろむ,上野,0
2026-05-21,14:00,20:30,りょう,桜木町,0
2026-05-22,16:00,22:00,ともき,恵比寿,0
2026-05-22,09:30,11:00,だいき,恵比寿,0
2026-05-22,11:00,13:00,ひろむ,上野,0
2026-05-22,16:00,20:00,ひろむ,上野,0
2026-05-22,09:00,13:00,りょう,桜木町,0
2026-05-22,16:00,20:00,りょう,桜木町,0
2026-05-23,10:00,18:00,せいや,上野,0
2026-05-23,10:00,18:00,ともき,桜木町,0
2026-05-24,10:00,15:00,ともき,恵比寿,0
2026-05-24,10:00,17:00,ひろむ,上野,0
2026-05-24,10:00,17:00,りょう,桜木町,0
2026-05-25,16:00,22:00,ひろむ,恵比寿,0
2026-05-25,09:00,16:00,せいや,上野,0
2026-05-26,16:00,21:00,ともき,恵比寿,0
2026-05-26,14:00,22:00,せいや,上野,0
2026-05-26,15:00,22:00,りょう,桜木町,0
2026-05-27,18:00,22:00,せいや,恵比寿,0
2026-05-27,14:00,22:00,ひろむ,上野,0
2026-05-27,09:00,13:00,ともき,桜木町,0
2026-05-27,16:00,19:00,ともき,桜木町,0
2026-05-28,16:00,22:00,ともき,恵比寿,0
2026-05-28,10:00,13:00,ひろむ,上野,0
2026-05-28,16:00,22:00,ひろむ,上野,0
2026-05-28,14:00,21:30,りょう,桜木町,0
2026-05-29,17:00,21:00,だいき,恵比寿,0
2026-05-29,10:00,13:00,ともき,上野,0
2026-05-29,17:00,21:00,ともき,上野,0
2026-05-29,09:00,17:00,りょう,桜木町,0
2026-05-30,10:00,17:00,せいや,上野,0
2026-05-30,10:00,18:00,ともき,桜木町,0
2026-05-31,10:00,16:00,ともき,恵比寿,0
2026-05-31,10:00,18:00,りょう,桜木町,0
`.trim();

function norm(s) {
  return String(s ?? "")
    .replace(/\u3000/g, " ")
    .trim();
}

function toHHMMSS(hhmm) {
  const s = norm(hhmm);
  if (!/^\d{2}:\d{2}$/u.test(s)) throw new Error(`時刻形式が不正です: ${hhmm}`);
  return `${s}:00`;
}

function parseExpected(raw) {
  const lines = raw.split("\n").map((l) => norm(l)).filter(Boolean);
  const header = lines.shift();
  if (!header || header !== "date,start_time,end_time,trainer_name,store_name,break_minutes") {
    throw new Error("期待CSVヘッダーが不正です");
  }
  return lines.map((line) => {
    const [date, start_time, end_time, trainer_name, store_name, break_minutes] = line.split(",").map(norm);
    if (!date || !start_time || !end_time || !trainer_name || !store_name) throw new Error(`行が不正です: ${line}`);
    const bm = break_minutes ? Number(break_minutes) : 0;
    return {
      date,
      start_local: toHHMMSS(start_time),
      end_local: toHHMMSS(end_time),
      trainer_name,
      store_name,
      break_minutes: Number.isFinite(bm) ? bm : 0,
    };
  });
}

function toKey(r) {
  return [
    r.date,
    r.start_local.slice(0, 5),
    r.end_local.slice(0, 5),
    r.trainer_name,
    r.store_name,
    String(Math.max(0, Math.round(Number(r.break_minutes ?? 0) || 0))),
  ].join(",");
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY が未設定です。");

  const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

  const expected = parseExpected(EXPECTED_CSV);

  const { data: stores, error: storesErr } = await supabase.from("stores").select("id,name");
  if (storesErr) throw storesErr;
  const storeNameById = new Map((stores ?? []).map((s) => [s.id, s.name]));

  const { data: trainers, error: trainersErr } = await supabase.from("trainers").select("id,display_name");
  if (trainersErr) throw trainersErr;
  const trainerNameById = new Map((trainers ?? []).map((t) => [t.id, String(t.display_name)]));

  const month = "2026-05";
  const from = `${month}-01`;
  const to = `${month}-31`;
  const { data: shifts, error: shiftsErr } = await supabase
    .from("trainer_shifts")
    .select("id, trainer_id, store_id, shift_date, start_local, end_local, break_minutes, is_break, status")
    .gte("shift_date", from)
    .lte("shift_date", to)
    .neq("status", "draft");
  if (shiftsErr) throw shiftsErr;

  const actualRows = (shifts ?? [])
    .filter((s) => s.is_break !== true)
    .map((s) => ({
      date: s.shift_date,
      start_local: s.start_local,
      end_local: s.end_local,
      trainer_name: trainerNameById.get(s.trainer_id) ?? s.trainer_id,
      store_name: storeNameById.get(s.store_id) ?? s.store_id,
      break_minutes: s.break_minutes ?? 0,
    }));

  const expectedKeys = expected.map((r) => toKey(r));
  const actualKeys = actualRows.map((r) => toKey(r));

  const expectedSet = new Set(expectedKeys);
  const actualSet = new Set(actualKeys);

  const missing = expectedKeys.filter((k) => !actualSet.has(k));
  const extra = actualKeys.filter((k) => !expectedSet.has(k));

  // 重複検出（期待/実績それぞれ）
  function dupes(keys) {
    const c = new Map();
    for (const k of keys) c.set(k, (c.get(k) ?? 0) + 1);
    return Array.from(c.entries())
      .filter(([, n]) => n >= 2)
      .sort((a, b) => b[1] - a[1]);
  }

  const expDup = dupes(expectedKeys);
  const actDup = dupes(actualKeys);

  console.log("verify shifts", {
    month,
    expected: expectedKeys.length,
    actual: actualKeys.length,
    missing: missing.length,
    extra: extra.length,
    expectedDupes: expDup.length,
    actualDupes: actDup.length,
  });

  const show = (title, arr, max = 30) => {
    if (arr.length === 0) return;
    console.log(`\\n${title} (showing up to ${max})`);
    for (const x of arr.slice(0, max)) console.log("-", x);
  };

  show("MISSING (期待にあるがDBにない)", missing);
  show("EXTRA (DBにあるが期待にない)", extra);
  if (expDup.length) show("DUPLICATE in EXPECTED", expDup.map(([k, n]) => `${n}x ${k}`));
  if (actDup.length) show("DUPLICATE in ACTUAL", actDup.map(([k, n]) => `${n}x ${k}`));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

