import { createClient } from "@supabase/supabase-js";

/**
 * CSV:
 * date,start_time,end_time,trainer_name,store_name,break_minutes
 */
const RAW = `
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

2026-05-12,10:00,17:00,ひろむ,上野,0
2026-05-12,10:00,17:00,りょう,桜木町,0

2026-05-13,10:00,16:00,ともき,恵比寿,0
2026-05-13,10:00,17:00,ひろむ,上野,0
2026-05-13,10:00,17:00,りょう,桜木町,0

2026-05-14,16:00,22:00,ともき,恵比寿,0
2026-05-14,10:00,13:00,ひろむ,上野,0
2026-05-14,16:00,22:00,ひろむ,上野,0

2026-05-15,09:30,10:30,ともき,恵比寿,0
2026-05-15,16:00,21:00,ともき,恵比寿,0
2026-05-15,14:00,22:00,ひろむ,上野,0
2026-05-15,09:00,13:00,りょう,桜木町,0
2026-05-15,16:00,21:30,りょう,桜木町,0

2026-05-16,10:00,17:00,ひろむ,上野,0
2026-05-16,10:00,17:00,りょう,桜木町,0

2026-05-17,10:00,16:00,ともき,恵比寿,0
2026-05-17,10:00,18:00,りょう,桜木町,0

2026-05-18,10:00,16:00,ひろむ,上野,0
2026-05-18,09:00,16:00,りょう,桜木町,0

2026-05-19,10:00,16:00,ともき,恵比寿,0
2026-05-19,10:00,17:00,ひろむ,上野,0
2026-05-19,10:00,17:00,りょう,桜木町,0

2026-05-20,10:00,16:00,せいや,恵比寿,0
2026-05-20,10:00,16:00,ひろむ,上野,0
2026-05-20,09:00,17:00,りょう,桜木町,0

2026-05-21,16:00,22:00,ともき,恵比寿,0
2026-05-21,10:00,13:00,ひろむ,上野,0
2026-05-21,16:00,22:00,ひろむ,上野,0
2026-05-21,14:00,21:30,りょう,桜木町,0

2026-05-22,09:30,10:30,ともき,恵比寿,0
2026-05-22,16:00,21:00,ともき,恵比寿,0
2026-05-22,14:00,22:00,ひろむ,上野,0
2026-05-22,09:00,13:00,りょう,桜木町,0
2026-05-22,16:00,21:30,りょう,桜木町,0

2026-05-23,10:00,18:00,せいや,上野,0
2026-05-23,10:00,18:00,りょう,桜木町,0

2026-05-24,16:00,22:00,ともき,恵比寿,0
2026-05-24,10:00,17:00,ひろむ,上野,0
2026-05-24,10:00,17:00,りょう,桜木町,0

2026-05-25,10:00,13:00,ひろむ,上野,0
2026-05-25,16:00,20:00,ひろむ,上野,0
2026-05-25,10:00,13:00,りょう,桜木町,0
2026-05-25,16:00,21:30,りょう,桜木町,0

2026-05-26,10:00,17:00,ひろむ,上野,0
2026-05-26,10:00,17:00,りょう,桜木町,0

2026-05-27,10:00,16:00,ともき,恵比寿,0
2026-05-27,10:00,17:00,ひろむ,上野,0
2026-05-27,10:00,17:00,りょう,桜木町,0

2026-05-28,16:00,22:00,ともき,恵比寿,0
2026-05-28,10:00,13:00,ひろむ,上野,0
2026-05-28,16:00,22:00,ひろむ,上野,0

2026-05-29,09:30,10:30,ともき,恵比寿,0
2026-05-29,16:00,21:00,ともき,恵比寿,0
2026-05-29,14:00,22:00,ひろむ,上野,0
2026-05-29,09:00,13:00,りょう,桜木町,0
2026-05-29,16:00,21:30,りょう,桜木町,0

2026-05-30,10:00,18:00,せいや,上野,0
2026-05-30,10:00,18:00,りょう,桜木町,0

2026-05-31,16:00,22:00,ともき,恵比寿,0
2026-05-31,10:00,17:00,ひろむ,上野,0
2026-05-31,10:00,17:00,りょう,桜木町,0
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

function parseCsv(raw) {
  const lines = raw.split("\n").map((l) => norm(l)).filter(Boolean);
  const header = lines.shift();
  if (!header || !header.startsWith("date,")) throw new Error("CSVヘッダーが不正です");

  return lines.map((line) => {
    const [date, start_time, end_time, trainer_name, store_name, break_minutes] = line.split(",").map(norm);
    if (!date || !start_time || !end_time || !trainer_name || !store_name) throw new Error(`行が不正です: ${line}`);
    return {
      shift_date: date,
      start_local: toHHMMSS(start_time),
      end_local: toHHMMSS(end_time),
      trainer_name,
      store_name,
      break_minutes: break_minutes ? Number(break_minutes) : 0,
    };
  });
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY が未設定です。");

  const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

  const { data: stores, error: storesErr } = await supabase.from("stores").select("id,name");
  if (storesErr) throw storesErr;
  const storeIdByName = new Map((stores ?? []).map((s) => [s.name, s.id]));

  const { data: trainers, error: trainersErr } = await supabase.from("trainers").select("id,display_name,is_active");
  if (trainersErr) throw trainersErr;
  const trainerIdByName = new Map((trainers ?? []).map((t) => [String(t.display_name), t.id]));

  const rows = parseCsv(RAW);

  // 既存行チェック → あれば update、なければ insert（重複投入を避ける）
  let inserted = 0;
  let updated = 0;

  for (const r of rows) {
    const store_id = storeIdByName.get(r.store_name);
    if (!store_id) throw new Error(`storesに存在しない store_name です: ${r.store_name}`);

    const trainer_id = trainerIdByName.get(r.trainer_name);
    if (!trainer_id) throw new Error(`trainersに存在しない trainer_name です: ${r.trainer_name}`);

    const base = {
      trainer_id,
      store_id,
      shift_date: r.shift_date,
      start_local: r.start_local,
      end_local: r.end_local,
      break_minutes: Number.isFinite(r.break_minutes) ? r.break_minutes : 0,
      status: "confirmed",
      is_break: false,
    };

    const { data: existing, error: exErr } = await supabase
      .from("trainer_shifts")
      .select("id")
      .eq("trainer_id", trainer_id)
      .eq("store_id", store_id)
      .eq("shift_date", r.shift_date)
      .eq("start_local", r.start_local)
      .eq("end_local", r.end_local)
      .maybeSingle();
    if (exErr) throw exErr;

    if (existing?.id) {
      const { error: upErr } = await supabase
        .from("trainer_shifts")
        .update({ break_minutes: base.break_minutes, status: base.status, is_break: base.is_break, updated_at: new Date().toISOString() })
        .eq("id", existing.id);
      if (upErr) throw upErr;
      updated += 1;
    } else {
      const { error: insErr } = await supabase.from("trainer_shifts").insert(base);
      if (insErr) throw insErr;
      inserted += 1;
    }
  }

  console.log("shifts import done", { inserted, updated, total: rows.length });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

