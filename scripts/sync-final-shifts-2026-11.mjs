/**
 * 2026-11 東京4店舗のシフト（恵比寿・上野・新宿・桜木町）
 *
 * 福岡は触らない。カレンダーの確認が終わるまで --apply しない。
 * 反映順: このファイルの確認 → --dry-run → 11月予約0件 → --apply
 *
 *   node scripts/sync-final-shifts-2026-11.mjs
 *   node --env-file=.env.local scripts/sync-final-shifts-2026-11.mjs --dry-run
 *   node --env-file=.env.local scripts/sync-final-shifts-2026-11.mjs --apply
 */
const MONTH = "2026-11";
const MONTH_START = "2026-11-01";
const MONTH_END = "2026-11-30";
const NEXT_MONTH_START = "2026-12-01T00:00:00+09:00";
const MONTH_START_ISO = "2026-11-01T00:00:00+09:00";
const STORE_NAMES = ["恵比寿", "上野", "新宿", "桜木町"];
const SINGLE_BOOTH = new Set(["恵比寿", "新宿"]);
const REVENUE_YEN = 3_870_000;
const LABOR_CAP_YEN = 1_354_500;
const EXPECT_SLOTS = 1558;
const EXPECT_PAY_YEN = 1_354_498;

/** [date, start, end, trainer, store] 分割は別行 */
const SHIFTS = [
  ["2026-11-01", "09:00", "14:00", "ひろむ", "上野"],
  ["2026-11-01", "17:00", "22:00", "ひろむ", "上野"],
  ["2026-11-01", "10:00", "16:00", "ゆうと", "恵比寿"],
  ["2026-11-01", "09:00", "17:00", "たけはる", "桜木町"],
  ["2026-11-01", "10:00", "18:00", "りょう", "桜木町"],
  ["2026-11-02", "16:00", "22:00", "ひろむ", "上野"],
  ["2026-11-02", "10:00", "14:00", "せいや", "上野"],
  ["2026-11-02", "17:00", "22:00", "せいや", "上野"],
  ["2026-11-02", "09:00", "13:00", "ゆうと", "新宿"],
  ["2026-11-02", "16:00", "22:00", "ゆうと", "新宿"],
  ["2026-11-02", "09:00", "14:30", "たけはる", "桜木町"],
  ["2026-11-02", "15:30", "17:00", "たけはる", "桜木町"],
  ["2026-11-03", "10:00", "14:00", "せいや", "上野"],
  ["2026-11-03", "17:00", "22:00", "せいや", "上野"],
  ["2026-11-03", "10:00", "16:00", "ゆうと", "恵比寿"],
  ["2026-11-03", "09:00", "17:00", "たけはる", "桜木町"],
  ["2026-11-03", "10:00", "18:00", "りょう", "桜木町"],
  ["2026-11-04", "09:00", "14:00", "ひろむ", "上野"],
  ["2026-11-04", "17:00", "22:00", "ひろむ", "上野"],
  ["2026-11-04", "10:00", "13:00", "りょう", "新宿"],
  ["2026-11-04", "16:00", "21:30", "りょう", "新宿"],
  ["2026-11-04", "10:00", "13:00", "たけはる", "桜木町"],
  ["2026-11-04", "16:00", "22:00", "たけはる", "桜木町"],
  ["2026-11-05", "16:00", "22:00", "ひろむ", "上野"],
  ["2026-11-05", "10:00", "13:00", "りょう", "新宿"],
  ["2026-11-05", "16:00", "21:30", "りょう", "新宿"],
  ["2026-11-05", "16:00", "22:00", "たけはる", "桜木町"],
  ["2026-11-06", "16:00", "22:00", "ひろむ", "上野"],
  ["2026-11-06", "14:00", "22:00", "ゆうと", "新宿"],
  ["2026-11-06", "09:00", "13:00", "たけはる", "桜木町"],
  ["2026-11-06", "16:00", "22:00", "たけはる", "桜木町"],
  ["2026-11-06", "16:00", "21:30", "りょう", "桜木町"],
  ["2026-11-07", "09:00", "13:00", "せいや", "上野"],
  ["2026-11-07", "16:00", "22:00", "せいや", "上野"],
  ["2026-11-07", "10:00", "18:00", "りょう", "桜木町"],
  ["2026-11-08", "09:00", "14:00", "ひろむ", "上野"],
  ["2026-11-08", "17:00", "22:00", "ひろむ", "上野"],
  ["2026-11-08", "10:00", "16:00", "ゆうと", "恵比寿"],
  ["2026-11-09", "10:00", "14:00", "せいや", "上野"],
  ["2026-11-09", "17:00", "22:00", "せいや", "上野"],
  ["2026-11-09", "17:00", "22:00", "ゆうと", "恵比寿"],
  ["2026-11-09", "09:00", "13:00", "りょう", "新宿"],
  ["2026-11-09", "16:00", "21:30", "りょう", "新宿"],
  ["2026-11-09", "09:00", "14:30", "たけはる", "桜木町"],
  ["2026-11-09", "15:30", "17:00", "たけはる", "桜木町"],
  ["2026-11-10", "16:00", "22:00", "ひろむ", "上野"],
  ["2026-11-10", "10:00", "14:00", "せいや", "上野"],
  ["2026-11-10", "17:00", "22:00", "せいや", "上野"],
  ["2026-11-10", "14:00", "22:00", "ゆうと", "新宿"],
  ["2026-11-10", "14:00", "14:30", "たけはる", "桜木町"],
  ["2026-11-10", "15:30", "22:00", "たけはる", "桜木町"],
  ["2026-11-10", "16:00", "21:30", "りょう", "桜木町"],
  ["2026-11-11", "17:00", "22:00", "ゆうと", "恵比寿"],
  ["2026-11-11", "10:00", "13:00", "りょう", "新宿"],
  ["2026-11-11", "16:00", "21:30", "りょう", "新宿"],
  ["2026-11-11", "09:00", "13:00", "たけはる", "桜木町"],
  ["2026-11-11", "16:00", "22:00", "たけはる", "桜木町"],
  ["2026-11-12", "09:00", "14:00", "ひろむ", "上野"],
  ["2026-11-12", "17:00", "22:00", "ひろむ", "上野"],
  ["2026-11-12", "17:00", "22:00", "ゆうと", "恵比寿"],
  ["2026-11-12", "10:00", "13:00", "りょう", "新宿"],
  ["2026-11-12", "16:00", "21:30", "りょう", "新宿"],
  ["2026-11-12", "16:00", "22:00", "たけはる", "桜木町"],
  ["2026-11-13", "10:00", "14:00", "ひろむ", "上野"],
  ["2026-11-13", "17:00", "20:00", "ひろむ", "上野"],
  ["2026-11-13", "09:00", "13:00", "ゆうと", "新宿"],
  ["2026-11-13", "16:00", "22:00", "ゆうと", "新宿"],
  ["2026-11-13", "09:00", "13:00", "たけはる", "桜木町"],
  ["2026-11-13", "16:00", "22:00", "たけはる", "桜木町"],
  ["2026-11-13", "16:00", "21:30", "りょう", "桜木町"],
  ["2026-11-14", "09:00", "17:00", "ひろむ", "新宿"],
  ["2026-11-14", "09:00", "13:00", "せいや", "上野"],
  ["2026-11-14", "16:00", "22:00", "せいや", "上野"],
  ["2026-11-14", "10:00", "18:00", "りょう", "桜木町"],
  ["2026-11-15", "09:00", "14:00", "ひろむ", "上野"],
  ["2026-11-15", "17:00", "22:00", "ひろむ", "上野"],
  ["2026-11-15", "10:00", "16:00", "ゆうと", "恵比寿"],
  ["2026-11-15", "10:00", "18:00", "りょう", "桜木町"],
  ["2026-11-16", "16:00", "22:00", "ひろむ", "上野"],
  ["2026-11-16", "10:00", "14:00", "せいや", "上野"],
  ["2026-11-16", "17:00", "22:00", "せいや", "上野"],
  ["2026-11-16", "17:00", "22:00", "ゆうと", "恵比寿"],
  ["2026-11-16", "10:00", "13:00", "りょう", "新宿"],
  ["2026-11-16", "16:00", "21:30", "りょう", "新宿"],
  ["2026-11-16", "09:00", "14:30", "たけはる", "桜木町"],
  ["2026-11-16", "15:30", "17:00", "たけはる", "桜木町"],
  ["2026-11-17", "10:00", "14:00", "せいや", "上野"],
  ["2026-11-17", "17:00", "22:00", "せいや", "上野"],
  ["2026-11-17", "17:00", "22:00", "ゆうと", "恵比寿"],
  ["2026-11-17", "10:00", "13:00", "りょう", "新宿"],
  ["2026-11-17", "16:00", "21:30", "りょう", "新宿"],
  ["2026-11-17", "16:00", "22:00", "たけはる", "桜木町"],
  ["2026-11-18", "09:00", "14:00", "ひろむ", "上野"],
  ["2026-11-18", "17:00", "22:00", "ひろむ", "上野"],
  ["2026-11-18", "10:00", "13:00", "りょう", "新宿"],
  ["2026-11-18", "16:00", "21:30", "りょう", "新宿"],
  ["2026-11-19", "16:00", "22:00", "ひろむ", "上野"],
  ["2026-11-19", "17:00", "22:00", "ゆうと", "恵比寿"],
  ["2026-11-19", "10:00", "13:00", "りょう", "新宿"],
  ["2026-11-19", "16:00", "21:30", "りょう", "新宿"],
  ["2026-11-20", "10:00", "14:00", "ひろむ", "上野"],
  ["2026-11-20", "17:00", "22:00", "ひろむ", "上野"],
  ["2026-11-20", "17:00", "22:00", "ゆうと", "恵比寿"],
  ["2026-11-20", "10:00", "13:00", "りょう", "新宿"],
  ["2026-11-20", "16:00", "21:30", "りょう", "新宿"],
  ["2026-11-20", "16:00", "22:00", "たけはる", "桜木町"],
  ["2026-11-21", "09:00", "13:00", "せいや", "上野"],
  ["2026-11-21", "16:00", "22:00", "せいや", "上野"],
  ["2026-11-21", "09:00", "17:00", "たけはる", "桜木町"],
  ["2026-11-21", "10:00", "18:00", "りょう", "桜木町"],
  ["2026-11-22", "09:00", "14:00", "ひろむ", "上野"],
  ["2026-11-22", "17:00", "22:00", "ひろむ", "上野"],
  ["2026-11-22", "10:00", "16:00", "ゆうと", "恵比寿"],
  ["2026-11-22", "09:00", "17:00", "たけはる", "桜木町"],
  ["2026-11-22", "10:00", "18:00", "りょう", "桜木町"],
  ["2026-11-23", "09:00", "13:00", "せいや", "上野"],
  ["2026-11-23", "16:00", "22:00", "せいや", "上野"],
  ["2026-11-23", "10:00", "16:00", "ゆうと", "恵比寿"],
  ["2026-11-23", "10:00", "18:00", "りょう", "桜木町"],
  ["2026-11-23", "09:00", "17:00", "たけはる", "桜木町"],
  ["2026-11-24", "10:00", "14:00", "せいや", "上野"],
  ["2026-11-24", "17:00", "22:00", "せいや", "上野"],
  ["2026-11-24", "09:00", "13:00", "ゆうと", "新宿"],
  ["2026-11-24", "16:00", "22:00", "ゆうと", "新宿"],
  ["2026-11-24", "09:00", "13:00", "たけはる", "桜木町"],
  ["2026-11-24", "16:00", "22:00", "たけはる", "桜木町"],
  ["2026-11-25", "09:00", "14:00", "ひろむ", "上野"],
  ["2026-11-25", "17:00", "22:00", "ひろむ", "上野"],
  ["2026-11-25", "10:00", "14:00", "りょう", "桜木町"],
  ["2026-11-25", "17:00", "21:30", "りょう", "桜木町"],
  ["2026-11-26", "16:00", "22:00", "ひろむ", "上野"],
  ["2026-11-26", "17:00", "22:00", "ゆうと", "恵比寿"],
  ["2026-11-26", "16:00", "21:30", "りょう", "新宿"],
  ["2026-11-26", "09:00", "13:00", "たけはる", "桜木町"],
  ["2026-11-26", "16:00", "22:00", "たけはる", "桜木町"],
  ["2026-11-27", "10:00", "14:00", "ひろむ", "上野"],
  ["2026-11-27", "17:00", "22:00", "ひろむ", "上野"],
  ["2026-11-27", "09:00", "13:00", "ゆうと", "新宿"],
  ["2026-11-27", "16:00", "22:00", "ゆうと", "新宿"],
  ["2026-11-27", "09:00", "13:00", "たけはる", "桜木町"],
  ["2026-11-27", "16:00", "22:00", "たけはる", "桜木町"],
  ["2026-11-27", "16:00", "21:30", "りょう", "桜木町"],
  ["2026-11-28", "09:00", "13:00", "せいや", "上野"],
  ["2026-11-28", "16:00", "22:00", "せいや", "上野"],
  ["2026-11-28", "10:00", "18:00", "りょう", "桜木町"],
  ["2026-11-28", "09:00", "17:00", "たけはる", "桜木町"],
  ["2026-11-29", "10:00", "16:00", "ひろむ", "新宿"],
  ["2026-11-29", "10:00", "16:00", "ゆうと", "恵比寿"],
  ["2026-11-29", "10:00", "18:00", "りょう", "桜木町"],
  ["2026-11-30", "10:00", "14:00", "ひろむ", "上野"],
  ["2026-11-30", "17:00", "22:00", "ひろむ", "上野"],
  ["2026-11-30", "09:00", "13:00", "ゆうと", "新宿"],
  ["2026-11-30", "16:00", "22:00", "ゆうと", "新宿"],
  ["2026-11-30", "09:00", "14:30", "たけはる", "桜木町"],
  ["2026-11-30", "15:30", "17:00", "たけはる", "桜木町"],

];

function mins(hhmm) {
  const [h, m] = String(hhmm).slice(0, 5).split(":").map(Number);
  return h * 60 + m;
}

function hours(start, end) {
  return (mins(end) - mins(start)) / 60;
}

function ymd(day) {
  return `${MONTH}-${String(day).padStart(2, "0")}`;
}

function weekday(date) {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

function rowsFromShifts() {
  return SHIFTS.map(([shift_date, start, end, trainer_name, store_name]) => ({
    shift_date,
    start_local: `${start}:00`,
    end_local: `${end}:00`,
    trainer_name,
    store_name,
    break_minutes: store_name === "上野" && mins(start) <= 20 * 60 && mins(end) >= 21 * 60 ? 60 : 0,
  }));
}

function countSlots(rows) {
  const by = new Map();
  for (const r of rows) {
    const k = `${r.store_name}|${r.shift_date}`;
    if (!by.has(k)) by.set(k, []);
    by.get(k).push(r);
  }
  const per = {};
  let total = 0;
  for (const [k, dayRows] of by) {
    const store = k.split("|")[0];
    let day = 0;
    for (let t = 9 * 60; t < 22 * 60; t += 30) {
      if (store === "上野" && t >= 20 * 60 && t < 21 * 60) continue;
      let cap = 0;
      for (const r of dayRows) {
        const s = mins(r.start_local);
        const e = mins(r.end_local);
        if (s <= t && t + 30 <= e) cap += 1;
      }
      if (SINGLE_BOOTH.has(store)) cap = cap > 0 ? 1 : 0;
      day += cap;
    }
    per[store] = (per[store] ?? 0) + day;
    total += day;
  }
  return { total, per };
}

function estimatePayroll(rows) {
  const by = new Map();
  for (const r of rows) {
    if (!by.has(r.trainer_name)) by.set(r.trainer_name, []);
    by.get(r.trainer_name).push(r);
  }
  function stats(name) {
    const list = by.get(name) ?? [];
    const days = new Set(list.map((r) => r.shift_date));
    const totalH = list.reduce((h, r) => h + hours(r.start_local, r.end_local), 0);
    const byDay = new Map();
    for (const r of list) {
      if (!byDay.has(r.shift_date)) byDay.set(r.shift_date, []);
      byDay.get(r.shift_date).push(r);
    }
    let bonusDays = 0;
    for (const segs of byDay.values()) {
      const sorted = segs.slice().sort((a, b) => mins(a.start_local) - mins(b.start_local));
      for (let i = 0; i + 1 < sorted.length; i++) {
        if (mins(sorted[i + 1].start_local) - mins(sorted[i].end_local) >= 180) {
          bonusDays += 1;
          break;
        }
      }
    }
    return { days: days.size, hours: Math.round(totalH * 10) / 10, bonusDays };
  }
  const ryo = stats("りょう");
  const hiromu = stats("ひろむ");
  const seiya = stats("せいや");
  const yuto = stats("ゆうと");
  const take = stats("たけはる");
  const ryoShinjukuDays = new Set(
    (by.get("りょう") ?? []).filter((r) => r.store_name === "新宿").map((r) => r.shift_date),
  ).size;
  const money = {
    ゆうと: 260_000 + 13_120,
    たけはる: 260_000 + 15_388,
    りょう: Math.round(ryo.hours * 1500) + ryo.bonusDays * 1500 + ryoShinjukuDays * 900,
    ひろむ: Math.round(hiromu.hours * 1500) + hiromu.bonusDays * 1500 + 18_030,
    せいや: Math.round(seiya.hours * 1400) + seiya.bonusDays * 1400 + seiya.days * 880,
  };
  const total = Object.values(money).reduce((s, n) => s + n, 0);
  return {
    trainers: { ゆうと: yuto, たけはる: take, りょう: ryo, ひろむ: hiromu, せいや: seiya },
    money,
    total,
    pct: Math.round((total / REVENUE_YEN) * 1000) / 10,
  };
}

function validate(rows) {
  const errors = [];
  const byTrainerDay = new Map();
  for (const r of rows) {
    const k = `${r.trainer_name}|${r.shift_date}`;
    if (!byTrainerDay.has(k)) byTrainerDay.set(k, []);
    byTrainerDay.get(k).push(r);
  }
  for (const [k, list] of byTrainerDay) {
    const sorted = list.slice().sort((a, b) => mins(a.start_local) - mins(b.start_local));
    for (let i = 0; i < sorted.length; i++) {
      for (let j = i + 1; j < sorted.length; j++) {
        if (mins(sorted[i].start_local) < mins(sorted[j].end_local) && mins(sorted[i].end_local) > mins(sorted[j].start_local)) {
          errors.push(`同一トレーナーが重なっています: ${k}`);
        }
      }
    }
    for (let i = 0; i + 1 < sorted.length; i++) {
      if (sorted[i].store_name !== sorted[i + 1].store_name) {
        const gap = mins(sorted[i + 1].start_local) - mins(sorted[i].end_local);
        if (gap < 180) errors.push(`店舗間が3時間未満です: ${k} ${gap}分`);
      }
    }
  }
  const namesByDate = new Map();
  for (const r of rows) {
    if (r.trainer_name === "たけはる" && r.store_name === "新宿") errors.push(`たけはるが新宿です: ${r.shift_date}`);
    if (["こうへい", "あいと", "だいき"].includes(r.trainer_name)) errors.push(`希望がない人を入れています: ${r.trainer_name}`);
    if (!namesByDate.has(r.shift_date)) namesByDate.set(r.shift_date, new Set());
    namesByDate.get(r.shift_date).add(r.trainer_name);
    const sakuraBreakClosed = ![1, 3, 7, 8, 14, 15, 21, 22, 23, 28, 29].includes(Number(r.shift_date.slice(-2)));
    if (sakuraBreakClosed && r.store_name === "桜木町" && mins(r.start_local) < 15 * 60 + 30 && mins(r.end_local) > 14 * 60 + 30) {
      errors.push(`桜木町の14:30–15:30が開いています: ${r.shift_date}`);
    }
  }
  for (const [date, names] of namesByDate) {
    if (names.has("せいや") && names.has("ひろむ") && ![ymd(2), ymd(10), ymd(14), ymd(16)].includes(date)) errors.push(`せいやとひろむが同日です: ${date}`);
  }
  const shinjuku = new Map();
  for (const r of rows) {
    if (r.store_name !== "新宿") continue;
    if (!shinjuku.has(r.shift_date)) shinjuku.set(r.shift_date, []);
    shinjuku.get(r.shift_date).push(r);
  }
  for (const [date, list] of shinjuku) {
    const sorted = list.slice().sort((a, b) => mins(a.start_local) - mins(b.start_local));
    for (let i = 0; i < sorted.length; i++) {
      for (let j = i + 1; j < sorted.length; j++) {
        if (sorted[i].trainer_name !== sorted[j].trainer_name && mins(sorted[i].start_local) < mins(sorted[j].end_local) && mins(sorted[i].end_local) > mins(sorted[j].start_local)) {
          errors.push(`新宿が同時2人です: ${date}`);
        }
      }
    }
  }
  for (let day = 1; day <= 30; day++) {
    const date = ymd(day);
    const dow = weekday(date);
    if (dow === 0 || dow === 6 || [3, 23, 25].includes(day)) continue;
    const night = rows.some(
      (r) => r.shift_date === date && r.store_name === "新宿" && mins(r.start_local) <= 16 * 60 && mins(r.end_local) >= 21 * 60 + 30,
    );
    if (!night) errors.push(`平日の新宿の夜がありません: ${date}`);
    if (dow === 3 && day !== 25) {
      const ryo = rows.some(
        (r) => r.shift_date === date && r.store_name === "新宿" && r.trainer_name === "りょう" && mins(r.start_local) <= 16 * 60 && mins(r.end_local) >= 21 * 60 + 30,
      );
      if (!ryo) errors.push(`水曜の新宿の夜がりょうではありません: ${date}`);
    }
    if (dow === 5) {
      const fri = rows.some(
        (r) => r.shift_date === date && r.store_name === "上野" && mins(r.start_local) <= 17 * 60 && mins(r.end_local) >= 18 * 60,
      );
      if (!fri) errors.push(`金曜の上野17時がありません: ${date}`);
    }
  }
  for (let day = 1; day <= 30; day++) {
    const date = ymd(day);
    const dow = weekday(date);
    if (dow === 1) {
      const late = rows.some((r) => r.shift_date === date && r.store_name === "桜木町" && mins(r.start_local) >= 16 * 60);
      if (late) errors.push(`桜木町の月曜の夜が開いています: ${date}`);
    }
    if (dow === 2 || dow === 5) {
      // 11/3・17・20 は2人目を新宿・恵比寿へ移した。11/24 はりょうの希望休。11/10 は14:00開始のたけはると16:00–21:30のりょう。
      if (![3, 17, 20, 24].includes(day)) {
        for (const [a, b] of [[16 * 60, 21 * 60]]) {
          const names = new Set(
            rows
              .filter((r) => r.shift_date === date && r.store_name === "桜木町" && mins(r.start_local) <= a && mins(r.end_local) >= b)
              .map((r) => r.trainer_name),
          );
          if (names.size < 2) errors.push(`桜木町の火金2人が欠けています: ${date} ${a}`);
        }
      }
      const mid = new Set(
        rows
          .filter((r) => r.shift_date === date && r.store_name === "桜木町" && mins(r.start_local) <= 11 * 60 && mins(r.end_local) >= 13 * 60)
          .map((r) => r.trainer_name),
      );
      // 11/3 は祝日でたけはるとりょうの2人。11/17・20 は朝なし。11/10 は14:00開始で朝なし。
      const expectMid = day === 3 ? 2 : [10, 17, 20].includes(day) ? 0 : 1;
      if (mid.size !== expectMid) errors.push(`桜木町の11–13時が1人ではありません: ${date}`);
    }
  }
  for (const day of [8, 18, 19]) {
    if (rows.some((r) => r.shift_date === ymd(day) && r.trainer_name === "たけはる")) errors.push(`たけはるの必須休です: ${ymd(day)}`);
  }
  const takeharuEveningOnly = [];
  for (let day = 1; day <= 30; day++) {
    const date = ymd(day);
    const segs = rows.filter((r) => r.shift_date === date && r.trainer_name === "たけはる");
    if (segs.length && segs.every((r) => mins(r.start_local) >= 16 * 60)) takeharuEveningOnly.push(day);
  }
  for (let i = 1; i < takeharuEveningOnly.length; i++) {
    if (takeharuEveningOnly[i] - takeharuEveningOnly[i - 1] === 1) {
      errors.push(`たけはるの16時開始が連続しています: ${ymd(takeharuEveningOnly[i - 1])} ${ymd(takeharuEveningOnly[i])}`);
    }
  }
  if (rows.some((r) => r.shift_date === ymd(11) && r.trainer_name === "ひろむ")) errors.push("ひろむの11日が休みではありません");
  for (const day of [2, 8, 24, 30]) {
    if (rows.some((r) => r.shift_date === ymd(day) && r.trainer_name === "りょう")) errors.push(`りょうの希望休です: ${ymd(day)}`);
  }
  for (const day of [4, 5]) {
    if (rows.some((r) => r.shift_date === ymd(day) && r.trainer_name === "ゆうと")) errors.push(`ゆうとの勤務不可です: ${ymd(day)}`);
  }
  for (const day of [7, 14, 21, 28, 18, 25]) {
    if (rows.some((r) => r.shift_date === ymd(day) && r.trainer_name === "ゆうと")) errors.push(`ゆうとの休みです: ${ymd(day)}`);
  }
  if (rows.some((r) => r.shift_date === ymd(6) && r.trainer_name === "ゆうと" && mins(r.start_local) !== 14 * 60)) {
    errors.push("ゆうとの11/6は14:00開始ではありません");
  }
  const yutoDays = new Set(rows.filter((r) => r.trainer_name === "ゆうと").map((r) => r.shift_date));
  if (yutoDays.size !== 22) errors.push(`ゆうとの出勤日数が22ではありません: ${yutoDays.size}`);
  if (errors.length) throw new Error(errors.join("\n"));
}

function calendar(rows) {
  const wd = "日月火水木金土";
  const by = new Map();
  for (const r of rows) {
    if (!by.has(r.shift_date)) by.set(r.shift_date, []);
    by.get(r.shift_date).push(`${r.store_name} ${r.trainer_name} ${r.start_local.slice(0, 5)}-${r.end_local.slice(0, 5)}`);
  }
  const lines = [];
  for (let day = 1; day <= 30; day++) {
    const date = ymd(day);
    const label = wd[weekday(date)];
    const items = (by.get(date) ?? ["休み"]).join(" / ");
    lines.push(`${date}(${label}) ${items}`);
  }
  return lines;
}

async function countNovemberReservations(supabase, storeIds, fetchAllChecked) {
  const { count, fetched } = await fetchAllChecked(
    supabase,
    "reservations",
    "id",
    (q) =>
      q
        .in("store_id", storeIds)
        .gte("start_at", MONTH_START_ISO)
        .lt("start_at", NEXT_MONTH_START)
        .neq("status", "cancelled"),
    "reservations.2026-11.tokyo",
  );
  return { count, fetched };
}

async function main() {
  const apply = process.argv.includes("--apply");
  const dryRun = !apply || process.argv.includes("--dry-run");
  const rows = rowsFromShifts();
  validate(rows);
  const slots = countSlots(rows);
  const pay = estimatePayroll(rows);
  if (slots.total !== EXPECT_SLOTS) throw new Error(`公開枠が${EXPECT_SLOTS}ではありません: ${slots.total}`);
  if ((slots.per["恵比寿"] ?? 0) > 172) throw new Error(`恵比寿が172枠を超えています: ${slots.per["恵比寿"]}`);
  if (pay.total !== EXPECT_PAY_YEN) throw new Error(`人件費見積がずれています: ${pay.total}`);
  if (pay.total > LABOR_CAP_YEN) throw new Error(`人件費が35%を超えています: ${pay.total}`);
  if (pay.trainers["たけはる"].hours < 171 || pay.trainers["たけはる"].hours > 176) {
    throw new Error(`たけはるが171時間以上176時間以下ではありません: ${pay.trainers["たけはる"].hours}`);
  }
  if (pay.trainers["ゆうと"].hours !== 148) throw new Error(`ゆうとが148時間ではありません: ${pay.trainers["ゆうと"].hours}`);
  if (pay.money["りょう"] !== 329_400) throw new Error(`りょうの人件費が329400ではありません: ${pay.money["りょう"]}`);

  const summary = {
    month: MONTH,
    willApply: !dryRun,
    stores: STORE_NAMES,
    fukuoka: "変更なし",
    slots: slots.total,
    slotsByStore: slots.per,
    payrollYen: pay.total,
    payrollPct: pay.pct,
    payrollCapYen: LABOR_CAP_YEN,
    revenueYen: REVENUE_YEN,
    trainers: pay.trainers,
    money: pay.money,
    assumptions: {
      ゆうと: "固定260000+定期13120",
      たけはる: "固定260000+定期15388（6ヶ月92330の月割）",
      りょう: "時給1500+分割ボーナス+新宿往復900円/日",
      ひろむ: "時給1500+分割ボーナス+定期18030。上野交通費0",
      せいや: "時給1400+分割ボーナス+上野交通費880/日",
      note: "時給・定期・交通費は2026年8月の給与集計。上野20:00–21:00はシフト内だが予約不可。",
    },
    rowCount: rows.length,
    calendar: calendar(rows),
  };
  console.log(JSON.stringify(summary, null, 2));
  if (dryRun) return;

  const { createClient } = await import("@supabase/supabase-js");
  const { fetchAllChecked } = await import("./lib/supabaseFetchAll.mjs");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY が未設定です。");
  const supabase = createClient(url, key, { auth: { persistSession: false } });

  const storesResult = await fetchAllChecked(supabase, "stores", "id, name", (q) => q.in("name", STORE_NAMES), "stores.tokyo");
  const storeIdByName = new Map(storesResult.rows.map((s) => [s.name, s.id]));
  for (const name of STORE_NAMES) {
    if (!storeIdByName.get(name)) throw new Error(`店舗がありません: ${name}`);
  }
  const storeIds = STORE_NAMES.map((name) => storeIdByName.get(name));

  const reservations = await countNovemberReservations(supabase, storeIds, fetchAllChecked);
  if (reservations.count !== 0) {
    throw new Error(`11月の東京4店舗に予約が${reservations.count}件あります。--apply を中止しました。`);
  }

  const trainerNames = [...new Set(rows.map((r) => r.trainer_name))];
  const trainersResult = await fetchAllChecked(
    supabase,
    "trainers",
    "id, display_name",
    (q) => q.in("display_name", trainerNames),
    "trainers.nov",
  );
  const trainerIdByName = new Map(trainersResult.rows.map((t) => [t.display_name, t.id]));
  for (const name of trainerNames) {
    if (!trainerIdByName.get(name)) throw new Error(`トレーナーがありません: ${name}`);
  }

  const existing = await fetchAllChecked(
    supabase,
    "trainer_shifts",
    "id",
    (q) => q.in("store_id", storeIds).gte("shift_date", MONTH_START).lte("shift_date", MONTH_END),
    "trainer_shifts.2026-11.tokyo",
  );

  const payload = rows.map((r) => ({
    trainer_id: trainerIdByName.get(r.trainer_name),
    store_id: storeIdByName.get(r.store_name),
    shift_date: r.shift_date,
    start_local: r.start_local,
    end_local: r.end_local,
    break_minutes: r.break_minutes,
    status: "confirmed",
    is_break: false,
  }));

  const ids = existing.rows.map((r) => r.id);
  for (let i = 0; i < ids.length; i += 200) {
    const { error } = await supabase.from("trainer_shifts").delete().in("id", ids.slice(i, i + 200));
    if (error) throw error;
  }

  const inserted = [];
  for (let i = 0; i < payload.length; i += 200) {
    const { data, error } = await supabase
      .from("trainer_shifts")
      .insert(payload.slice(i, i + 200))
      .select("id, store_id, start_local, end_local");
    if (error) throw error;
    inserted.push(...(data ?? []));
  }

  const uenoId = storeIdByName.get("上野");
  const breakRows = inserted
    .filter((r) => r.store_id === uenoId && mins(r.start_local) <= 20 * 60 && mins(r.end_local) >= 21 * 60)
    .map((r) => ({ shift_id: r.id, start_time: "20:00:00", end_time: "21:00:00" }));
  for (let i = 0; i < breakRows.length; i += 200) {
    const { error } = await supabase.from("trainer_shift_breaks").insert(breakRows.slice(i, i + 200));
    if (error) throw error;
  }

  console.log(JSON.stringify({
    applied: true,
    deleted: ids.length,
    inserted: inserted.length,
    uenoBreaks: breakRows.length,
    novemberReservations: reservations.count,
  }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
