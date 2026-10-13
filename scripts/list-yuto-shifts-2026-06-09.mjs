/**
 * ゆうとの 2026年6月〜9月シフト一覧
 * node scripts/list-yuto-shifts-2026-06-09.mjs
 */
import { createClient } from "@supabase/supabase-js";
import { DateTime } from "luxon";
import { fetchAllChecked } from "./lib/supabaseFetchAll.mjs";

const RANGE_START = "2026-06-01";
const RANGE_END = "2026-10-01";
const TZ = "Asia/Tokyo";
const WEEKDAYS = ["月", "火", "水", "木", "金", "土", "日"];

function hhmm(value) {
  return String(value ?? "").slice(0, 5);
}

function weekday(ymd) {
  const dt = DateTime.fromISO(ymd, { zone: TZ });
  return WEEKDAYS[dt.weekday - 1] ?? "";
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("DB未接続");
    process.exit(1);
  }

  const supabase = createClient(url, key, { auth: { persistSession: false } });
  const [trainersResult, storesResult] = await Promise.all([
    fetchAllChecked(supabase, "trainers", "id, display_name, is_active, store_id", undefined, "trainers"),
    fetchAllChecked(supabase, "stores", "id, name", undefined, "stores"),
  ]);

  const yuto = trainersResult.rows.filter((t) => String(t.display_name ?? "").trim() === "ゆうと");
  if (!yuto.length) {
    console.error("トレーナー「ゆうと」が見つかりません");
    process.exit(1);
  }

  const storeNameById = Object.fromEntries(storesResult.rows.map((s) => [s.id, s.name]));
  const trainerIds = yuto.map((t) => t.id);

  const shiftsResult = await fetchAllChecked(
    supabase,
    "trainer_shifts",
    "id, trainer_id, store_id, shift_date, start_local, end_local, break_minutes, status, is_break",
    (q) => q.in("trainer_id", trainerIds).gte("shift_date", RANGE_START).lt("shift_date", RANGE_END),
    "trainer_shifts.yuto.jun-sep",
  );

  const shiftIds = shiftsResult.rows.map((s) => s.id);
  const breaks = [];
  for (let i = 0; i < shiftIds.length; i += 100) {
    const part = shiftIds.slice(i, i + 100);
    const chunk = await fetchAllChecked(
      supabase,
      "trainer_shift_breaks",
      "id, shift_id, start_time, end_time",
      (q) => q.in("shift_id", part),
      `trainer_shift_breaks.${i}`,
    );
    breaks.push(...chunk.rows);
  }

  const breaksByShift = new Map();
  for (const b of breaks) {
    const list = breaksByShift.get(b.shift_id) ?? [];
    list.push(`${hhmm(b.start_time)}-${hhmm(b.end_time)}`);
    breaksByShift.set(b.shift_id, list);
  }

  const work = shiftsResult.rows
    .filter((s) => s.status !== "draft" && s.is_break !== true)
    .map((s) => ({
      date: s.shift_date,
      weekday: weekday(s.shift_date),
      store: storeNameById[s.store_id] ?? "—",
      start: hhmm(s.start_local),
      end: hhmm(s.end_local),
      breakMinutes: s.break_minutes ?? 0,
      breaks: (breaksByShift.get(s.id) ?? []).sort().join(", "),
      status: s.status,
    }))
    .sort((a, b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start) || a.store.localeCompare(b.store, "ja"));

  const byMonth = new Map();
  for (const row of work) {
    const month = row.date.slice(0, 7);
    const list = byMonth.get(month) ?? [];
    list.push(row);
    byMonth.set(month, list);
  }

  const generatedAt = DateTime.now().setZone(TZ).toFormat("yyyy-MM-dd HH:mm");
  console.log(
    JSON.stringify(
      {
        trainer: yuto.map((t) => ({
          id: t.id,
          displayName: t.display_name,
          isActive: t.is_active,
          homeStore: storeNameById[t.store_id] ?? null,
        })),
        period: "2026-06-01〜2026-09-30",
        generatedAt,
        shiftCount: work.length,
        fetched: shiftsResult.count,
        months: Object.fromEntries([...byMonth.entries()].map(([month, rows]) => [month, rows.length])),
        shifts: work,
      },
      null,
      2,
    ),
  );

  console.log("\n--- ゆうと 2026年6月〜9月シフト ---");
  console.log(`集計時点: ${generatedAt} JST / 勤務 ${work.length}件`);
  for (const [month, rows] of byMonth) {
    const days = new Set(rows.map((r) => r.date)).size;
    console.log(`\n## ${month}（${days}日 / ${rows.length}件）`);
    console.log("| 日付 | 曜 | 店舗 | 時間 | 休憩 |");
    console.log("|---|---|---|---|---|");
    for (const r of rows) {
      const breakText = r.breaks || (r.breakMinutes ? `${r.breakMinutes}分` : "—");
      console.log(`| ${r.date} | ${r.weekday} | ${r.store} | ${r.start}-${r.end} | ${breakText} |`);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
