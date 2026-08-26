import { createClient } from "@supabase/supabase-js";

/**
 * 2026-09 シフト同期（draft のみ・予約サイト非公開）
 *
 * 実行: node --env-file=.env.local scripts/sync-final-shifts-2026-09.mjs
 * 確認: node --env-file=.env.local scripts/sync-final-shifts-2026-09.mjs --dry-run
 */
const MONTH = "2026-09";
const MONTH_LAST_DAY = "30";
const STORE_NAMES = ["恵比寿", "上野", "新宿", "桜木町"];
const TRAINER_NAMES = ["ゆうと", "たけはる", "ひろむ", "せいや", "りょう", "こうへい", "だいき"];

const MEMBER_SLOT_NEED = { 恵比寿: 276, 上野: 504, 新宿: 300, 桜木町: 384 };
const SINGLE_BOOTH = new Set(["恵比寿", "新宿"]);

const YUTO_OFF = new Set(["2026-09-06", "2026-09-07", "2026-09-13", "2026-09-14", "2026-09-20", "2026-09-21", "2026-09-27", "2026-09-28"]);
const TAKE_OFF = new Set(["2026-09-05", "2026-09-06", "2026-09-12", "2026-09-13", "2026-09-15", "2026-09-16", "2026-09-26", "2026-09-27"]);
// ひろむ: 休み希望なし・週2休×4週=月8回（日+月ペア）
const HIRO_OFF = new Set([
  "2026-09-06", "2026-09-07", "2026-09-13", "2026-09-14",
  "2026-09-20", "2026-09-21", "2026-09-27", "2026-09-28",
]);
const KOHEI_DAYS = new Set(["2026-09-02", "2026-09-09", "2026-09-17", "2026-09-24", "2026-09-29"]);
// だいき 新宿 09-13 — 9/7はたけはる9-18へ振替
const DAIKI_DAYS = ["2026-09-06", "2026-09-13", "2026-09-14"];
const SHINJUKU_TRAINING_DAYS = ["2026-09-01", "2026-09-02", "2026-09-03", "2026-09-04", "2026-09-07", "2026-09-08", "2026-09-09", "2026-09-10", "2026-09-11", "2026-09-14"];

// たけはる 桜木町: 1日おきにAM(10-13)削除→16時開始（中抜け1回=+1h換算）
const TAKE_SAKURA_AM_OFF = new Set([
  "2026-09-17", "2026-09-19", "2026-09-21", "2026-09-23", "2026-09-25", "2026-09-29",
]);
const TAKE_SAKURA_PM_END = { "2026-09-21": "21:00" };
const TAKE_SAKURA_DAYS = [
  "2026-09-17", "2026-09-19", "2026-09-20", "2026-09-21", "2026-09-22",
  "2026-09-23", "2026-09-24", "2026-09-25", "2026-09-28", "2026-09-29", "2026-09-30",
];
// たけはる 新宿 9-18（だいき9/7分・桜木町10時開始1日休みと振替）
const TAKE_SHINJUKU_EXTRA = [["2026-09-07", "09:00", "18:00"]];

// たけはる 新宿研修: AMを10-16に延長（+3h×3日=+9h）
const TAKE_SHINJUKU_AM_EXTENDED = new Set(["2026-09-02", "2026-09-04", "2026-09-09"]);

const SEIYA_OFF = new Set([
  "2026-09-01", "2026-09-05", "2026-09-08", "2026-09-09", "2026-09-12",
  "2026-09-14", "2026-09-15", "2026-09-16", "2026-09-19", "2026-09-21",
  "2026-09-22", "2026-09-26", "2026-09-28", "2026-09-29", "2026-09-30",
]);
// 7日・24日は17:00まで
const SEIYA_PARTIAL = { "2026-09-07": "17:00", "2026-09-24": "17:00" };

const RYO_SCHEDULE = [
  ["2026-09-01", "09:00", "15:00"], ["2026-09-02", "14:00", "21:30"], ["2026-09-03", "09:00", "20:00"],
  ["2026-09-04", "14:00", "21:30"], ["2026-09-05", "10:00", "18:00"], ["2026-09-06", "09:00", "17:00"],
  ["2026-09-07", "09:00", "20:00"], ["2026-09-08", "14:00", "21:30"], ["2026-09-09", "14:00", "21:30"],
  ["2026-09-10", "09:00", "20:00"], ["2026-09-12", "10:00", "18:00"], ["2026-09-13", "09:00", "17:00"],
  ["2026-09-14", "09:00", "20:00"], ["2026-09-15", "14:00", "21:30"], ["2026-09-16", "14:00", "21:30"],
  ["2026-09-17", "09:00", "20:00"], ["2026-09-18", "14:00", "21:30"], ["2026-09-19", "10:00", "18:00"],
  ["2026-09-20", "09:00", "17:00"], ["2026-09-21", "09:00", "20:00"], ["2026-09-22", "10:00", "18:00"],
  ["2026-09-24", "09:00", "20:00"], ["2026-09-25", "14:00", "21:30"], ["2026-09-26", "10:00", "18:00"],
  ["2026-09-27", "09:00", "15:00"], ["2026-09-28", "09:00", "20:00"], ["2026-09-29", "10:00", "16:00"],
  ["2026-09-30", "14:00", "21:30"],
];
// りょう 新宿: 桜木町過剰分を移動（8月比+10%≈490枠・9/16以降はたけはると2ブース優先）
// ※新宿は単一ブース。他トレーナーと重なる日は buildRows 内で桜木町へ自動退避
const RYO_SHINJUKU = new Set([
  "2026-09-01", "2026-09-02", "2026-09-03", "2026-09-04", "2026-09-05", "2026-09-06",
  "2026-09-08", "2026-09-09", "2026-09-10", "2026-09-12", "2026-09-13", "2026-09-17",
  "2026-09-21", "2026-09-28",
]);

// ゆうと: 月140h / 9/15以降は恵比寿ベース
const YUTO_EBISU_EARLY = new Set(); // 研修中はたけはると新宿PMを同期（恵比寿振替なし）

// 恵比寿: 平日16-22 / 土曜休 / 日曜11-17 / ~190枠
const EBISU_SHIFTS = [
  ["2026-09-09", "ひろむ", "16:00", "22:00"],
  ["2026-09-13", "せいや", "11:00", "17:00"],
  ["2026-09-15", "ゆうと", "16:00", "22:00"],
  ["2026-09-16", "ゆうと", "16:00", "22:00"],
  ["2026-09-17", "ゆうと", "16:00", "22:00"],
  ["2026-09-18", "ゆうと", "16:00", "22:00"],
  ["2026-09-20", "せいや", "11:00", "17:00"],
  ["2026-09-21", "ゆうと", "16:00", "22:00"],
  ["2026-09-22", "ゆうと", "16:00", "22:00"],
  ["2026-09-23", "ゆうと", "16:00", "22:00"],
  ["2026-09-24", "ゆうと", "16:00", "22:00"],
  ["2026-09-25", "ゆうと", "16:00", "22:00"],
  ["2026-09-29", "ゆうと", "16:00", "22:00"],
  ["2026-09-30", "ゆうと", "16:00", "22:00"],
];
function hasEbisuShift(date, trainer) {
  return EBISU_SHIFTS.some(([d, t]) => d === date && t === trainer);
}

function overlaps(start, end, blockStart, blockEnd) {
  return toMinutes(start) < toMinutes(blockEnd) && toMinutes(end) > toMinutes(blockStart);
}

/** 9/15までの新宿研修: ゆうと・たけはるが同時にいる時間帯 */
function shinjukuTrainingBlocks(date) {
  if (date > "2026-09-15" || !SHINJUKU_TRAINING_DAYS.includes(date)) return [];
  if (TAKE_OFF.has(date) || YUTO_OFF.has(date)) return [];
  const blocks = [["10:00", "13:00"]];
  if (!KOHEI_DAYS.has(date)) {
    blocks.push(["16:00", "22:00"]);
  }
  return blocks;
}

function conflictsShinjukuTraining(date, start, end) {
  return shinjukuTrainingBlocks(date).some(([bs, be]) => overlaps(start, end, bs, be));
}

/** 新宿（単一ブース）で既存シフトと時間帯が重なるか */
function hasShinjukuOverlap(rows, date, start, end) {
  return rows.some(
    (r) =>
      r.store_name === "新宿" &&
      r.shift_date === date &&
      overlaps(start, end, r.start_local.slice(0, 5), r.end_local.slice(0, 5)),
  );
}

function hasEbisuOverlap(date, trainer, start, end) {
  return EBISU_SHIFTS.some(
    ([d, t, bs, be]) => d === date && t === trainer && overlaps(start, end, bs, be),
  );
}

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

function row(date, start, end, trainer, store, break_minutes = 0) {
  return {
    shift_date: date,
    start_local: toHHMMSS(start),
    end_local: toHHMMSS(end),
    trainer_name: trainer,
    store_name: store,
    break_minutes,
  };
}

function buildRows() {
  const rows = [];

  // こうへい 新宿
  for (const date of KOHEI_DAYS) {
    rows.push(row(date, "17:00", "22:00", "こうへい", "新宿"));
  }

  // だいき 新宿 9-13（水曜除外・研修時間帯と重複する日は除外）
  for (const date of DAIKI_DAYS) {
    if (conflictsShinjukuTraining(date, "09:00", "13:00")) continue;
    rows.push(row(date, "09:00", "13:00", "だいき", "新宿"));
  }

  // 9/1-14 新宿研修: ゆうと・たけはる 同時間（こうへい日はPMなし）
  for (const date of SHINJUKU_TRAINING_DAYS) {
    if (TAKE_OFF.has(date) || YUTO_OFF.has(date)) continue;
    const amEnd = TAKE_SHINJUKU_AM_EXTENDED.has(date) ? "16:00" : "13:00";
    rows.push(row(date, "10:00", amEnd, "ゆうと", "新宿"));
    rows.push(row(date, "10:00", amEnd, "たけはる", "新宿"));
    if (!KOHEI_DAYS.has(date)) {
      rows.push(row(date, "16:00", "22:00", "ゆうと", "新宿"));
      rows.push(row(date, "16:00", "22:00", "たけはる", "新宿"));
    }
  }

  // たけはる 新宿 追加（だいき振替分など）
  for (const [date, start, end] of TAKE_SHINJUKU_EXTRA) {
    if (TAKE_OFF.has(date)) continue;
    rows.push(row(date, start, end, "たけはる", "新宿"));
  }

  // たけはる 桜木町 9/17-
  for (const date of TAKE_SAKURA_DAYS) {
    if (TAKE_OFF.has(date)) continue;
    if (!TAKE_SAKURA_AM_OFF.has(date)) {
      rows.push(row(date, "10:00", "13:00", "たけはる", "桜木町"));
    }
    rows.push(row(date, "16:00", TAKE_SAKURA_PM_END[date] ?? "22:00", "たけはる", "桜木町"));
  }

  // 恵比寿（平日16-22 / 土曜休 / ~190枠・EBISU_SHIFTS が正）
  for (const [date, trainer, start, end] of EBISU_SHIFTS) {
    rows.push(row(date, start, end, trainer, "恵比寿"));
  }

  // ゆうと 新宿 9/15以降（恵比寿と同日不可・土曜のみ＋9/22 AM）
  const yutoShinjuku = [
    ["2026-09-19", "10:00", "13:00"],
    ["2026-09-22", "10:00", "13:00"],
    ["2026-09-26", "10:00", "13:00"], ["2026-09-26", "16:00", "22:00"],
  ];
  for (const [date, start, end] of yutoShinjuku) {
    if (YUTO_OFF.has(date)) continue;
    rows.push(row(date, start, end, "ゆうと", "新宿"));
  }

  // せいや 上野（13・20は恵比寿のため除外・それ以外は希望フル）
  const seiyaUeno = [
    ["2026-09-02", "10:00", "13:00"], ["2026-09-02", "16:00", "21:00"],
    ["2026-09-03", "10:00", "13:00"], ["2026-09-03", "16:00", "21:00"],
    ["2026-09-04", "10:00", "13:00"], ["2026-09-04", "16:00", "21:00"],
    ["2026-09-06", "10:00", "15:00"],
    ["2026-09-07", "10:00", "17:00"],
    ["2026-09-10", "10:00", "13:00"], ["2026-09-10", "16:00", "21:00"],
    ["2026-09-11", "10:00", "13:00"], ["2026-09-11", "16:00", "21:00"],
    ["2026-09-17", "10:00", "13:00"], ["2026-09-17", "16:00", "21:00"],
    ["2026-09-18", "10:00", "13:00"], ["2026-09-18", "16:00", "21:00"],
    ["2026-09-23", "10:00", "13:00"], ["2026-09-23", "16:00", "21:00"],
    ["2026-09-24", "10:00", "17:00"],
    ["2026-09-25", "10:00", "13:00"], ["2026-09-25", "16:00", "21:00"],
    ["2026-09-27", "10:00", "15:00"],
  ];
  for (const [date, start, end] of seiyaUeno) {
    if (SEIYA_OFF.has(date)) continue;
    if (hasEbisuShift(date, "せいや")) continue;
    const endCap = SEIYA_PARTIAL[date] ?? end;
    rows.push(row(date, start, endCap, "せいや", "上野"));
  }

  // ひろむ 上野（8月並み480枠・5,12,17は新宿10-18・9/9AMのみ上野）
  const hiromuUeno = [
    ["2026-09-02", "10:00", "13:00"], ["2026-09-02", "16:00", "21:00"],
    ["2026-09-03", "10:00", "13:00"], ["2026-09-03", "16:00", "21:00"],
    ["2026-09-04", "10:00", "13:00"], ["2026-09-04", "16:00", "21:00"],
    ["2026-09-08", "10:00", "13:00"], ["2026-09-08", "16:00", "21:00"],
    ["2026-09-09", "10:00", "13:00"],
    ["2026-09-10", "10:00", "13:00"], ["2026-09-10", "16:00", "21:00"],
    ["2026-09-11", "10:00", "13:00"], ["2026-09-11", "16:00", "21:00"],
    ["2026-09-15", "10:00", "13:00"], ["2026-09-15", "16:00", "21:00"],
    ["2026-09-16", "10:00", "13:00"], ["2026-09-16", "16:00", "21:00"],
    ["2026-09-18", "10:00", "13:00"], ["2026-09-18", "16:00", "21:00"],
    ["2026-09-19", "10:00", "13:00"], ["2026-09-19", "16:00", "21:00"],
    ["2026-09-22", "10:00", "13:00"], ["2026-09-22", "16:00", "21:00"],
    ["2026-09-23", "10:00", "13:00"], ["2026-09-23", "16:00", "21:00"],
    ["2026-09-24", "10:00", "13:00"], ["2026-09-24", "16:00", "21:00"],
    ["2026-09-25", "10:00", "13:00"], ["2026-09-25", "16:00", "21:00"],
    ["2026-09-26", "10:00", "13:00"], ["2026-09-26", "16:00", "21:00"],
    ["2026-09-29", "10:00", "13:00"], ["2026-09-29", "16:00", "21:00"],
    ["2026-09-30", "10:00", "13:00"], ["2026-09-30", "16:00", "21:00"],
  ];
  for (const [date, start, end] of hiromuUeno) {
    if (HIRO_OFF.has(date)) continue;
    if (hasEbisuOverlap(date, "ひろむ", start, end)) continue;
    rows.push(row(date, start, end, "ひろむ", "上野"));
  }

  // ひろむ 新宿（たけはる研修日を避け、だいき分3日を10-18で担当）
  const hiromuShinjuku = [
    ["2026-09-05", "10:00", "18:00"],
    ["2026-09-12", "10:00", "18:00"],
    ["2026-09-17", "10:00", "18:00"],
  ];
  for (const [date, start, end] of hiromuShinjuku) {
    if (HIRO_OFF.has(date)) continue;
    if (conflictsShinjukuTraining(date, start, end)) continue;
    rows.push(row(date, start, end, "ひろむ", "新宿"));
  }

  // りょう（基本桜木町・過剰分は新宿へ。新宿で他トレーナーと重なる日は桜木町へ退避）
  for (const [date, start, end] of RYO_SCHEDULE) {
    let store = RYO_SHINJUKU.has(date) ? "新宿" : "桜木町";
    if (store === "新宿" && hasShinjukuOverlap(rows, date, start, end)) store = "桜木町";
    rows.push(row(date, start, end, "りょう", store));
  }

  return rows;
}

function validateNoTrainerOverlap(rows) {
  const byTrainerDay = new Map();
  for (const r of rows) {
    const key = `${r.trainer_name}|${r.shift_date}`;
    const list = byTrainerDay.get(key) ?? [];
    list.push(r);
    byTrainerDay.set(key, list);
  }
  const conflicts = [];
  for (const [key, list] of byTrainerDay) {
    const sorted = list.slice().sort((a, b) => toMinutes(a.start_local) - toMinutes(b.start_local));
    for (let i = 0; i < sorted.length; i++) {
      for (let j = i + 1; j < sorted.length; j++) {
        if (toMinutes(sorted[i].start_local) < toMinutes(sorted[j].end_local) && toMinutes(sorted[i].end_local) > toMinutes(sorted[j].start_local)) {
          conflicts.push({ key, a: sorted[i], b: sorted[j] });
        }
      }
    }
  }
  if (conflicts.length) throw new Error(`同一トレーナー重複: ${JSON.stringify(conflicts.slice(0, 5), null, 2)}`);
}

function effectiveStoreSlots(rows) {
  const byStoreDate = new Map();
  for (const r of rows) {
    const k = `${r.store_name}|${r.shift_date}`;
    if (!byStoreDate.has(k)) byStoreDate.set(k, []);
    byStoreDate.get(k).push(r);
  }
  const byStore = new Map();
  for (const [k, dayRows] of byStoreDate) {
    const [store] = k.split("|");
    let daySlots = 0;
    for (let t = 540; t < 1320; t += 30) {
      let cap = 0;
      for (const r of dayRows) {
        const s = toMinutes(r.start_local);
        const e = toMinutes(r.end_local);
        if (s <= t && t + 30 <= e) cap++;
      }
      if (SINGLE_BOOTH.has(store)) cap = cap > 0 ? 1 : 0;
      daySlots += cap;
    }
    const cur = byStore.get(store) ?? 0;
    byStore.set(store, cur + daySlots);
  }
  return byStore;
}

function summarize(rows) {
  const byTrainer = new Map();
  for (const r of rows) {
    const t = byTrainer.get(r.trainer_name) ?? { days: new Set(), minutes: 0 };
    t.days.add(r.shift_date);
    t.minutes += toMinutes(r.end_local) - toMinutes(r.start_local);
    byTrainer.set(r.trainer_name, t);
  }
  const storeSlots = effectiveStoreSlots(rows);
  return {
    rows: rows.length,
    trainers: [...byTrainer.entries()].map(([name, v]) => ({ name, days: v.days.size, hours: Math.round(v.minutes / 60 * 10) / 10 })),
    storeSlots: [...storeSlots.entries()].map(([name, slots]) => ({
      name,
      slots,
      need: MEMBER_SLOT_NEED[name],
      ok: slots >= MEMBER_SLOT_NEED[name],
    })),
  };
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const rows = buildRows();
  validateNoTrainerOverlap(rows);
  const summary = summarize(rows);

  if (dryRun || !process.env.NEXT_PUBLIC_SUPABASE_URL) {
    console.log(JSON.stringify({ dryRun: true, month: MONTH, status: "draft", ...summary }, null, 2));
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL) return;
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY が未設定です。");

  const supabase = createClient(url, key, { auth: { persistSession: false } });
  const { data: stores } = await supabase.from("stores").select("id,name").in("name", STORE_NAMES);
  const storeIdByName = new Map((stores ?? []).map((s) => [s.name, s.id]));
  const { data: trainers } = await supabase.from("trainers").select("id,display_name").in("display_name", TRAINER_NAMES);
  const trainerIdByName = new Map((trainers ?? []).map((t) => [t.display_name, t.id]));

  const trainerIds = TRAINER_NAMES.map((n) => trainerIdByName.get(n)).filter(Boolean);
  const { data: existing } = await supabase
    .from("trainer_shifts")
    .select("id")
    .in("trainer_id", trainerIds)
    .gte("shift_date", `${MONTH}-01`)
    .lte("shift_date", `${MONTH}-${MONTH_LAST_DAY}`);

  const payload = rows.map((r) => ({
    trainer_id: trainerIdByName.get(r.trainer_name),
    store_id: storeIdByName.get(r.store_name),
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

  console.log(JSON.stringify({ done: true, deleted: ids.length, inserted: payload.length, status: "draft", ...summary }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
