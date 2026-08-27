/** たけはる 9月 公開シフト（status != draft）一覧 */
import { createClient } from "@supabase/supabase-js";

const MONTH = "2026-09";
const DOW = ["日", "月", "火", "水", "木", "金", "土"];

function fmtDate(date) {
  return `9/${date.slice(8).replace(/^0/, "")}`;
}

function dow(date) {
  return DOW[new Date(`${date}T00:00:00+09:00`).getDay()];
}

function fmtTime(t) {
  return String(t ?? "").slice(0, 5);
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase env missing");

  const supabase = createClient(url, key, { auth: { persistSession: false } });
  const { data: trainer } = await supabase
    .from("trainers")
    .select("id, display_name")
    .eq("display_name", "たけはる")
    .maybeSingle();
  if (!trainer) throw new Error("trainer not found");

  const { data: stores } = await supabase.from("stores").select("id, name");
  const storeName = Object.fromEntries((stores ?? []).map((s) => [s.id, s.name]));

  const { data: shifts, error } = await supabase
    .from("trainer_shifts")
    .select("shift_date, start_local, end_local, status, is_break, store_id")
    .eq("trainer_id", trainer.id)
    .gte("shift_date", `${MONTH}-01`)
    .lte("shift_date", `${MONTH}-30`)
    .eq("is_break", false)
    .neq("status", "draft")
    .order("shift_date")
    .order("start_local");
  if (error) throw error;

  const rows = (shifts ?? []).map((s) => ({
    date: s.shift_date,
    dateLabel: fmtDate(s.shift_date),
    dow: dow(s.shift_date),
    store: storeName[s.store_id] ?? "?",
    start: fmtTime(s.start_local),
    end: fmtTime(s.end_local),
    status: s.status,
  }));

  let totalMinutes = 0;
  const days = new Set();
  for (const s of shifts ?? []) {
    days.add(s.shift_date);
    const [sh, sm] = fmtTime(s.start_local).split(":").map(Number);
    const [eh, em] = fmtTime(s.end_local).split(":").map(Number);
    totalMinutes += eh * 60 + em - (sh * 60 + sm);
  }

  console.log(
    JSON.stringify(
      {
        trainer: "たけはる",
        month: MONTH,
        source: "trainer_shifts (status != draft)",
        shiftCount: rows.length,
        workDays: days.size,
        totalHours: Math.round((totalMinutes / 60) * 10) / 10,
        shifts: rows,
      },
      null,
      2,
    ),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
