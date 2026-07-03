import { createClient } from "@supabase/supabase-js";

/**
 * 2026-07 せいや・こうへいの休憩を trainer_shift_breaks に一括登録します。
 *
 * ルール:
 * - シフト単体 ≤4h: 休憩なし
 * - シフト単体 5–6h: 30分
 * - シフト単体 7–8h: 60分
 * - 同日合計 ≥8h: その日は合計60分（シフト単体ルールより優先）
 * - 60分は30分×2などに分割し、予約が入りにくい時間帯へ配置
 *
 * 使い方:
 *   node --env-file=.env.local scripts/sync-trainer-breaks-2026-07.mjs --dry-run
 *   node --env-file=.env.local scripts/sync-trainer-breaks-2026-07.mjs
 */

const MONTH = "2026-07";
const MONTH_LAST_DAY = "31";
const TARGET_TRAINERS = ["せいや", "こうへい"];
const BREAK_CHUNK = 30;

function norm(s) {
  return String(s ?? "").replace(/\u3000/g, " ").trim();
}

function toMinutes(hhmmOrHhmmss) {
  const s = norm(hhmmOrHhmmss).slice(0, 5);
  const [hh, mm] = s.split(":").map(Number);
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) throw new Error(`時刻形式が不正です: ${hhmmOrHhmmss}`);
  return hh * 60 + mm;
}

function toHHMM(m) {
  const hh = Math.floor(m / 60);
  const mm = m % 60;
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

function shiftHours(startLocal, endLocal) {
  return (toMinutes(endLocal) - toMinutes(startLocal)) / 60;
}

/** 予約が入りにくい時間帯ほどスコアが高い（30分スロットの開始分） */
function lowDemandScore(slotStartMin) {
  const h = Math.floor(slotStartMin / 60);
  const m = slotStartMin % 60;
  const t = h + m / 60;

  if (t >= 10 && t < 11) return 90;
  if (t >= 11 && t < 12) return 75;
  if (t >= 12 && t < 13) return 70;
  if (t >= 13 && t < 14) return 40;
  if (t >= 14 && t < 15.5) return 95;
  if (t >= 15.5 && t < 17) return 65;
  if (t >= 17 && t < 18) return 45;
  if (t >= 18 && t < 19) return 35;
  if (t >= 19 && t < 20) return 30;
  if (t >= 20 && t < 20.5) return 80;
  if (t >= 20.5 && t < 21.5) return 85;
  if (t >= 21.5) return 75;
  if (t >= 9 && t < 10) return 85;
  return 50;
}

function breakMinutesForShiftHours(hours) {
  if (hours <= 4) return 0;
  if (hours <= 6) return 30;
  if (hours <= 8) return 60;
  return 60;
}

function computeDayBreakMinutes(shifts) {
  const totalHours = shifts.reduce((sum, s) => sum + shiftHours(s.start_local, s.end_local), 0);
  if (totalHours >= 8) return 60;
  return shifts.reduce((sum, s) => sum + breakMinutesForShiftHours(shiftHours(s.start_local, s.end_local)), 0);
}

function chunkBreakMinutes(total) {
  const chunks = [];
  let left = total;
  while (left >= BREAK_CHUNK) {
    chunks.push(BREAK_CHUNK);
    left -= BREAK_CHUNK;
  }
  if (left > 0) chunks.push(left);
  return chunks;
}

function candidateSlotsForShift(shift) {
  const start = toMinutes(shift.start_local);
  const end = toMinutes(shift.end_local);
  const slots = [];
  for (let m = start; m + BREAK_CHUNK <= end; m += BREAK_CHUNK) {
    slots.push({ shift, startMin: m, endMin: m + BREAK_CHUNK });
  }
  return slots;
}

function pickBreakSlots(shifts, totalBreakMinutes) {
  const chunks = chunkBreakMinutes(totalBreakMinutes);
  if (chunks.length === 0) return [];

  const allCandidates = shifts.flatMap((s) => candidateSlotsForShift(s));
  const picked = [];
  const usedStarts = [];

  for (const chunk of chunks) {
    const duration = chunk;
    let best = null;
    let bestScore = -Infinity;

    for (const c of allCandidates) {
      if (c.endMin - c.startMin < duration) continue;
      const endMin = c.startMin + duration;

      const overlapsPicked = picked.some(
        (p) => p.shift.id === c.shift.id && c.startMin < p.endMin && endMin > p.startMin
      );
      if (overlapsPicked) continue;

      let score = lowDemandScore(c.startMin);
      if (duration === 30) score += 5;

      const minDist = usedStarts.length
        ? Math.min(...usedStarts.map((s) => Math.abs(s - c.startMin)))
        : 999;
      score += Math.min(minDist, 180) / 6;

      const shiftMid = (toMinutes(c.shift.start_local) + toMinutes(c.shift.end_local)) / 2;
      score += 10 - Math.abs(c.startMin - shiftMid) / 30;

      if (score > bestScore) {
        bestScore = score;
        best = { shift: c.shift, startMin: c.startMin, endMin };
      }
    }

    if (!best) throw new Error(`休憩枠を配置できません: ${shifts[0]?.shift_date} total=${totalBreakMinutes}`);
    picked.push(best);
    usedStarts.push(best.startMin);
  }

  return picked;
}

function groupByTrainerDay(shifts) {
  const map = new Map();
  for (const s of shifts) {
    const trainerName = s.trainer?.display_name ?? s.trainer_name;
    const key = `${trainerName}|${s.shift_date}`;
    const list = map.get(key) ?? [];
    list.push(s);
    map.set(key, list);
  }
  return map;
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY が未設定です。");

  const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

  const { data: trainers, error: trainersErr } = await supabase
    .from("trainers")
    .select("id,display_name")
    .in("display_name", TARGET_TRAINERS);
  if (trainersErr) throw trainersErr;

  const trainerIdByName = new Map((trainers ?? []).map((t) => [t.display_name, t.id]));
  for (const name of TARGET_TRAINERS) {
    if (!trainerIdByName.has(name)) throw new Error(`トレーナーが見つかりません: ${name}`);
  }

  const trainerIds = TARGET_TRAINERS.map((n) => trainerIdByName.get(n));

  const { data: shifts, error: shiftsErr } = await supabase
    .from("trainer_shifts")
    .select("id, trainer_id, store_id, shift_date, start_local, end_local, break_minutes, is_break, status, trainer:trainers(display_name)")
    .in("trainer_id", trainerIds)
    .gte("shift_date", `${MONTH}-01`)
    .lte("shift_date", `${MONTH}-${MONTH_LAST_DAY}`)
    .eq("is_break", false)
    .neq("status", "draft")
    .order("shift_date")
    .order("start_local");
  if (shiftsErr) throw shiftsErr;

  const grouped = groupByTrainerDay(shifts ?? []);
  const plan = [];

  for (const [key, dayShifts] of grouped) {
    const sorted = dayShifts.slice().sort((a, b) => a.start_local.localeCompare(b.start_local));
    const totalBreak = computeDayBreakMinutes(sorted);
    const slots = pickBreakSlots(sorted, totalBreak);

    const breakByShiftId = new Map();
    for (const slot of slots) {
      const arr = breakByShiftId.get(slot.shift.id) ?? [];
      arr.push({ start_time: toHHMM(slot.startMin), end_time: toHHMM(slot.endMin) });
      breakByShiftId.set(slot.shift.id, arr);
    }

    for (const s of sorted) {
      const breaks = breakByShiftId.get(s.id) ?? [];
      const breakMinutes = breaks.reduce((sum, b) => sum + (toMinutes(b.end_time) - toMinutes(b.start_time)), 0);
      plan.push({
        key,
        shift_id: s.id,
        shift_date: s.shift_date,
        trainer_name: s.trainer?.display_name,
        start_local: s.start_local.slice(0, 5),
        end_local: s.end_local.slice(0, 5),
        shift_hours: shiftHours(s.start_local, s.end_local),
        break_minutes: breakMinutes,
        breaks,
      });
    }
  }

  plan.sort((a, b) => {
    const d = a.shift_date.localeCompare(b.shift_date);
    if (d !== 0) return d;
    return a.trainer_name.localeCompare(b.trainer_name);
  });

  const summary = {
    trainers: TARGET_TRAINERS,
    month: MONTH,
    shiftRows: plan.length,
    rowsWithBreaks: plan.filter((p) => p.break_minutes > 0).length,
    totalBreakMinutes: plan.reduce((s, p) => s + p.break_minutes, 0),
  };

  console.log("break plan", summary);
  for (const p of plan) {
    if (p.break_minutes === 0) continue;
    const br = p.breaks.map((b) => `${b.start_time}-${b.end_time}`).join(", ");
    console.log(
      `${p.shift_date} ${p.trainer_name} ${p.start_local}-${p.end_local} (${p.shift_hours}h) → ${p.break_minutes}分 [${br}]`
    );
  }

  if (dryRun) {
    console.log("dry run complete (DB未更新)");
    return;
  }

  const shiftIds = plan.map((p) => p.shift_id);
  if (shiftIds.length > 0) {
    const { error: delErr } = await supabase.from("trainer_shift_breaks").delete().in("shift_id", shiftIds);
    if (delErr) throw delErr;
  }

  const breakRows = [];
  for (const p of plan) {
    for (const b of p.breaks) {
      breakRows.push({
        shift_id: p.shift_id,
        start_time: `${b.start_time}:00`,
        end_time: `${b.end_time}:00`,
      });
    }
  }

  const chunk = 200;
  let insertedBreaks = 0;
  for (let i = 0; i < breakRows.length; i += chunk) {
    const part = breakRows.slice(i, i + chunk);
    const { error } = await supabase.from("trainer_shift_breaks").insert(part);
    if (error) throw error;
    insertedBreaks += part.length;
  }

  let updatedShifts = 0;
  for (const p of plan) {
    const { error } = await supabase
      .from("trainer_shifts")
      .update({ break_minutes: p.break_minutes, updated_at: new Date().toISOString() })
      .eq("id", p.shift_id);
    if (error) throw error;
    updatedShifts += 1;
  }

  console.log("sync trainer breaks done", { insertedBreaks, updatedShifts, ...summary });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
