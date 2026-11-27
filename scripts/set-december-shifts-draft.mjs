import path from "node:path";
import { pathToFileURL } from "node:url";

/**
 * 東京4店舗の12月シフトを下書きに戻す。行は消さない。
 * 会員画面は下書きを出さない。先行公開のコードが本番にあるときだけ、低利用者が見える。
 *
 *   node --env-file=.env.local scripts/set-december-shifts-draft.mjs
 */
const STORE_NAMES = ["恵比寿", "上野", "新宿", "桜木町"];
const MONTH_START = "2026-12-01";
const MONTH_END = "2026-12-31";
const MONTH_START_ISO = "2026-12-01T00:00:00+09:00";
const NEXT_MONTH_START = "2027-01-01T00:00:00+09:00";

async function main() {
  const { createClient } = await import("@supabase/supabase-js");
  const { fetchAllChecked } = await import("./lib/supabaseFetchAll.mjs");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY が未設定です。");
  const supabase = createClient(url, key, { auth: { persistSession: false } });

  const stores = await fetchAllChecked(supabase, "stores", "id, name", (q) => q.in("name", STORE_NAMES), "stores.tokyo");
  const storeIds = stores.rows.map((s) => s.id);
  if (storeIds.length !== STORE_NAMES.length) throw new Error(`店舗が揃っていません: ${stores.rows.map((s) => s.name).join(",")}`);

  const shifts = await fetchAllChecked(
    supabase,
    "trainer_shifts",
    "id, status",
    (q) => q.in("store_id", storeIds).gte("shift_date", MONTH_START).lte("shift_date", MONTH_END),
    "shifts.2026-12",
  );
  const confirmedIds = shifts.rows.filter((r) => r.status === "confirmed").map((r) => r.id);
  for (let i = 0; i < confirmedIds.length; i += 200) {
    const { error } = await supabase.from("trainer_shifts").update({ status: "draft" }).in("id", confirmedIds.slice(i, i + 200));
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

  const reservations = await fetchAllChecked(
    supabase,
    "reservations",
    "id, store_id, member_id, start_at, end_at, status, guest_name",
    (q) => q.in("store_id", storeIds).gte("start_at", MONTH_START_ISO).lt("start_at", NEXT_MONTH_START).neq("status", "cancelled"),
    "reservations.2026-12",
  );
  const memberIds = [...new Set(reservations.rows.map((r) => r.member_id).filter(Boolean))];
  const members = memberIds.length
    ? await fetchAllChecked(supabase, "members", "id, name, display_name", (q) => q.in("id", memberIds), "members.december")
    : { rows: [] };
  const storeName = new Map(stores.rows.map((s) => [s.id, s.name]));
  const memberName = new Map(members.rows.map((m) => [m.id, m.display_name || m.name || ""]));
  const listed = reservations.rows
    .map((r) => {
      const start = new Date(r.start_at);
      const end = new Date(r.end_at);
      const jst = (d) =>
        new Intl.DateTimeFormat("sv-SE", {
          timeZone: "Asia/Tokyo",
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
          hourCycle: "h23",
        }).format(d);
      return {
        date: jst(start).slice(0, 5),
        store: storeName.get(r.store_id) ?? "",
        time: `${jst(start).slice(6)}-${jst(end).slice(6)}`,
        status: r.status,
        name: memberName.get(r.member_id) || r.guest_name || "",
      };
    })
    .sort((a, b) => `${a.date}${a.time}${a.store}`.localeCompare(`${b.date}${b.time}${b.store}`));

  console.log(JSON.stringify({ updated: confirmedIds.length, byStatus, decemberReservations: reservations.count, reservations: listed }, null, 2));
}

const invokedDirectly = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (invokedDirectly) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
