import { createClient } from "@supabase/supabase-js";

/**
 * 2026-06 の桜木町 通常シフト（is_break=false）をCSV内容で置換します。
 * - 桜木町店のみ対象。他店舗の2026-06シフトは削除しません。
 * - 休憩ブロック（is_break=true）は削除しません。
 * - --dry-run を付けるとDB更新せず、削除/追加予定と枠数だけ確認します。
 */

const MONTH = "2026-06";
const STORE_NAME = "桜木町";

const CSV = `
date,start_time,end_time,trainer_name,store_name,break_minutes
2026-06-01,10:00,13:00,りょう,桜木町,0
2026-06-01,16:00,21:30,りょう,桜木町,0
2026-06-02,14:00,21:30,りょう,桜木町,0
2026-06-03,10:00,18:00,りょう,桜木町,0
2026-06-04,09:00,16:00,りょう,桜木町,0
2026-06-05,09:00,13:00,りょう,桜木町,0
2026-06-05,16:00,20:00,りょう,桜木町,0
2026-06-06,10:00,18:00,ともき,桜木町,0
2026-06-07,10:00,17:00,りょう,桜木町,0
2026-06-09,10:00,13:00,りょう,桜木町,0
2026-06-09,16:00,21:30,りょう,桜木町,0
2026-06-10,13:00,21:30,りょう,桜木町,0
2026-06-11,10:00,13:00,りょう,桜木町,0
2026-06-11,16:00,21:30,りょう,桜木町,0
2026-06-12,09:00,13:00,りょう,桜木町,0
2026-06-12,16:00,20:00,りょう,桜木町,0
2026-06-13,10:00,17:00,りょう,桜木町,0
2026-06-14,10:00,17:00,りょう,桜木町,0
2026-06-15,09:00,13:00,りょう,桜木町,0
2026-06-15,16:00,20:00,りょう,桜木町,0
2026-06-16,10:00,18:00,りょう,桜木町,0
2026-06-17,10:00,17:00,りょう,桜木町,0
2026-06-18,14:00,21:30,りょう,桜木町,0
2026-06-19,09:00,13:00,りょう,桜木町,0
2026-06-19,16:00,20:00,りょう,桜木町,0
2026-06-20,10:00,18:00,りょう,桜木町,0
2026-06-21,10:00,17:00,りょう,桜木町,0
2026-06-23,14:00,21:30,りょう,桜木町,0
2026-06-24,13:00,21:30,りょう,桜木町,0
2026-06-25,10:00,13:00,りょう,桜木町,0
2026-06-25,16:00,21:30,りょう,桜木町,0
2026-06-26,09:00,17:00,りょう,桜木町,0
2026-06-27,10:00,18:00,りょう,桜木町,0
2026-06-28,10:00,17:00,りょう,桜木町,0
2026-06-29,10:00,13:00,りょう,桜木町,0
2026-06-29,16:00,21:30,りょう,桜木町,0
2026-06-30,10:00,18:00,りょう,桜木町,0
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

function toMinutes(hhmm) {
  const [hh, mm] = norm(hhmm).split(":").map(Number);
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) throw new Error(`時刻形式が不正です: ${hhmm}`);
  return hh * 60 + mm;
}

function parseCsv(raw) {
  const lines = raw.split("\n").map((l) => norm(l)).filter(Boolean);
  const header = lines.shift();
  if (!header || header !== "date,start_time,end_time,trainer_name,store_name,break_minutes") {
    throw new Error("CSVヘッダーが不正です");
  }

  return lines.map((line) => {
    const [date, start_time, end_time, trainer_name, store_name, break_minutes] = line.split(",").map(norm);
    if (!date || !start_time || !end_time || !trainer_name || !store_name) throw new Error(`行が不正です: ${line}`);
    if (!date.startsWith(`${MONTH}-`)) throw new Error(`対象月外の日付です: ${date}`);
    if (store_name !== STORE_NAME) throw new Error(`対象外の店舗です: ${store_name}`);
    if (toMinutes(end_time) <= toMinutes(start_time)) throw new Error(`終了時刻が開始時刻以前です: ${line}`);

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

function summarize(rows) {
  const byTrainer = new Map();
  const days = new Set();
  let slots = 0;
  for (const row of rows) {
    days.add(row.shift_date);
    const start = toMinutes(row.start_local.slice(0, 5));
    const end = toMinutes(row.end_local.slice(0, 5));
    const rowSlots = Math.floor((end - start) / 30);
    slots += rowSlots;
    const current = byTrainer.get(row.trainer_name) ?? { days: new Set(), slots: 0, minutes: 0 };
    current.days.add(row.shift_date);
    current.slots += rowSlots;
    current.minutes += end - start;
    byTrainer.set(row.trainer_name, current);
  }

  return {
    operatingDays: days.size,
    totalSlots: slots,
    trainers: Array.from(byTrainer.entries()).map(([name, v]) => ({
      name,
      days: v.days.size,
      slots: v.slots,
      hours: v.minutes / 60,
    })),
  };
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY が未設定です。");

  const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

  const { data: store, error: storeErr } = await supabase
    .from("stores")
    .select("id,name")
    .eq("name", STORE_NAME)
    .maybeSingle();
  if (storeErr) throw storeErr;
  if (!store) throw new Error(`storesに存在しない store_name です: ${STORE_NAME}`);

  const { data: trainers, error: trainersErr } = await supabase.from("trainers").select("id,display_name");
  if (trainersErr) throw trainersErr;
  const trainerIdByName = new Map((trainers ?? []).map((t) => [String(t.display_name), t.id]));

  const rows = parseCsv(CSV);
  if (rows.length === 0) throw new Error("取込対象が0件です。");

  const payload = rows.map((r) => {
    const trainer_id = trainerIdByName.get(r.trainer_name);
    if (!trainer_id) throw new Error(`trainersに存在しない trainer_name です: ${r.trainer_name}`);
    return {
      trainer_id,
      store_id: store.id,
      shift_date: r.shift_date,
      start_local: r.start_local,
      end_local: r.end_local,
      break_minutes: Number.isFinite(r.break_minutes) ? r.break_minutes : 0,
      status: "confirmed",
      is_break: false,
    };
  });

  const from = `${MONTH}-01`;
  const to = `${MONTH}-30`;
  const { data: existing, error: exErr } = await supabase
    .from("trainer_shifts")
    .select("id")
    .eq("store_id", store.id)
    .gte("shift_date", from)
    .lte("shift_date", to)
    .neq("status", "draft")
    .eq("is_break", false);
  if (exErr) throw exErr;

  const summary = summarize(rows);
  if (dryRun) {
    console.log("dry run", {
      month: MONTH,
      store: STORE_NAME,
      existingToDelete: existing?.length ?? 0,
      rowsToInsert: payload.length,
      ...summary,
    });
    return;
  }

  const ids = (existing ?? []).map((r) => r.id);
  const chunk = 200;
  let deleted = 0;
  for (let i = 0; i < ids.length; i += chunk) {
    const part = ids.slice(i, i + chunk);
    const { error } = await supabase.from("trainer_shifts").delete().in("id", part);
    if (error) throw error;
    deleted += part.length;
  }

  let inserted = 0;
  for (let i = 0; i < payload.length; i += chunk) {
    const part = payload.slice(i, i + chunk);
    const { error } = await supabase.from("trainer_shifts").insert(part);
    if (error) throw error;
    inserted += part.length;
  }

  console.log("sync sakuragicho shifts done", {
    month: MONTH,
    deleted,
    inserted,
    expected: rows.length,
    ...summary,
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
