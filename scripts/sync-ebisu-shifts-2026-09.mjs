import { createClient } from "@supabase/supabase-js";

/**
 * 2026-09 恵比寿シフトのみ同期（draft のみ・予約サイト非公開）
 * - 平日 16:00–22:00 / 日曜 11:00–17:00 / 土曜固定休
 * - 目標: 解放枠 ~190（16営業日 × 12枠 = 192）
 * - 他店舗のシフトには触れません
 *
 * 実行: node --env-file=.env.local scripts/sync-ebisu-shifts-2026-09.mjs
 * 確認: node --env-file=.env.local scripts/sync-ebisu-shifts-2026-09.mjs --dry-run
 */
const MONTH = "2026-09";
const MONTH_LAST_DAY = "30";
const STORE_NAME = "恵比寿";
const TARGET_SLOTS = 190;

// date, trainer, start, end
const EBISU_SHIFTS = [
  ["2026-09-01", "ひろむ", "16:00", "22:00"],
  ["2026-09-03", "ゆうと", "16:00", "22:00"],
  ["2026-09-04", "ゆうと", "16:00", "22:00"],
  ["2026-09-08", "ひろむ", "16:00", "22:00"],
  ["2026-09-09", "ひろむ", "16:00", "22:00"],
  ["2026-09-10", "ゆうと", "16:00", "22:00"],
  ["2026-09-11", "ゆうと", "16:00", "22:00"],
  ["2026-09-15", "ゆうと", "16:00", "22:00"],
  ["2026-09-16", "ゆうと", "16:00", "22:00"],
  ["2026-09-17", "ゆうと", "16:00", "22:00"],
  ["2026-09-18", "ゆうと", "16:00", "22:00"],
  ["2026-09-21", "ゆうと", "16:00", "22:00"],
  ["2026-09-22", "ゆうと", "16:00", "22:00"],
  ["2026-09-23", "ゆうと", "16:00", "22:00"],
  ["2026-09-24", "ゆうと", "16:00", "22:00"],
  ["2026-09-25", "ゆうと", "16:00", "22:00"],
  ["2026-09-29", "ゆうと", "16:00", "22:00"],
  ["2026-09-30", "ゆうと", "16:00", "22:00"],
];

const SATURDAYS = new Set(["2026-09-05", "2026-09-12", "2026-09-19", "2026-09-26"]);

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
  return hh * 60 + mm;
}

function row(date, start, end, trainer) {
  return {
    shift_date: date,
    start_local: toHHMMSS(start),
    end_local: toHHMMSS(end),
    trainer_name: trainer,
    store_name: STORE_NAME,
    break_minutes: 0,
  };
}

function buildRows() {
  const rows = [];
  for (const [date, trainer, start, end] of EBISU_SHIFTS) {
    if (SATURDAYS.has(date)) throw new Error(`土曜日は固定休です: ${date}`);
    const dow = new Date(`${date}T00:00:00`).getDay();
    if (dow === 6) throw new Error(`土曜日は固定休です: ${date}`);
    if (dow === 0 && (start !== "11:00" || end !== "17:00")) {
      throw new Error(`日曜は11:00–17:00のみ: ${date} ${start}-${end}`);
    }
    if (dow >= 1 && dow <= 5 && (start !== "16:00" || end !== "22:00")) {
      throw new Error(`平日は16:00–22:00のみ: ${date} ${start}-${end}`);
    }
    rows.push(row(date, start, end, trainer));
  }
  return rows;
}

function effectiveSlots(rows) {
  let total = 0;
  const byDate = new Map();
  for (const r of rows) {
    if (!byDate.has(r.shift_date)) byDate.set(r.shift_date, []);
    byDate.get(r.shift_date).push(r);
  }
  const days = [];
  for (const [date, dayRows] of [...byDate.entries()].sort()) {
    let daySlots = 0;
    for (let t = 540; t < 1320; t += 30) {
      let cap = 0;
      for (const r of dayRows) {
        const s = toMinutes(r.start_local);
        const e = toMinutes(r.end_local);
        if (s <= t && t + 30 <= e) cap++;
      }
      if (cap > 0) cap = 1; // 恵比寿は1ブース
      daySlots += cap;
    }
    total += daySlots;
    const trainers = [...new Set(dayRows.map((r) => r.trainer_name))].join("・");
    days.push({
      date: `9/${date.slice(8)}`,
      hours: `${dayRows[0].start_local.slice(0, 5)}–${dayRows[0].end_local.slice(0, 5)}`,
      slots: daySlots,
      trainers,
    });
  }
  return { total, days };
}

function validateNoTrainerOverlap(rows) {
  const byTrainerDay = new Map();
  for (const r of rows) {
    const key = `${r.trainer_name}|${r.shift_date}`;
    const list = byTrainerDay.get(key) ?? [];
    list.push(r);
    byTrainerDay.set(key, list);
  }
  for (const [, list] of byTrainerDay) {
    const sorted = list.slice().sort((a, b) => toMinutes(a.start_local) - toMinutes(b.start_local));
    for (let i = 0; i < sorted.length; i++) {
      for (let j = i + 1; j < sorted.length; j++) {
        if (
          toMinutes(sorted[i].start_local) < toMinutes(sorted[j].end_local) &&
          toMinutes(sorted[i].end_local) > toMinutes(sorted[j].start_local)
        ) {
          throw new Error(`同一トレーナー重複: ${sorted[i].trainer_name} ${sorted[i].shift_date}`);
        }
      }
    }
  }
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const rows = buildRows();
  validateNoTrainerOverlap(rows);
  const { total, days } = effectiveSlots(rows);

  const summary = {
    month: MONTH,
    store: STORE_NAME,
    status: "draft",
    totalSlots: total,
    targetSlots: TARGET_SLOTS,
    openDays: days.length,
    days,
    rows: rows.length,
  };

  if (dryRun || !process.env.NEXT_PUBLIC_SUPABASE_URL) {
    console.log(JSON.stringify({ dryRun: true, ...summary }, null, 2));
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL) return;
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY が未設定です。");

  const supabase = createClient(url, key, { auth: { persistSession: false } });
  const { data: store } = await supabase.from("stores").select("id,name").eq("name", STORE_NAME).maybeSingle();
  if (!store?.id) throw new Error(`店舗が見つかりません: ${STORE_NAME}`);

  const trainerNames = [...new Set(rows.map((r) => r.trainer_name))];
  const { data: trainers } = await supabase.from("trainers").select("id,display_name").in("display_name", trainerNames);
  const trainerIdByName = new Map((trainers ?? []).map((t) => [t.display_name, t.id]));

  const { data: existing } = await supabase
    .from("trainer_shifts")
    .select("id")
    .eq("store_id", store.id)
    .gte("shift_date", `${MONTH}-01`)
    .lte("shift_date", `${MONTH}-${MONTH_LAST_DAY}`);

  const payload = rows.map((r) => ({
    trainer_id: trainerIdByName.get(r.trainer_name),
    store_id: store.id,
    shift_date: r.shift_date,
    start_local: r.start_local,
    end_local: r.end_local,
    status: "draft",
    is_break: false,
  }));

  if (dryRun) {
    console.log(JSON.stringify({ existingToDelete: existing?.length ?? 0, rowsToInsert: payload.length, ...summary }, null, 2));
    return;
  }

  const ids = (existing ?? []).map((r) => r.id);
  for (let i = 0; i < ids.length; i += 200) {
    const { error } = await supabase.from("trainer_shifts").delete().in("id", ids.slice(i, i + 200));
    if (error) throw error;
  }
  for (let i = 0; i < payload.length; i += 200) {
    const { error } = await supabase.from("trainer_shifts").insert(payload.slice(i, i + 200));
    if (error) throw error;
  }

  console.log(JSON.stringify({ done: true, deleted: ids.length, inserted: payload.length, ...summary }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

export { EBISU_SHIFTS, buildRows, effectiveSlots };
