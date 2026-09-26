/**
 * 4店舗 dry-run 連結レポート（DB不要）
 *
 * node scripts/combined-oct2026-report.mjs          → Markdown表（人向け・デフォルト）
 * node scripts/combined-oct2026-report.mjs --json   → JSON
 */
import { buildRows as buildUeno } from "./sync-ueno-shifts-2026-10.mjs";
import { buildRows as buildShinjuku, loadCrossStoreContext } from "./sync-shinjuku-shifts-2026-10.mjs";
import { buildRows as buildEbisu, loadCrossStoreBusy } from "./sync-ebisu-shifts-2026-10.mjs";
import { buildRows as buildSakura } from "./sync-sakuragicho-shifts-2026-10.mjs";

const UENO_ACTIVE = 40;
const SAKURA_ACTIVE = 35;
const DOW = ["日", "月", "火", "水", "木", "金", "土"];

function toMinutes(hhmm) {
  const s = String(hhmm).slice(0, 5);
  const [hh, mm] = s.split(":").map(Number);
  return hh * 60 + mm;
}

function parseLocalDate(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d);
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
  for (const [, dayRows] of byTrainerDay) {
    const trainer = dayRows[0].trainer_name;
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
    const dow = DOW[parseLocalDate(date).getDay()];
    if (!dayRows?.length) {
      lines.push({ day: d, dow, closed: true });
      continue;
    }
    const trainer = [...new Set(dayRows.map((r) => r.trainer_name))].join("+");
    lines.push({ day: d, dow, trainer, blocks: formatBlocks(dayRows) });
  }
  return lines;
}

function buildReportData() {
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

  return {
    generatedAt: new Date().toISOString(),
    month: "2026-10",
    slots: Object.fromEntries(
      stores.map((s) => [s.name, { target: s.target, actual: s.plan.slots }]),
    ),
    trainerHours: [...hours.entries()]
      .sort((a, b) => a[0].localeCompare(b[0], "ja"))
      .map(([name, v]) => ({
        name,
        workDays: v.days.size,
        paidHours: Math.round(v.hours * 10) / 10,
        laborCostYen: name === "ゆうと" || name === "たけはる" ? 265000 : Math.round(v.hours * 1500),
      })),
    calendars: Object.fromEntries(stores.map((s) => [s.name, storeCalendar(s.name, allRows)])),
  };
}

function escapeCell(s) {
  return String(s ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ");
}

function renderMarkdown(data) {
  const lines = [];
  lines.push(`# 2026年10月 4店舗シフト表（dry-run）`);
  lines.push("");
  lines.push(`生成: ${data.generatedAt}`);
  lines.push("");

  lines.push("## 枠数");
  lines.push("");
  lines.push("| 店舗 | 目標枠 | 実績枠 |");
  lines.push("|------|--------|--------|");
  for (const [store, v] of Object.entries(data.slots)) {
    lines.push(`| ${store} | ${v.target} | ${v.actual} |`);
  }
  lines.push("");

  lines.push("## トレーナー勤務時間（全店合算）");
  lines.push("");
  lines.push("| 名前 | 勤務日数 | 有給算定h※ | 人件費目安 |");
  lines.push("|------|----------|------------|------------|");
  for (const t of data.trainerHours) {
    lines.push(
      `| ${t.name} | ${t.workDays}日 | ${t.paidHours}h | ${t.laborCostYen.toLocaleString("ja-JP")}円 |`,
    );
  }
  lines.push("");
  lines.push("※ 実働−休憩、同日3h以上の中抜けは+1h");
  lines.push("");

  for (const store of ["上野", "新宿", "恵比寿", "桜木町"]) {
    const cal = data.calendars[store];
    const actual = data.slots[store].actual;
    lines.push(`## ${store}（${actual}枠）`);
    lines.push("");
    lines.push("| 日 | 曜 | 担当 | 時間 |");
    lines.push("|----|----|------|------|");
    for (const row of cal) {
      if (row.closed) {
        lines.push(`| ${row.day} | ${row.dow} | 休 | |`);
      } else {
        lines.push(
          `| ${row.day} | ${row.dow} | ${escapeCell(row.trainer)} | ${escapeCell(row.blocks)} |`,
        );
      }
    }
    lines.push("");
  }

  return lines.join("\n");
}

const jsonMode = process.argv.includes("--json");
const data = buildReportData();

if (jsonMode) {
  console.log(JSON.stringify(data, null, 2));
} else {
  console.log(renderMarkdown(data));
}
