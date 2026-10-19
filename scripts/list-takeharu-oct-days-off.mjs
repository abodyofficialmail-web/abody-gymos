/**
 * たけはるの2026年10月の休み（確定シフトが無い日）
 * node scripts/list-takeharu-oct-days-off.mjs
 */
import { createClient } from "@supabase/supabase-js";
import { fetchAllChecked } from "./lib/supabaseFetchAll.mjs";

const NAME = "たけはる";
const RANGE_START = "2026-10-01";
const RANGE_END = "2026-10-31";
const TZ = "Asia/Tokyo";

function dayOfWeek(ymd) {
  const [y, m, d] = ymd.split("-").map(Number);
  return ["日", "月", "火", "水", "木", "金", "土"][new Date(y, m - 1, d).getDay()];
}

function eachDate() {
  const out = [];
  const start = new Date(`${RANGE_START}T00:00:00+09:00`);
  const end = new Date(`${RANGE_END}T00:00:00+09:00`);
  for (let t = start.getTime(); t <= end.getTime(); t += 24 * 60 * 60 * 1000) {
    out.push(new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date(t)));
  }
  return out;
}

function hm(value) {
  return String(value).slice(0, 5);
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("DB未接続");
    process.exit(1);
  }
  const supabase = createClient(url, key, { auth: { persistSession: false } });

  const trainersResult = await fetchAllChecked(
    supabase,
    "trainers",
    "id, display_name, is_active",
    (q) => q.eq("display_name", NAME),
    "trainers.takeharu",
  );
  const active = trainersResult.rows.filter((t) => t.is_active);
  const chosen = active.length ? active : trainersResult.rows;
  if (!chosen.length) throw new Error("たけはるが未登録");
  if (chosen.length > 1) throw new Error(`たけはるが複数います: ${chosen.map((t) => t.id).join(", ")}`);
  const trainer = chosen[0];

  const shiftsResult = await fetchAllChecked(
    supabase,
    "trainer_shifts",
    "id, shift_date, start_local, end_local, status, is_break, store_id",
    (q) => q.eq("trainer_id", trainer.id).gte("shift_date", RANGE_START).lte("shift_date", RANGE_END),
    "trainer_shifts.takeharu.oct",
  );
  const storeIds = [...new Set(shiftsResult.rows.map((s) => s.store_id).filter(Boolean))];
  const storesResult = storeIds.length
    ? await fetchAllChecked(supabase, "stores", "id, name", (q) => q.in("id", storeIds), "stores.takeharu.oct")
    : { rows: [] };
  const storeName = Object.fromEntries(storesResult.rows.map((s) => [s.id, s.name]));

  const byDate = new Map();
  for (const s of shiftsResult.rows) {
    const list = byDate.get(s.shift_date) ?? [];
    list.push(s);
    byDate.set(s.shift_date, list);
  }

  const off = [];
  const work = [];
  for (const ymd of eachDate()) {
    const rows = byDate.get(ymd) ?? [];
    const confirmed = rows.filter((s) => s.status !== "draft" && s.is_break === false);
    const label = `${ymd} (${dayOfWeek(ymd)})`;
    if (!confirmed.length) {
      off.push({
        date: label,
        drafts: rows.filter((s) => s.status === "draft").length,
        breakShifts: rows.filter((s) => s.is_break === true).length,
      });
      continue;
    }
    work.push({
      date: label,
      shifts: confirmed
        .sort((a, b) => String(a.start_local).localeCompare(String(b.start_local)))
        .map((s) => `${storeName[s.store_id] ?? ""} ${hm(s.start_local)}-${hm(s.end_local)}`.trim()),
    });
  }

  console.log(
    JSON.stringify(
      {
        trainer: { name: NAME, id: trainer.id, active: trainer.is_active },
        month: "2026-10",
        offCount: off.length,
        off,
        workCount: work.length,
        work,
      },
      null,
      2,
    ),
  );

  console.log("\n--- たけはる 2026年10月の休み ---");
  if (!off.length) console.log("休みなし");
  for (const day of off) console.log(`- ${day.date}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
