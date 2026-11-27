import path from "node:path";
import { pathToFileURL } from "node:url";

/**
 * ゆうと・たけはる・ひろむ・りょうが同時にシフト中で、休憩でも予約でもない時間を出す。
 * 予約は読まない。行は更新しない。
 *
 *   node --env-file=.env.local scripts/list-december-meeting-windows.mjs
 */
const STORE_NAMES = ["恵比寿", "上野", "新宿", "桜木町"];
const NAMES = ["ゆうと", "たけはる", "ひろむ", "りょう"];

const WINDOWS = [
  { date: "2026-12-06", start: "09:00", end: "11:00", stores: { ゆうと: "恵比寿", たけはる: "桜木町", ひろむ: "上野", りょう: "新宿" } },
  { date: "2026-12-06", start: "11:30", end: "12:30", stores: { ゆうと: "恵比寿", たけはる: "桜木町", ひろむ: "上野", りょう: "新宿" } },
  { date: "2026-12-06", start: "13:00", end: "15:00", stores: { ゆうと: "恵比寿", たけはる: "桜木町", ひろむ: "上野", りょう: "新宿" } },
  { date: "2026-12-10", start: "17:00", end: "19:00", stores: { ゆうと: "恵比寿", たけはる: "桜木町", ひろむ: "上野", りょう: "新宿" } },
  { date: "2026-12-17", start: "17:00", end: "20:00", stores: { ゆうと: "恵比寿", たけはる: "桜木町", ひろむ: "上野", りょう: "新宿" } },
  { date: "2026-12-17", start: "20:30", end: "22:00", stores: { ゆうと: "恵比寿", たけはる: "桜木町", ひろむ: "上野", りょう: "新宿" } },
  { date: "2026-12-21", start: "17:00", end: "20:00", stores: { ゆうと: "恵比寿", たけはる: "桜木町", ひろむ: "上野", りょう: "新宿" } },
  { date: "2026-12-21", start: "20:30", end: "22:00", stores: { ゆうと: "恵比寿", たけはる: "桜木町", ひろむ: "上野", りょう: "新宿" } },
  { date: "2026-12-23", start: "17:00", end: "19:00", stores: { ゆうと: "恵比寿", たけはる: "桜木町", ひろむ: "上野", りょう: "新宿" } },
  { date: "2026-12-23", start: "20:30", end: "22:00", stores: { ゆうと: "恵比寿", たけはる: "桜木町", ひろむ: "上野", りょう: "新宿" } },
  { date: "2026-12-29", start: "17:00", end: "19:00", stores: { ゆうと: "恵比寿", たけはる: "桜木町", ひろむ: "上野", りょう: "新宿" } },
  { date: "2026-12-29", start: "20:30", end: "22:00", stores: { ゆうと: "恵比寿", たけはる: "桜木町", ひろむ: "上野", りょう: "新宿" } },
];

function minsOf(hhmm) {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}
function fmt(total) {
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}
function jstParts(iso) {
  const text = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(iso));
  const [date, time] = text.split(" ");
  return { date, minutes: minsOf(time) };
}

async function main() {
  const { createClient } = await import("@supabase/supabase-js");
  const { fetchAllChecked } = await import("./lib/supabaseFetchAll.mjs");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY が未設定です。");
  const supabase = createClient(url, key, { auth: { persistSession: false } });

  const stores = await fetchAllChecked(supabase, "stores", "id, name", (q) => q.in("name", STORE_NAMES), "stores.tokyo");
  const storeName = new Map(stores.rows.map((s) => [s.id, s.name]));
  const storeIds = stores.rows.map((s) => s.id);
  const dates = [...new Set(WINDOWS.map((w) => w.date))];
  const rangeStart = `${dates[0]}T00:00:00+09:00`;
  const rangeEnd = "2026-12-30T00:00:00+09:00";
  const reservations = await fetchAllChecked(
    supabase,
    "reservations",
    "id, store_id, member_id, start_at, end_at, status, guest_name",
    (q) => q.in("store_id", storeIds).gte("start_at", rangeStart).lt("start_at", rangeEnd).neq("status", "cancelled"),
    "reservations.meeting",
  );
  const memberIds = [...new Set(reservations.rows.map((r) => r.member_id).filter(Boolean))];
  const members = memberIds.length
    ? await fetchAllChecked(supabase, "members", "id, name, display_name", (q) => q.in("id", memberIds), "members.meeting")
    : { rows: [] };
  const memberName = new Map(members.rows.map((m) => [m.id, m.display_name || m.name || ""]));

  const booked = reservations.rows.map((r) => {
    const start = jstParts(r.start_at);
    const end = jstParts(r.end_at);
    return {
      date: start.date,
      store: storeName.get(r.store_id) ?? "",
      start: start.minutes,
      end: end.minutes,
      status: r.status,
      name: memberName.get(r.member_id) || r.guest_name || "",
    };
  });

  const result = WINDOWS.map((window) => {
    const from = minsOf(window.start);
    const to = minsOf(window.end);
    const hits = booked.filter((r) => r.date === window.date && r.start < to && r.end > from && Object.values(window.stores).includes(r.store));
    const blocked = Array.from({ length: to - from }, () => false);
    for (const hit of hits) {
      const a = Math.max(from, hit.start);
      const b = Math.min(to, hit.end);
      for (let t = a; t < b; t++) blocked[t - from] = true;
    }
    const open = [];
    let cursor = null;
    for (let t = from; t <= to; t++) {
      const free = t < to && !blocked[t - from];
      if (free && cursor === null) cursor = t;
      if (!free && cursor !== null) {
        if (t - cursor >= 60) open.push(`${fmt(cursor)}-${fmt(t)}`);
        cursor = null;
      }
    }
    return {
      date: window.date.slice(5),
      window: `${window.start}-${window.end}`,
      open,
      blockedBy: hits
        .map((r) => `${fmt(r.start)}-${fmt(r.end)} ${r.store} ${r.name}`)
        .sort(),
    };
  });

  console.log(JSON.stringify(result, null, 2));
}

const invokedDirectly = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (invokedDirectly) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
