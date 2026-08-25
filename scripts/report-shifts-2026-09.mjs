import { readFileSync } from "fs";

const src = readFileSync(new URL("./sync-final-shifts-2026-09.mjs", import.meta.url), "utf8");
const chunk = src
  .replace(/^import.*\n/m, "")
  .replace(/async function main[\s\S]*$/, "");
const mod = await import(
  `data:text/javascript,${encodeURIComponent(chunk + "\nexport { buildRows, toMinutes, SINGLE_BOOTH, MEMBER_SLOT_NEED };")}`
);

const { buildRows, toMinutes, SINGLE_BOOTH, MEMBER_SLOT_NEED } = mod;
const DOW = ["日", "月", "火", "水", "木", "金", "土"];
const fmtDate = (d) => `9/${d.slice(8).replace(/^0/, "")}`;
const dow = (date) => DOW[new Date(`${date}T00:00:00`).getDay()];

const SLOT_START = 540; // 09:00
const SLOT_END = 1320; // 22:00

function minutesToHHMM(m) {
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/** 30分刻みでカバー状況をマージし、実際の営業時間帯を返す */
function effectiveHours(dayRows) {
  const ranges = [];
  let rangeStart = null;
  for (let t = SLOT_START; t < SLOT_END; t += 30) {
    const covered = dayRows.some((r) => {
      const s = toMinutes(r.start_local);
      const e = toMinutes(r.end_local);
      return s <= t && t + 30 <= e;
    });
    if (covered && rangeStart === null) rangeStart = t;
    if (!covered && rangeStart !== null) {
      ranges.push(`${minutesToHHMM(rangeStart)}–${minutesToHHMM(t)}`);
      rangeStart = null;
    }
  }
  if (rangeStart !== null) ranges.push(`${minutesToHHMM(rangeStart)}–${minutesToHHMM(SLOT_END)}`);
  return ranges.join(" / ");
}

function slotsForDay(store, dayRows) {
  let daySlots = 0;
  for (let t = SLOT_START; t < SLOT_END; t += 30) {
    let cap = 0;
    for (const r of dayRows) {
      const s = toMinutes(r.start_local);
      const e = toMinutes(r.end_local);
      if (s <= t && t + 30 <= e) cap++;
    }
    if (SINGLE_BOOTH.has(store)) cap = cap > 0 ? 1 : 0;
    daySlots += cap;
  }
  return daySlots;
}

/** 複数ブース店舗用: トレーナー別の時間帯 */
function describeMultiBoothDay(dayRows) {
  const byTrainer = new Map();
  for (const r of dayRows) {
    const t = `${r.start_local.slice(0, 5)}–${r.end_local.slice(0, 5)}`;
    if (!byTrainer.has(r.trainer_name)) byTrainer.set(r.trainer_name, []);
    byTrainer.get(r.trainer_name).push(t);
  }
  const trainers = [...byTrainer.entries()]
    .map(([name, times]) => `${name}(${[...new Set(times)].join(",")})`)
    .join(" / ");
  const hours = [...new Set(dayRows.map((r) => `${r.start_local.slice(0, 5)}–${r.end_local.slice(0, 5)}`))]
    .sort()
    .join(" / ");
  return { hours, trainers };
}

const rows = buildRows();
const stores = ["恵比寿", "上野", "新宿", "桜木町"];
const report = {};
const pretty = process.argv.includes("--pretty");
const storeFilter = process.argv.find((a) => a.startsWith("--store="))?.slice(8);

for (const store of stores) {
  if (storeFilter && store !== storeFilter) continue;
  const byDate = new Map();
  for (const r of rows.filter((x) => x.store_name === store)) {
    if (!byDate.has(r.shift_date)) byDate.set(r.shift_date, []);
    byDate.get(r.shift_date).push(r);
  }
  let totalSlots = 0;
  const days = [];
  const singleBooth = SINGLE_BOOTH.has(store);
  for (const date of [...byDate.keys()].sort()) {
    const dayRows = byDate.get(date);
    const slots = slotsForDay(store, dayRows);
    totalSlots += slots;
    if (singleBooth) {
      days.push({
        date: fmtDate(date),
        dow: dow(date),
        hours: effectiveHours(dayRows),
        slots,
      });
    } else {
      const { hours, trainers } = describeMultiBoothDay(dayRows);
      days.push({ date: fmtDate(date), dow: dow(date), hours, slots, trainers });
    }
  }
  report[store] = {
    totalSlots,
    need: MEMBER_SLOT_NEED[store],
    openDays: days.length,
    singleBooth,
    days,
  };
}

if (pretty) {
  for (const [store, data] of Object.entries(report)) {
    console.log(`\n## ${store}（${data.openDays}営業日 / ${data.totalSlots}枠 / 目標${data.need}）`);
    if (data.singleBooth) console.log("※ 単一ブース — 営業時間のみ表示");
    console.log("| 日 | 曜 | 営業時間 | 枠 |");
    console.log("|----|-----|----------|-----|");
    for (const d of data.days) {
      console.log(`| ${d.date} | ${d.dow} | ${d.hours} | ${d.slots} |`);
    }
  }
} else {
  console.log(JSON.stringify(report, null, 2));
}
