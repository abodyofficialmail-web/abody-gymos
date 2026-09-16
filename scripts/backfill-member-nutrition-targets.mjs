/**
 * 既存の目標ヒアリング回答から member_nutrition_targets を一括バックフィルする。
 *
 *   node scripts/backfill-member-nutrition-targets.mjs
 *   node scripts/backfill-member-nutrition-targets.mjs --dry-run
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createClient } from "@supabase/supabase-js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const dryRun = process.argv.includes("--dry-run");

const ACTIVITY_FACTOR = {
  sedentary: 1.2,
  light: 1.375,
  standing: 1.55,
  physical: 1.725,
  active: 1.725,
};

const ACTIVITY_LABEL_TO_ID = {
  ほとんど座りがち: "sedentary",
  "通勤・家事で少し動く": "light",
  "仕事でよく歩く / 立つ": "standing",
  体を使う仕事が多い: "physical",
  トレーニング以外でも運動している: "active",
};

function loadEnvLocal() {
  for (const name of [
    ".env.local.bak-before-vercel-run",
    ".env.local",
    ".env.production.local",
    ".env.vercel.production",
    ".env.prod.query",
  ]) {
    const envPath = path.join(root, name);
    if (!fs.existsSync(envPath)) continue;
    for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
      const t = line.trim();
      if (!t || t.startsWith("#") || !t.includes("=")) continue;
      const i = t.indexOf("=");
      const k = t.slice(0, i);
      let v = t.slice(i + 1).trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      if (!process.env[k]) process.env[k] = v;
    }
  }
}

function normalizeActivity(raw) {
  if (!raw) return "light";
  const t = String(raw).trim();
  if (ACTIVITY_FACTOR[t] != null) return t;
  return ACTIVITY_LABEL_TO_ID[t] ?? "light";
}

function enrichFromNote(content, fields) {
  const text = String(content ?? "");
  let birth_date = fields.birth_date ?? null;
  let age_years = fields.age_years ?? null;
  let current_weight_kg = fields.current_weight_kg ?? null;
  let weight_unknown = Boolean(fields.weight_unknown);
  let height_cm = fields.height_cm ?? null;

  if (!birth_date) {
    const m = text.match(/生年月日\s*(\d{4}-\d{2}-\d{2})/);
    if (m) birth_date = m[1];
  }
  if (age_years == null) {
    const m = text.match(/年齢情報:\s*(\d+)\s*歳/) || text.match(/年齢[：:]\s*(\d+)/);
    if (m) age_years = Number(m[1]);
  }
  if (current_weight_kg == null && !weight_unknown) {
    if (/体重:\s*今\s*不明/.test(text)) weight_unknown = true;
    else {
      const m = text.match(/体重:\s*今\s*([\d.]+)\s*kg/);
      if (m) current_weight_kg = Number(m[1]);
    }
  }
  if (height_cm == null) {
    const m = text.match(/身長:\s*([\d.]+)\s*cm/);
    if (m) height_cm = Number(m[1]);
  }
  return { birth_date, age_years, current_weight_kg, weight_unknown, height_cm };
}

function resolveAge(birth_date, age_years, asOf = new Date()) {
  if (age_years != null && Number.isFinite(Number(age_years))) return Math.round(Number(age_years));
  if (!birth_date) return null;
  const d = new Date(`${birth_date}T00:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  let age = asOf.getFullYear() - d.getFullYear();
  const m = asOf.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && asOf.getDate() < d.getDate())) age -= 1;
  return age > 0 && age < 120 ? age : null;
}

function roundKcal(n) {
  return Math.round(n / 10) * 10;
}

function resolveDirection(row) {
  const d = row.weight_direction;
  if (d === "lose" || d === "gain" || d === "maintain" || d === "looks") return d;
  if (row.current_weight_kg != null && row.target_weight_kg != null) {
    if (Number(row.target_weight_kg) < Number(row.current_weight_kg) - 0.5) return "lose";
    if (Number(row.target_weight_kg) > Number(row.current_weight_kg) + 0.5) return "gain";
  }
  if (row.primary_goal === "diet") return "lose";
  if (row.primary_goal === "muscle") return "gain";
  return "maintain";
}

function estimate(row) {
  if (row.weight_unknown || row.current_weight_kg == null || !Number.isFinite(Number(row.current_weight_kg))) {
    return null;
  }
  const age = resolveAge(row.birth_date, row.age_years);
  if (age == null) return null;
  if (!row.height_cm || (row.sex !== "male" && row.sex !== "female")) return null;

  const weight = Number(row.current_weight_kg);
  const height = Number(row.height_cm);
  const bmr =
    row.sex === "male" ? 10 * weight + 6.25 * height - 5 * age + 5 : 10 * weight + 6.25 * height - 5 * age - 161;
  const activity = normalizeActivity(row.activity_level);
  const tdee = bmr * (ACTIVITY_FACTOR[activity] ?? 1.375);
  const direction = resolveDirection(row);

  let deficitMin = 0;
  let deficitMax = 0;
  let note = "体重はほぼ横ばいの目安です。";
  if (direction === "lose") {
    deficitMin = 300;
    deficitMax = 500;
    note = "無理のない減量ペースの目安です。";
  } else if (direction === "gain") {
    deficitMin = -300;
    deficitMax = -200;
    note = "筋肉をつけやすい増量ペースの目安です。";
  } else if (direction === "looks") {
    if (row.target_weight_kg != null && Number(row.target_weight_kg) < weight - 0.5) {
      deficitMin = 250;
      deficitMax = 400;
      note = "見た目重視・ゆるやかな減量の目安です。";
    } else if (row.target_weight_kg != null && Number(row.target_weight_kg) > weight + 0.5) {
      deficitMin = -250;
      deficitMax = -150;
      note = "見た目重視・ゆるやかな増量の目安です。";
    } else {
      deficitMin = 0;
      deficitMax = 100;
      note = "見た目重視・体重はほぼ維持の目安です。";
    }
  }

  const intakeMax = roundKcal(tdee - deficitMin);
  const intakeMin = roundKcal(tdee - deficitMax);
  const intake_min = Math.min(intakeMin, intakeMax);
  const intake_max = Math.max(intakeMin, intakeMax);
  const intake_mid = roundKcal((intake_min + intake_max) / 2);
  const proteinPerKg = direction === "gain" || row.primary_goal === "muscle" ? 2.0 : direction === "lose" ? 1.8 : 1.6;
  const protein_g = Math.round(weight * proteinPerKg);
  const fat_g = Math.round((intake_mid * 0.25) / 9);
  const carb_g = Math.max(0, Math.round((intake_mid - protein_g * 4 - fat_g * 9) / 4));

  return {
    daily_expenditure_kcal: roundKcal(tdee),
    intake_kcal: intake_mid,
    intake_kcal_min: intake_min,
    intake_kcal_max: intake_max,
    protein_g,
    fat_g,
    carb_g,
    bmr_kcal: roundKcal(bmr),
    note,
  };
}

async function main() {
  loadEnvLocal();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY が必要です");

  const sb = createClient(url, key, { auth: { persistSession: false } });

  const { data: responses, error } = await sb
    .from("goal_hearing_responses")
    .select(
      "id, member_id, client_note_id, primary_goal, weight_direction, current_weight_kg, target_weight_kg, sex, birth_date, age_years, height_cm, weight_unknown, activity_level, created_at"
    )
    .order("created_at", { ascending: false });
  if (error) throw error;

  const latest = new Map();
  for (const r of responses ?? []) {
    if (!latest.has(r.member_id)) latest.set(r.member_id, r);
  }

  let ok = 0;
  let skipped = 0;
  let failed = 0;
  const skippedReasons = [];

  for (const r of latest.values()) {
    const { data: existing } = await sb
      .from("member_nutrition_targets")
      .select("member_id, source")
      .eq("member_id", r.member_id)
      .maybeSingle();
    if (existing?.source === "manual") {
      skipped++;
      continue;
    }

    let birth_date = r.birth_date;
    let age_years = r.age_years;
    let current_weight_kg = r.current_weight_kg;
    let weight_unknown = r.weight_unknown;
    let height_cm = r.height_cm;

    if (
      r.client_note_id &&
      ((age_years == null && !birth_date) ||
        ((current_weight_kg == null || !Number.isFinite(Number(current_weight_kg))) && !weight_unknown))
    ) {
      const { data: note } = await sb.from("client_notes").select("content").eq("id", r.client_note_id).maybeSingle();
      const e = enrichFromNote(note?.content, {
        birth_date,
        age_years,
        current_weight_kg,
        weight_unknown,
        height_cm,
      });
      birth_date = e.birth_date;
      age_years = e.age_years;
      current_weight_kg = e.current_weight_kg;
      weight_unknown = e.weight_unknown;
      height_cm = e.height_cm ?? height_cm;
    }

    const est = estimate({
      ...r,
      birth_date,
      age_years,
      current_weight_kg,
      weight_unknown,
      height_cm,
    });
    if (!est) {
      skipped++;
      const { data: m } = await sb.from("members").select("member_code").eq("id", r.member_id).maybeSingle();
      skippedReasons.push({
        code: m?.member_code,
        reason: weight_unknown || current_weight_kg == null ? "weight_missing" : "age_or_other",
      });
      continue;
    }

    const row = {
      member_id: r.member_id,
      ...est,
      source: "goal_hearing",
      goal_hearing_response_id: r.id,
      updated_at: new Date().toISOString(),
    };

    if (dryRun) {
      ok++;
      continue;
    }

    const { error: upErr } = await sb.from("member_nutrition_targets").upsert(row, { onConflict: "member_id" });
    if (upErr) {
      failed++;
      console.error("upsert failed", r.member_id, upErr.message);
    } else {
      ok++;
    }
  }

  console.log(
    JSON.stringify(
      {
        dryRun,
        members: latest.size,
        upserted: ok,
        skipped,
        failed,
        skippedSample: skippedReasons.slice(0, 15),
      },
      null,
      2
    )
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
