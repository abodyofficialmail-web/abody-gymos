/**
 * 月間枠数比較（8月実績 vs 9月計画 vs 目標）
 * node --env-file=.env.local scripts/compare-monthly-slots.mjs
 * node scripts/compare-monthly-slots.mjs --sep-only  # DB不要・9月のみ
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";

const SINGLE_BOOTH = new Set(["恵比寿", "新宿"]);
const TARGET = { 恵比寿: 276, 上野: 504, 新宿: 300, 桜木町: 384 };
const STORES = ["恵比寿", "上野", "新宿", "桜木町"];

function toMinutes(hhmm) {
  const [hh, mm] = String(hhmm).slice(0, 5).split(":").map(Number);
  return hh * 60 + mm;
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
    byStore.set(store, (byStore.get(store) ?? 0) + daySlots);
  }
  return byStore;
}

function pct(n, d) {
  if (!d) return null;
  return Math.round((n / d) * 1000) / 10;
}

function fmtPct(v) {
  if (v == null) return "—";
  return `${v}%`;
}

async function loadSepPlan() {
  const src = readFileSync(new URL("./sync-final-shifts-2026-09.mjs", import.meta.url), "utf8");
  const chunk = src.replace(/^import.*\n/m, "").replace(/async function main[\s\S]*$/, "");
  const mod = await import(
    `data:text/javascript,${encodeURIComponent(chunk + "\nexport { buildRows };")}`
  );
  return effectiveStoreSlots(mod.buildRows());
}

async function loadMonthFromDb(month) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;

  const supabase = createClient(url, key, { auth: { persistSession: false } });
  const lastDay = month === "2026-02" ? "28" : "30"; // rough; Sep/Aug ok
  const day = month.endsWith("-02") ? "28" : month.endsWith("-01") || month.endsWith("-03") || month.endsWith("-05") || month.endsWith("-07") || month.endsWith("-08") || month.endsWith("-10") || month.endsWith("-12") ? "31" : "30";
  const endDay = month === "2026-08" ? "31" : month === "2026-09" ? "30" : day;

  const { data: storeRows } = await supabase.from("stores").select("id,name").in("name", STORES);
  const storeNameById = new Map((storeRows ?? []).map((s) => [s.id, s.name]));

  const { data: shifts, error } = await supabase
    .from("trainer_shifts")
    .select("shift_date,start_local,end_local,store_id,status,is_break")
    .gte("shift_date", `${month}-01`)
    .lte("shift_date", `${month}-${endDay}`)
    .neq("status", "draft")
    .eq("is_break", false);

  if (error) throw error;

  const rows = (shifts ?? [])
    .map((s) => ({
      shift_date: s.shift_date,
      start_local: s.start_local,
      end_local: s.end_local,
      store_name: storeNameById.get(s.store_id),
    }))
    .filter((r) => r.store_name && STORES.includes(r.store_name));

  return effectiveStoreSlots(rows);
}

function printTable(aug, sep) {
  const total = { aug: 0, sep: 0, target: 0 };
  console.log("| 店舗 | 8月実績 | 9月計画 | 目標 | 9月/目標 | 9月/8月 |");
  console.log("|------|--------:|--------:|-----:|---------:|--------:|");
  for (const store of STORES) {
    const a = aug?.get(store) ?? null;
    const s = sep.get(store) ?? 0;
    const t = TARGET[store];
    total.aug += a ?? 0;
    total.sep += s;
    total.target += t;
    const vsTarget = fmtPct(pct(s, t));
    const vsAug = a != null && a > 0 ? fmtPct(pct(s, a)) : "—";
    console.log(`| ${store} | ${a ?? "—"} | ${s} | ${t} | ${vsTarget} | ${vsAug} |`);
  }
  console.log(`| **合計** | **${aug ? total.aug : "—"}** | **${total.sep}** | **${total.target}** | **${fmtPct(pct(total.sep, total.target))}** | **${aug && total.aug ? fmtPct(pct(total.sep, total.aug)) : "—"}** |`);
}

const sepOnly = process.argv.includes("--sep-only");
const sep = await loadSepPlan();

if (sepOnly) {
  console.log(JSON.stringify({
    sep: Object.fromEntries(sep),
    target: TARGET,
    vsTarget: Object.fromEntries(STORES.map((s) => [s, pct(sep.get(s), TARGET[s])])),
  }, null, 2));
  process.exit(0);
}

const aug = await loadMonthFromDb("2026-08");
if (!aug) {
  console.error("DB未接続のため8月実績は取得できません。--sep-only で9月のみ表示します。");
  printTable(null, sep);
  process.exit(0);
}

printTable(aug, sep);
