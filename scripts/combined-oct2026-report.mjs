/**
 * 4店舗 dry-run 連結レポート（DB不要）
 * node scripts/combined-oct2026-report.mjs
 */
import { buildRows as buildUeno } from "./sync-ueno-shifts-2026-10.mjs";
import { buildRows as buildShinjuku, loadCrossStoreContext } from "./sync-shinjuku-shifts-2026-10.mjs";
import { buildRows as buildEbisu, loadCrossStoreBusy } from "./sync-ebisu-shifts-2026-10.mjs";
import { buildRows as buildSakura } from "./sync-sakuragicho-shifts-2026-10.mjs";

const UENO_ACTIVE = 40;
const SAKURA_ACTIVE = 35;

function toMinutes(hhmm) {
  const s = String(hhmm).slice(0, 5);
  const [hh, mm] = s.split(":").map(Number);
  return hh * 60 + mm;
}

/** セグメント実働 + 3h以上の中抜け1h加算（同日・同一トレーナー） */
function dayPaidHours(dayRows) {
  const sorted = [...dayRows].sort((a, b) => toMinutes(a.start_local) - toMinutes(b.start_local));
  let workMin = 0;
  for (const r of sorted) {
    workMin += toMinutes(r.end_local) - toMinutes(r.start_local);
    workMin -= r.break_minutes ?? 0;
  }
  for (let i = 0; i < sorted.length - 1; i++) {
    const gap = toMinutes(sorted[i + 1].start_local) - toMinutes(sorted[i].end_local);
    if (gap >= 180) workMin += 60;
  }
  return workMin / 60;
}

function trainerHoursAllStores(allRows) {
  const byTrainer = new Map();
  const byTrainerDay = new Map();
  for (const r of allRows) {
    const k = `${r.trainer_name}|${r.shift_date}`;
    if (!byTrainerDay.has(k)) byTrainerDay.set(k, []);
    byTrainerDay.get(k).push(r);
  }
  for (const [k, dayRows] of byTrainerDay) {
    const trainer = k.split("|")[0];
    const h = dayPaidHours(dayRows);
    const t = byTrainer.get(trainer) ?? { hours: 0, days: new Set() };
    t.hours += h;
    t.days.add(dayRows[0].shift_date);
    byTrainer.set(trainer, t);
  }
  return byTrainer;
}

function formatBlocks(dayRows) {
  return dayRows
    .sort((a, b) => toMinutes(a.start_local) - toMinutes(b.start_local))
    .map((r) => {
      const br = r.break_minutes ? `(休${r.break_minutes}m)` : "";
      return `${r.start_local.slice(0, 5)}-${r.end_local.slice(0, 5)}${br}`;
    })
    .join(" / ");
}

function storeCalendar(storeName, rows) {
  const byDate = new Map();
  for (const r of rows) {
    if (r.store_name !== storeName) continue;
    if (!byDate.has(r.shift_date)) byDate.set(r.shift_date, []);
    byDate.get(r.shift_date).push(r);
  }
  const lines = [];
  for (let d = 1; d <= 31; d++) {
    const date = `2026-10-${String(d).padStart(2, "0")}`;
    const dayRows = byDate.get(date);
    if (!dayRows?.length) {
      lines.push({ day: d, closed: true });
      continue;
    }
    const trainer = [...new Set(dayRows.map((r) => r.trainer_name))].join("+");
    lines.push({ day: d, trainer, blocks: formatBlocks(dayRows) });
  }
  return lines;
}

const cross = loadCrossStoreContext(UENO_ACTIVE, SAKURA_ACTIVE);
const crossEbisu = loadCrossStoreBusy(UENO_ACTIVE, SAKURA_ACTIVE);

const ueno = buildUeno(500);
const shinjuku = buildShinjuku(390, cross);
const ebisu = buildEbisu(190, crossEbisu);
const sakura = buildSakura(SAKURA_ACTIVE * 12);

const allRows = [...ueno.rows, ...shinjuku.rows, ...ebisu.rows, ...sakura.rows];
const hours = trainerHoursAllStores(allRows);

const stores = [
  { name: "上野", plan: ueno, target: 500 },
  { name: "新宿", plan: shinjuku, target: 390 },
  { name: "恵比寿", plan: ebisu, target: 190 },
  { name: "桜木町", plan: sakura, target: SAKURA_ACTIVE * 12 },
];

console.log(JSON.stringify({
  generatedAt: new Date().toISOString(),
  slots: Object.fromEntries(stores.map((s) => [s.name, { target: s.target, actual: s.plan.slots ?? countFromRows(s.plan.rows, s.name) }])),
  trainerHours: [...hours.entries()]
    .sort((a, b) => a[0].localeCompare(b[0], "ja"))
    .map(([name, v]) => ({
      name,
      workDays: v.days.size,
      paidHours: Math.round(v.hours * 10) / 10,
      laborCostYen: name === "ゆうと" || name === "たけはる" ? 265000 : Math.round(v.hours * 1500),
    })),
  calendars: Object.fromEntries(
    stores.map((s) => [s.name, storeCalendar(s.name, allRows)]),
  ),
}, null, 2));

function countFromRows(rows, storeName) {
  // reuse plan.slots when exported
  return rows.filter((r) => r.store_name === storeName).length;
}
