import path from "node:path";
import { pathToFileURL } from "node:url";

/**
 * 東京4店舗の12月下書きを確定にする。行は消さない。予約は更新しない。
 * 2026-11-27 18:00（日本時間）より前は何もしない。
 *
 *   node --env-file=.env.local scripts/confirm-december-shifts.mjs
 */
const STORE_NAMES = ["恵比寿", "上野", "新宿", "桜木町"];
const MONTH_START = "2026-12-01";
const MONTH_END = "2026-12-31";
const MONTH_START_ISO = "2026-12-01T00:00:00+09:00";
const NEXT_MONTH_START = "2027-01-01T00:00:00+09:00";
const PUBLIC_AT_MS = Date.parse("2026-11-27T18:00:00+09:00");

async function main() {
  if (Date.now() < PUBLIC_AT_MS) {
    console.log(JSON.stringify({ skipped: true, reason: "before 2026-11-27 18:00 JST" }));
    return;
  }
  const { createClient } = await import("@supabase/supabase-js");
  const { fetchAllChecked } = await import("./lib/supabaseFetchAll.mjs");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY が未設定です。");
  const supabase = createClient(url, key, { auth: { persistSession: false } });

  const stores = await fetchAllChecked(supabase, "stores", "id, name", (q) => q.in("name", STORE_NAMES), "stores.tokyo");
  const storeIds = stores.rows.map((s) => s.id);
  if (storeIds.length !== STORE_NAMES.length) throw new Error(`店舗が揃っていません: ${stores.rows.map((s) => s.name).join(",")}`);

  const countReservations = async (label) => {
    const reservations = await fetchAllChecked(
      supabase,
      "reservations",
      "id",
      (q) => q.in("store_id", storeIds).gte("start_at", MONTH_START_ISO).lt("start_at", NEXT_MONTH_START).neq("status", "cancelled"),
      label,
    );
    return reservations.count;
  };
  const reservationsBefore = await countReservations("reservations.2026-12.before");

  const shifts = await fetchAllChecked(
    supabase,
    "trainer_shifts",
    "id, status",
    (q) => q.in("store_id", storeIds).gte("shift_date", MONTH_START).lte("shift_date", MONTH_END),
    "shifts.2026-12",
  );
  const draftIds = shifts.rows.filter((r) => r.status === "draft").map((r) => r.id);
  for (let i = 0; i < draftIds.length; i += 200) {
    const { error } = await supabase.from("trainer_shifts").update({ status: "confirmed" }).in("id", draftIds.slice(i, i + 200));
    if (error) throw error;
  }
  const after = await fetchAllChecked(
    supabase,
    "trainer_shifts",
    "status",
    (q) => q.in("store_id", storeIds).gte("shift_date", MONTH_START).lte("shift_date", MONTH_END),
    "shifts.2026-12.after",
  );
  const byStatus = {};
  for (const row of after.rows) byStatus[row.status] = (byStatus[row.status] ?? 0) + 1;
  const reservationsAfter = await countReservations("reservations.2026-12.after");

  console.log(JSON.stringify({ updated: draftIds.length, byStatus, reservationsBefore, reservationsAfter }, null, 2));
}

const invokedDirectly = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (invokedDirectly) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
