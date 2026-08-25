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
// ひろむ: 週2休・月8回（日+月ペア）
const HIRO_OFF = new Set([
  "2026-09-06", "2026-09-07", "2026-09-13", "2026-09-14",
  "2026-09-20", "2026-09-21", "2026-09-27", "2026-09-28",
]);
const KOHEI_DAYS = new Set(["2026-09-02", "2026-09-09", "2026-09-17", "2026-09-24", "2026-09-29"]);
// だいき 新宿 9-13（水曜除外・8月比+5%用に7日）
const DAIKI_DAYS = ["2026-09-05", "2026-09-06", "2026-09-07", "2026-09-12", "2026-09-13", "2026-09-14", "2026-09-17"];
const SHINJUKU_TRAINING_DAYS = ["2026-09-01", "2026-09-02", "2026-09-03", "2026-09-04", "2026-09-07", "2026-09-08", "2026-09-09", "2026-09-10", "2026-09-11", "2026-09-14"];

const SEIYA_OFF = new Set(["2026-09-01", "2026-09-05", "2026-09-08", "2026-09-09", "2026-09-12", "2026-09-14", "2026-09-15", "2026-09-16", "2026-09-19", "2026-09-21", "2026-09-22", "2026-09-26", "2026-09-28", "2026-09-29", "2026-09-30"]);
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
// 9/20以降 りょう 新宿（指定シフトを店舗変更・9/23含む）
const RYO_SHINJUKU = new Set(["2026-09-22", "2026-09-23", "2026-09-24", "2026-09-26", "2026-09-28", "2026-09-30"]);

// 恵比寿: 平日16-22 / 土曜休 / 日曜11-17
// W2-W3 shuffle + 枠数補強（ベース以外の店舗）
const SHUFFLE = [
  ["2026-09-08", "ひろむ", "恵比寿", "16:00", "22:00"], ["2026-09-09", "ひろむ", "恵比寿", "16:00", "22:00"],
  ["2026-09-10", "せいや", "恵比寿", "16:00", "22:00"], ["2026-09-11", "ひろむ", "恵比寿", "16:00", "22:00"],
  ["2026-09-17", "せいや", "恵比寿", "16:00", "22:00"], ["2026-09-18", "せいや", "恵比寿", "16:00", "22:00"],
  ["2026-09-25", "せいや", "恵比寿", "16:00", "22:00"],
  ["2026-09-21", "ゆうと", "恵比寿", "16:00", "22:00"],
];
function hasShuffle(date, trainer) {
  return SHUFFLE.some(([d, t]) => d === date && t === trainer);
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

  // りょう（9/20以降は新宿に数日・それ以外は桜木町指定どおり）
  for (const [date, start, end] of RYO_SCHEDULE) {
    const store = RYO_SHINJUKU.has(date) ? "新宿" : "桜木町";
    rows.push(row(date, start, end, "りょう", store));
  }
  if (!RYO_SCHEDULE.some(([d]) => d === "2026-09-23")) {
    rows.push(row("2026-09-23", "10:00", "18:00", "りょう", "新宿"));
  }

  // こうへい 新宿
  for (const date of KOHEI_DAYS) {
    rows.push(row(date, "17:00", "22:00", "こうへい", "新宿"));
  }

  // だいき 新宿 9-13（水曜除外）
  for (const date of DAIKI_DAYS) {
    rows.push(row(date, "09:00", "13:00", "だいき", "新宿"));
  }

  // 9/1-14 新宿研修: ゆうと・たけはる 同時間
  for (const date of SHINJUKU_TRAINING_DAYS) {
    if (TAKE_OFF.has(date) || YUTO_OFF.has(date)) continue;
    rows.push(row(date, "10:00", "13:00", "ゆうと", "新宿"));
    rows.push(row(date, "10:00", "13:00", "たけはる", "新宿"));
    if (!KOHEI_DAYS.has(date)) {
      rows.push(row(date, "16:00", "22:00", "ゆうと", "新宿"));
      rows.push(row(date, "16:00", "22:00", "たけはる", "新宿"));
    }
  }

  // たけはる 新宿研修 9/1-14 のみ（桜木町はりょう単独384枠のため9/17-は入れない）
  // ※9/17以降の桜木町はりょう指定シフトのみ（会員32名×12枠=384）
  // ゆうと 恵比寿 9/15-（平日16-22のみ。土曜休・日曜はゆうと休みのためなし）
  const yutoEbisu = [
    ["2026-09-15", "16:00", "22:00"], ["2026-09-16", "16:00", "22:00"], ["2026-09-17", "16:00", "22:00"],
    ["2026-09-18", "16:00", "22:00"],
    ["2026-09-22", "16:00", "22:00"], ["2026-09-23", "16:00", "22:00"], ["2026-09-24", "16:00", "22:00"],
    ["2026-09-25", "16:00", "22:00"],
    ["2026-09-29", "16:00", "22:00"], ["2026-09-30", "16:00", "22:00"],
  ];
  for (const [date, start, end] of yutoEbisu) {
    if (YUTO_OFF.has(date)) continue;
    if (hasShuffle(date, "ゆうと")) continue;
    rows.push(row(date, start, end, "ゆうと", "恵比寿"));
  }

  // ゆうと 新宿 9/15-（恵比寿と同日不可・こうへい日はAMのみ）
  const yutoShinjuku = [
    ["2026-09-15", "10:00", "13:00"],
    ["2026-09-19", "10:00", "13:00"],
    ["2026-09-26", "10:00", "13:00"], ["2026-09-26", "16:00", "22:00"],
    ["2026-09-22", "10:00", "13:00"],
  ];
  for (const [date, start, end] of yutoShinjuku) {
    if (YUTO_OFF.has(date)) continue;
    if (hasShuffle(date, "ゆうと")) continue;
    rows.push(row(date, start, end, "ゆうと", "新宿"));
  }

  // せいや 上野
  const seiyaUeno = [
    ["2026-09-02", "10:00", "13:00"], ["2026-09-02", "16:00", "20:00"],
    ["2026-09-03", "10:00", "13:00"], ["2026-09-03", "16:00", "20:00"],
    ["2026-09-04", "10:00", "13:00"], ["2026-09-04", "16:00", "20:00"],
    ["2026-09-06", "10:00", "15:00"],
    ["2026-09-07", "10:00", "17:00"],
    ["2026-09-10", "10:00", "13:00"], ["2026-09-10", "16:00", "20:00"],
    ["2026-09-11", "10:00", "13:00"], ["2026-09-11", "16:00", "20:00"],
    ["2026-09-13", "10:00", "15:00"],
    ["2026-09-17", "10:00", "13:00"], ["2026-09-17", "16:00", "20:00"],
    ["2026-09-18", "10:00", "13:00"], ["2026-09-18", "16:00", "20:00"],
    ["2026-09-20", "10:00", "15:00"],
    ["2026-09-23", "10:00", "13:00"], ["2026-09-23", "16:00", "20:00"],
    ["2026-09-24", "10:00", "17:00"],
    ["2026-09-25", "10:00", "13:00"], ["2026-09-25", "16:00", "20:00"],
    ["2026-09-27", "10:00", "15:00"],
  ];
  for (const [date, start, end] of seiyaUeno) {
    if (SEIYA_OFF.has(date)) continue;
    if (hasShuffle(date, "せいや")) continue;
    const endCap = SEIYA_PARTIAL[date] ?? end;
    rows.push(row(date, start, endCap, "せいや", "上野"));
  }

  // ひろむ 上野（2枠日を増やして504枠に近づける）
  const hiromuUeno = [
    ["2026-09-01", "10:00", "16:00"], ["2026-09-02", "10:00", "13:00"], ["2026-09-02", "16:00", "20:00"],
    ["2026-09-03", "10:00", "13:00"], ["2026-09-03", "16:00", "21:00"],
    ["2026-09-04", "10:00", "12:00"], ["2026-09-04", "16:00", "21:00"],
    ["2026-09-05", "10:00", "13:00"], ["2026-09-05", "16:00", "20:00"],
    ["2026-09-08", "10:00", "13:00"], ["2026-09-08", "16:00", "20:00"],
    ["2026-09-09", "10:00", "13:00"], ["2026-09-09", "16:00", "20:00"],
    ["2026-09-10", "10:00", "13:00"], ["2026-09-10", "16:00", "20:00"],
    ["2026-09-11", "10:00", "12:00"], ["2026-09-11", "16:00", "21:00"],
    ["2026-09-12", "10:00", "16:00"],
    ["2026-09-15", "10:00", "13:00"], ["2026-09-15", "16:00", "20:00"],
    ["2026-09-16", "10:00", "13:00"], ["2026-09-16", "16:00", "20:00"],
    ["2026-09-17", "10:00", "13:00"], ["2026-09-17", "16:00", "20:00"],
    ["2026-09-19", "10:00", "13:00"], ["2026-09-19", "16:00", "20:00"],
    ["2026-09-22", "10:00", "13:00"], ["2026-09-22", "16:00", "20:00"],
    ["2026-09-23", "10:00", "13:00"], ["2026-09-23", "16:00", "20:00"],
    ["2026-09-24", "10:00", "13:00"], ["2026-09-24", "16:00", "20:00"],
    ["2026-09-25", "10:00", "13:00"], ["2026-09-25", "16:00", "21:00"],
    ["2026-09-26", "10:00", "13:00"], ["2026-09-26", "16:00", "20:00"],
    ["2026-09-29", "10:00", "13:00"], ["2026-09-29", "16:00", "20:00"],
    ["2026-09-30", "10:00", "13:00"], ["2026-09-30", "16:00", "20:00"],
  ];
  for (const [date, start, end] of hiromuUeno) {
    if (HIRO_OFF.has(date)) continue;
    if (hasShuffle(date, "ひろむ")) continue;
    rows.push(row(date, start, end, "ひろむ", "上野"));
  }

  // shuffle
  for (const [date, trainer, store, start, end] of SHUFFLE) {
    rows.push(row(date, start, end, trainer, store));
  }

  // りょう 9/23新宿・ひろむ新宿シャッフルは上で反映済み

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
