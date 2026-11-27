import path from "node:path";
import { pathToFileURL } from "node:url";

/**
 * 12月の 10:00–13:00 に、11:30–12:00 の休憩がなければ足す。
 * その30分に重なる新宿の予約も出す。シフト本体は消さない。
 *
 *   node --env-file=.env.local scripts/patch-december-1013-breaks.mjs
 */
const TARGETS = [
  { date: "2026-12-07", trainer: "ゆうと", store: "新宿", keepBreak: false },
  { date: "2026-12-28", trainer: "ひろむ", store: "新宿", keepBreak: true },
  { date: "2026-12-29", trainer: "りょう", store: "新宿", keepBreak: true },
];
const BREAK_START = "11:30:00";
const BREAK_END = "12:00:00";

function jst(iso) {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(iso));
}

function minutes(hhmmss) {
  const [h, m] = String(hhmmss).slice(0, 5).split(":").map(Number);
  return h * 60 + m;
}

async function main() {
  const { createClient } = await import("@supabase/supabase-js");
  const { fetchAllChecked } = await import("./lib/supabaseFetchAll.mjs");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY が未設定です。");
  const supabase = createClient(url, key, { auth: { persistSession: false } });

  const stores = await fetchAllChecked(supabase, "stores", "id, name", (q) => q.eq("name", "新宿"), "stores.shinjuku");
  const storeId = stores.rows[0]?.id;
  if (!storeId) throw new Error("新宿がありません");
  const trainers = await fetchAllChecked(
    supabase,
    "trainers",
    "id, display_name",
    (q) => q.in("display_name", [...new Set(TARGETS.map((t) => t.trainer))]),
    "trainers.1013",
  );
  const trainerId = new Map(trainers.rows.map((t) => [t.display_name, t.id]));

  const patched = [];
  for (const target of TARGETS) {
    const trainer_id = trainerId.get(target.trainer);
    if (!trainer_id) throw new Error(`トレーナーがありません: ${target.trainer}`);
    const shifts = await fetchAllChecked(
      supabase,
      "trainer_shifts",
      "id, shift_date, start_local, end_local, break_minutes, status",
      (q) =>
        q
          .eq("store_id", storeId)
          .eq("trainer_id", trainer_id)
          .eq("shift_date", target.date)
          .eq("start_local", "10:00:00")
          .eq("end_local", "13:00:00"),
      `shift.${target.date}`,
    );
    if (shifts.rows.length !== 1) throw new Error(`${target.date} ${target.trainer} の10:00–13:00が${shifts.rows.length}件です`);
    const shift = shifts.rows[0];
    const existing = await fetchAllChecked(
      supabase,
      "trainer_shift_breaks",
      "id, start_time, end_time",
      (q) => q.eq("shift_id", shift.id),
      `breaks.${target.date}`,
    );
    const matched = existing.rows.filter((b) => minutes(b.start_time) === 11 * 60 + 30 && minutes(b.end_time) === 12 * 60);
    let inserted = false;
    let removed = false;
    if (target.keepBreak && matched.length === 0) {
      const { error } = await supabase.from("trainer_shift_breaks").insert({
        shift_id: shift.id,
        start_time: BREAK_START,
        end_time: BREAK_END,
      });
      if (error) throw error;
      inserted = true;
    }
    if (!target.keepBreak && matched.length > 0) {
      const { error } = await supabase.from("trainer_shift_breaks").delete().in("id", matched.map((b) => b.id));
      if (error) throw error;
      removed = true;
    }
    const after = await fetchAllChecked(
      supabase,
      "trainer_shift_breaks",
      "start_time, end_time",
      (q) => q.eq("shift_id", shift.id),
      `breaks-after.${target.date}`,
    );
    const breakMinutes = after.rows.reduce((sum, b) => sum + (minutes(b.end_time) - minutes(b.start_time)), 0);
    const { error: updateError } = await supabase.from("trainer_shifts").update({ break_minutes: breakMinutes }).eq("id", shift.id);
    if (updateError && !String(updateError.message).includes("break_minutes")) throw updateError;
    patched.push({
      date: target.date,
      trainer: target.trainer,
      store: target.store,
      inserted,
      removed,
      breaks: after.rows.map((b) => `${String(b.start_time).slice(0, 5)}–${String(b.end_time).slice(0, 5)}`).sort(),
      breakMinutes,
    });
  }

  const reservations = [];
  for (const target of TARGETS) {
    const start = `${target.date}T11:30:00+09:00`;
    const end = `${target.date}T12:00:00+09:00`;
    const found = await fetchAllChecked(
      supabase,
      "reservations",
      "id, status, start_at, end_at, trainer_id, member_id, guest_name",
      (q) => q.eq("store_id", storeId).lt("start_at", end).gt("end_at", start).neq("status", "cancelled"),
      `reservations.${target.date}`,
    );
    reservations.push(...found.rows.map((r) => ({ ...r, windowDate: target.date })));
  }
  const memberIds = [...new Set(reservations.map((r) => r.member_id).filter(Boolean))];
  const memberName = new Map();
  if (memberIds.length) {
    const members = await fetchAllChecked(
      supabase,
      "members",
      "id, name, display_name",
      (q) => q.in("id", memberIds),
      "members.1013",
    );
    for (const m of members.rows) memberName.set(m.id, m.name || m.display_name || "");
  }
  const trainerName = new Map(trainers.rows.map((t) => [t.id, t.display_name]));
  const reservationReport = reservations.map((r) => ({
    date: r.windowDate,
    start: jst(r.start_at),
    end: jst(r.end_at),
    status: r.status,
    trainer: trainerName.get(r.trainer_id) ?? null,
    name: r.guest_name || memberName.get(r.member_id) || null,
  }));

  console.log(JSON.stringify({ patched, reservations: reservationReport }, null, 2));
}

const invokedDirectly = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (invokedDirectly) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
