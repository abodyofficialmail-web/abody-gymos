import { createClient } from "@supabase/supabase-js";

/**
 * 2026-06 の最終シフトを全店舗まとめて同期します。
 * - 対象店舗: 恵比寿 / 上野 / 新宿 / 桜木町
 * - 対象店舗の2026-06通常シフト（is_break=false、draft以外）を削除してCSVをinsert
 * - 休憩ブロック（is_break=true）は削除しません
 * - 新宿店が存在しない場合は通常実行時に作成します（--dry-runでは作成しません）
 * - --dry-run でDB更新せず、削除/追加予定・枠数・重複チェックを確認できます
 */

const MONTH = "2026-06";
const STORE_NAMES = ["恵比寿", "上野", "新宿", "桜木町"];

const CSV = `
date,start_time,end_time,trainer_name,store_name,break_minutes
2026-06-01,16:00,22:00,ひろむ,恵比寿,0
2026-06-01,10:00,14:00,ゆうと,上野,0
2026-06-01,17:00,22:00,ゆうと,上野,0
2026-06-01,10:00,13:00,りょう,桜木町,0
2026-06-01,16:00,21:30,りょう,桜木町,0
2026-06-02,16:00,22:00,ゆうと,恵比寿,0
2026-06-02,10:00,13:00,せいや,上野,0
2026-06-02,16:00,21:00,せいや,上野,0
2026-06-02,13:00,17:00,ひろむ,新宿,0
2026-06-02,16:00,21:30,りょう,桜木町,0
2026-06-03,16:00,22:00,ゆうと,恵比寿,0
2026-06-03,14:00,22:00,せいや,上野,0
2026-06-03,10:00,17:00,りょう,桜木町,0
2026-06-04,16:00,22:00,ゆうと,恵比寿,0
2026-06-04,13:00,22:00,ひろむ,上野,0
2026-06-04,10:00,14:00,ゆうと,新宿,0
2026-06-04,09:00,16:00,りょう,桜木町,0
2026-06-05,16:00,22:00,ゆうと,恵比寿,0
2026-06-05,10:00,14:00,ひろむ,上野,0
2026-06-05,17:00,22:00,ひろむ,上野,0
2026-06-05,09:00,13:00,りょう,桜木町,0
2026-06-05,16:00,20:00,りょう,桜木町,0
2026-06-06,10:00,18:00,ひろむ,上野,0
2026-06-06,10:00,15:00,せいや,新宿,0
2026-06-06,10:00,18:00,ともき,桜木町,0
2026-06-07,10:00,18:00,ともき,上野,0
2026-06-07,10:00,17:00,りょう,桜木町,0
2026-06-08,13:00,22:00,せいや,上野,0
2026-06-08,17:00,22:00,ひろむ,新宿,0
2026-06-09,16:00,22:00,ゆうと,恵比寿,0
2026-06-09,14:00,22:00,せいや,上野,0
2026-06-09,10:00,13:00,りょう,桜木町,0
2026-06-09,16:00,21:30,りょう,桜木町,0
2026-06-10,16:00,22:00,ゆうと,恵比寿,0
2026-06-10,09:00,15:00,ひろむ,上野,0
2026-06-10,16:00,22:00,せいや,上野,0
2026-06-10,15:00,21:30,りょう,桜木町,0
2026-06-11,16:00,22:00,ゆうと,恵比寿,0
2026-06-11,16:00,22:00,ひろむ,上野,0
2026-06-11,10:00,14:00,ゆうと,新宿,0
2026-06-11,10:00,13:00,りょう,桜木町,0
2026-06-11,16:00,21:30,りょう,桜木町,0
2026-06-12,16:00,22:00,ゆうと,恵比寿,0
2026-06-12,16:00,22:00,ひろむ,上野,0
2026-06-12,09:00,13:00,りょう,桜木町,0
2026-06-12,16:00,20:00,りょう,桜木町,0
2026-06-13,10:00,18:00,ひろむ,上野,0
2026-06-13,10:00,16:00,せいや,新宿,0
2026-06-13,10:00,17:00,りょう,桜木町,0
2026-06-14,10:00,16:00,ゆうと,恵比寿,0
2026-06-14,16:00,22:00,ひろむ,上野,0
2026-06-14,10:00,17:00,りょう,桜木町,0
2026-06-15,10:00,18:00,ゆうと,上野,0
2026-06-15,16:00,22:00,ひろむ,上野,0
2026-06-15,09:00,13:00,りょう,桜木町,0
2026-06-15,16:00,20:00,りょう,桜木町,0
2026-06-16,16:00,22:00,ゆうと,恵比寿,0
2026-06-16,14:00,22:00,せいや,上野,0
2026-06-16,17:00,21:00,ひろむ,新宿,0
2026-06-16,10:00,17:00,りょう,桜木町,0
2026-06-17,16:00,22:00,ゆうと,恵比寿,0
2026-06-17,15:00,22:00,せいや,上野,0
2026-06-17,10:00,17:00,りょう,桜木町,0
2026-06-18,16:00,22:00,ゆうと,恵比寿,0
2026-06-18,11:00,13:00,ひろむ,上野,0
2026-06-18,16:00,22:00,ひろむ,上野,0
2026-06-18,10:00,14:00,ゆうと,新宿,0
2026-06-18,16:00,21:30,りょう,桜木町,0
2026-06-19,16:00,22:00,ゆうと,恵比寿,0
2026-06-19,15:00,22:00,ひろむ,上野,0
2026-06-19,09:00,13:00,りょう,桜木町,0
2026-06-19,16:00,20:00,りょう,桜木町,0
2026-06-20,10:00,18:00,ひろむ,上野,0
2026-06-20,10:00,16:00,せいや,新宿,0
2026-06-20,10:00,17:00,りょう,桜木町,0
2026-06-21,10:00,17:00,ゆうと,恵比寿,0
2026-06-21,10:00,17:00,ひろむ,上野,0
2026-06-21,10:00,17:00,りょう,桜木町,0
2026-06-22,10:00,17:00,せいや,上野,0
2026-06-22,16:00,22:00,ひろむ,上野,0
2026-06-22,17:00,22:00,ゆうと,新宿,0
2026-06-23,16:00,22:00,ゆうと,恵比寿,0
2026-06-23,14:00,22:00,せいや,上野,0
2026-06-23,16:00,21:30,りょう,桜木町,0
2026-06-24,16:00,22:00,ゆうと,恵比寿,0
2026-06-24,16:00,22:00,せいや,上野,0
2026-06-24,15:00,21:30,りょう,桜木町,0
2026-06-25,16:00,22:00,ゆうと,恵比寿,0
2026-06-25,10:00,17:00,ひろむ,上野,0
2026-06-25,17:00,22:00,ひろむ,新宿,0
2026-06-25,10:00,13:00,りょう,桜木町,0
2026-06-25,16:00,21:30,りょう,桜木町,0
2026-06-26,16:00,22:00,ゆうと,恵比寿,0
2026-06-26,14:00,22:00,ひろむ,上野,0
2026-06-26,09:00,17:00,りょう,桜木町,0
2026-06-27,10:00,18:00,ひろむ,上野,0
2026-06-27,10:00,16:00,せいや,新宿,0
2026-06-27,10:00,17:00,りょう,桜木町,0
2026-06-28,10:00,16:00,ひろむ,新宿,0
2026-06-29,14:00,22:00,ゆうと,上野,0
2026-06-29,16:00,22:00,ひろむ,上野,0
2026-06-29,10:00,13:00,りょう,桜木町,0
2026-06-29,16:00,21:30,りょう,桜木町,0
2026-06-30,16:00,22:00,ゆうと,恵比寿,0
2026-06-30,14:00,22:00,せいや,上野,0
2026-06-30,10:00,17:00,りょう,桜木町,0
`.trim();

function norm(s) {
  return String(s ?? "").replace(/\u3000/g, " ").trim();
}

function toHHMMSS(hhmm) {
  const s = norm(hhmm);
  if (!/^\d{2}:\d{2}$/u.test(s)) throw new Error(`時刻形式が不正です: ${hhmm}`);
  return `${s}:00`;
}

function toMinutes(hhmm) {
  const [hh, mm] = norm(hhmm).slice(0, 5).split(":").map(Number);
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
    if (!STORE_NAMES.includes(store_name)) throw new Error(`対象外の店舗です: ${store_name}`);
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

function validateNoTrainerOverlap(rows) {
  const byTrainerDay = new Map();
  for (const row of rows) {
    const key = `${row.trainer_name}|${row.shift_date}`;
    const list = byTrainerDay.get(key) ?? [];
    list.push(row);
    byTrainerDay.set(key, list);
  }

  const conflicts = [];
  for (const [key, list] of byTrainerDay) {
    const sorted = list.slice().sort((a, b) => toMinutes(a.start_local) - toMinutes(b.start_local));
    for (let i = 0; i < sorted.length; i += 1) {
      for (let j = i + 1; j < sorted.length; j += 1) {
        if (toMinutes(sorted[i].start_local) < toMinutes(sorted[j].end_local) && toMinutes(sorted[i].end_local) > toMinutes(sorted[j].start_local)) {
          conflicts.push({ key, a: sorted[i], b: sorted[j] });
        }
      }
    }
  }
  if (conflicts.length > 0) {
    throw new Error(`同一トレーナーの重複があります: ${JSON.stringify(conflicts, null, 2)}`);
  }
}

function summarize(rows) {
  const byStore = new Map();
  const byTrainer = new Map();
  let totalSlots = 0;

  for (const row of rows) {
    const start = toMinutes(row.start_local);
    const end = toMinutes(row.end_local);
    const slots = Math.floor((end - start) / 30);
    const minutes = end - start - Math.max(0, row.break_minutes);
    totalSlots += slots;

    const store = byStore.get(row.store_name) ?? { days: new Set(), slots: 0, minutes: 0 };
    store.days.add(row.shift_date);
    store.slots += slots;
    store.minutes += end - start;
    byStore.set(row.store_name, store);

    const trainer = byTrainer.get(row.trainer_name) ?? { days: new Set(), slots: 0, minutes: 0 };
    trainer.days.add(row.shift_date);
    trainer.slots += slots;
    trainer.minutes += minutes;
    byTrainer.set(row.trainer_name, trainer);
  }

  return {
    rows: rows.length,
    totalSlots,
    stores: Array.from(byStore.entries()).map(([name, v]) => ({
      name,
      operatingDays: v.days.size,
      hours: v.minutes / 60,
      slots: v.slots,
    })),
    trainers: Array.from(byTrainer.entries()).map(([name, v]) => ({
      name,
      days: v.days.size,
      hours: v.minutes / 60,
      slots: v.slots,
    })),
  };
}

async function ensureStores(supabase, dryRun) {
  const { data: stores, error } = await supabase.from("stores").select("id,name").in("name", STORE_NAMES);
  if (error) throw error;

  const storeIdByName = new Map((stores ?? []).map((s) => [s.name, s.id]));
  const missing = STORE_NAMES.filter((name) => !storeIdByName.has(name));
  if (missing.length === 0) return storeIdByName;

  if (dryRun) {
    for (const name of missing) storeIdByName.set(name, `dry-run:${name}`);
    return storeIdByName;
  }

  const { data: inserted, error: insertErr } = await supabase
    .from("stores")
    .insert(missing.map((name) => ({ name, timezone: "Asia/Tokyo", is_active: true })))
    .select("id,name");
  if (insertErr) throw insertErr;
  for (const row of inserted ?? []) storeIdByName.set(row.name, row.id);
  return storeIdByName;
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY が未設定です。");

  const rows = parseCsv(CSV);
  validateNoTrainerOverlap(rows);
  const summary = summarize(rows);

  const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const storeIdByName = await ensureStores(supabase, dryRun);
  const { data: trainers, error: trainersErr } = await supabase.from("trainers").select("id,display_name");
  if (trainersErr) throw trainersErr;
  const trainerIdByName = new Map((trainers ?? []).map((t) => [String(t.display_name), t.id]));

  const payload = rows.map((row) => {
    const store_id = storeIdByName.get(row.store_name);
    const trainer_id = trainerIdByName.get(row.trainer_name);
    if (!store_id) throw new Error(`storesに存在しない store_name です: ${row.store_name}`);
    if (!trainer_id) throw new Error(`trainersに存在しない trainer_name です: ${row.trainer_name}`);
    return {
      trainer_id,
      store_id,
      shift_date: row.shift_date,
      start_local: row.start_local,
      end_local: row.end_local,
      break_minutes: Number.isFinite(row.break_minutes) ? row.break_minutes : 0,
      status: "confirmed",
      is_break: false,
    };
  });

  const realStoreIds = STORE_NAMES.map((name) => storeIdByName.get(name)).filter((id) => id && !String(id).startsWith("dry-run:"));
  let existing = [];
  if (realStoreIds.length > 0) {
    const { data, error } = await supabase
      .from("trainer_shifts")
      .select("id")
      .in("store_id", realStoreIds)
      .gte("shift_date", `${MONTH}-01`)
      .lte("shift_date", `${MONTH}-30`)
      .neq("status", "draft")
      .eq("is_break", false);
    if (error) throw error;
    existing = data ?? [];
  }

  if (dryRun) {
    console.log("dry run", {
      month: MONTH,
      stores: STORE_NAMES,
      existingToDelete: existing.length,
      rowsToInsert: payload.length,
      ...summary,
    });
    return;
  }

  const chunk = 200;
  const ids = existing.map((row) => row.id);
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

  console.log("sync final shifts done", {
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
