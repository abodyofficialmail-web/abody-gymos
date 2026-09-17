import { DateTime } from "luxon";
import type { SupabaseClient } from "@supabase/supabase-js";
import { MEMBER_BODY_PHOTO_BUCKET } from "@/lib/memberBodyPhotos";
import type { MemberNutritionTargetView } from "@/lib/memberNutritionTargets";

export const MEAL_LOG_TZ = "Asia/Tokyo";
export const MEAL_LOG_HISTORY_DAYS = 30;
export const MEAL_SLOTS = ["breakfast", "lunch", "dinner", "snack"] as const;
export type MealSlot = (typeof MEAL_SLOTS)[number];
export const MEAL_SLOT_LABELS: Record<MealSlot, string> = {
  breakfast: "朝",
  lunch: "昼",
  dinner: "夜",
  snack: "間食",
};

export const MEAL_SERVINGS = ["small", "regular", "large"] as const;
export type MealServing = (typeof MEAL_SERVINGS)[number];
export const MEAL_SERVING_LABELS: Record<MealServing, string> = {
  small: "小盛り",
  regular: "並盛り",
  large: "大盛り",
};

export const MEAL_COUNT_UNITS = ["個", "本", "枚", "杯", "切れ", "袋"] as const;
export type MealCountUnit = (typeof MEAL_COUNT_UNITS)[number];
export const MAX_MEAL_PHOTOS = 4;

export type MealDishInput = {
  menu: string;
  grams: number | null;
  count: number | null;
  count_unit: MealCountUnit | null;
  serving: MealServing | null;
};

export function isMealServing(value: unknown): value is MealServing {
  return typeof value === "string" && (MEAL_SERVINGS as readonly string[]).includes(value);
}

export function isMealCountUnit(value: unknown): value is MealCountUnit {
  return typeof value === "string" && (MEAL_COUNT_UNITS as readonly string[]).includes(value);
}

export function formatMealDishesNote(params: { eatenTime?: string | null; dishes: MealDishInput[] }): string | null {
  const dishes = params.dishes
    .map((d) => {
      const menu = d.menu.trim();
      if (!menu) return "";
      const bits = [menu];
      if (d.grams != null) bits.push(`${d.grams}g`);
      if (d.count != null) bits.push(`${d.count}${d.count_unit ?? "個"}`);
      if (d.serving) bits.push(MEAL_SERVING_LABELS[d.serving]);
      return bits.join(" ");
    })
    .filter(Boolean);
  const time = params.eatenTime?.trim() || "";
  if (!time && dishes.length === 0) return null;
  return [time ? `${time}に食事` : "", ...dishes].filter(Boolean).join(" / ");
}

export type BowelQuality = "normal" | "hard" | "loose" | "none";

export type MemberMealLogView = {
  id: string;
  log_date: string;
  meal_slot: MealSlot;
  photo_url: string | null;
  photo_urls: string[];
  note: string | null;
  items: string[];
  kcal: number;
  protein_g: number;
  fat_g: number;
  carb_g: number;
  alcohol_g: number | null;
  confidence: number | null;
  source: "ai" | "manual";
  created_at: string;
};

export type MemberLifestyleLogView = {
  log_date: string;
  water_ml: number | null;
  alcohol_drinks: number | null;
  bowel_count: number | null;
  bowel_quality: BowelQuality | null;
  note: string | null;
};

export type MealDayTotals = {
  kcal: number;
  protein_g: number;
  fat_g: number;
  carb_g: number;
  meal_count: number;
};

export type MealRemaining = {
  kcal: number;
  protein_g: number;
  fat_g: number;
  carb_g: number;
};

export type MealFeedback = {
  headline: string;
  tips: string[];
};

export type MealAnalysisHint = {
  last_7d_kcal_avg: number | null;
  over_target_days: number;
  alcohol_days: number;
  low_water_days: number;
  no_bowel_days: number;
  missing_meal_days: number;
  hints: string[];
};

export function tokyoTodayYmd(now = DateTime.now().setZone(MEAL_LOG_TZ)): string {
  return now.toFormat("yyyy-MM-dd");
}

export function isMealSlot(value: unknown): value is MealSlot {
  return typeof value === "string" && (MEAL_SLOTS as readonly string[]).includes(value);
}

export function defaultMealSlot(now = DateTime.now().setZone(MEAL_LOG_TZ)): MealSlot {
  if (now.hour < 11) return "breakfast";
  if (now.hour < 16) return "lunch";
  return "dinner";
}

export function isMissingMealPersonalTable(err: { code?: string; message?: string } | null | undefined): boolean {
  const c = String(err?.code ?? "");
  const m = String(err?.message ?? "");
  return (
    c === "PGRST205" ||
    m.includes("member_meal_logs") ||
    m.includes("member_lifestyle_logs") ||
    m.includes("meal_personal_reminder_dispatches") ||
    m.includes("member_meal_reminder_settings") ||
    m.includes("meal_barcode_products") ||
    m.includes("Could not find the table")
  );
}

function n1(raw: unknown): number {
  const n = Number(raw);
  return Number.isFinite(n) ? Math.round(n * 10) / 10 : 0;
}

function n0(raw: unknown): number {
  const n = Number(raw);
  return Number.isFinite(n) ? Math.round(n) : 0;
}

function itemsOf(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((x) => {
      if (typeof x === "string") return x.trim();
      if (x && typeof x === "object") {
        const o = x as Record<string, unknown>;
        return String(o.name ?? o.menu ?? "").trim();
      }
      return String(x ?? "").trim();
    })
    .filter(Boolean)
    .slice(0, 16);
}

export function decodeMealPhotoPaths(raw: unknown): string[] {
  if (raw == null) return [];
  const s = String(raw).trim();
  if (!s) return [];
  if (s.startsWith("[")) {
    try {
      const parsed = JSON.parse(s) as unknown;
      if (Array.isArray(parsed)) {
        return parsed.map((x) => String(x).trim()).filter(Boolean).slice(0, MAX_MEAL_PHOTOS);
      }
    } catch {
      return [s];
    }
  }
  return [s];
}

export function encodeMealPhotoPaths(paths: string[]): string | null {
  const clean = paths.map((p) => p.trim()).filter(Boolean).slice(0, MAX_MEAL_PHOTOS);
  if (clean.length === 0) return null;
  if (clean.length === 1) return clean[0] ?? null;
  return JSON.stringify(clean);
}

export function emptyTotals(): MealDayTotals {
  return { kcal: 0, protein_g: 0, fat_g: 0, carb_g: 0, meal_count: 0 };
}

export function sumMeals(meals: MemberMealLogView[]): MealDayTotals {
  return meals.reduce<MealDayTotals>(
    (acc, m) => ({
      kcal: acc.kcal + m.kcal,
      protein_g: Math.round((acc.protein_g + m.protein_g) * 10) / 10,
      fat_g: Math.round((acc.fat_g + m.fat_g) * 10) / 10,
      carb_g: Math.round((acc.carb_g + m.carb_g) * 10) / 10,
      meal_count: acc.meal_count + 1,
    }),
    emptyTotals()
  );
}

export function remainingFromTarget(target: MemberNutritionTargetView | null, totals: MealDayTotals): MealRemaining | null {
  if (!target) return null;
  return {
    kcal: target.intake_kcal - totals.kcal,
    protein_g: Math.round((target.protein_g - totals.protein_g) * 10) / 10,
    fat_g: Math.round((target.fat_g - totals.fat_g) * 10) / 10,
    carb_g: Math.round((target.carb_g - totals.carb_g) * 10) / 10,
  };
}

export function buildMealFeedback(params: {
  target: MemberNutritionTargetView | null;
  totals: MealDayTotals;
  remaining: MealRemaining | null;
  lifestyle: MemberLifestyleLogView | null;
  slot?: MealSlot | null;
}): MealFeedback {
  const { target, totals, remaining, lifestyle, slot } = params;
  const tips: string[] = [];

  if (!target || remaining == null) {
    return { headline: "目標カロリーが未設定です。記録だけ残しておきます。", tips };
  }

  let headline = "";
  if (totals.meal_count === 0) {
    headline = "まだ今日の食事がありません。写真を送るとPFCを出します。";
  } else if (remaining.kcal < -150) {
    headline = `目標を約${Math.abs(remaining.kcal)}kcal超えています。残りは軽めに。`;
  } else if (remaining.kcal <= 150 && remaining.protein_g > 20) {
    headline = `カロリーはほぼ目標です。たんぱく質があと${remaining.protein_g}g足りません。`;
  } else if (remaining.kcal > 400) {
    headline = `あと${remaining.kcal}kcal / たんぱく質${Math.max(0, remaining.protein_g)}g です。`;
  } else {
    headline = `残り ${remaining.kcal}kcal（P ${remaining.protein_g}g / F ${remaining.fat_g}g / C ${remaining.carb_g}g）`;
  }

  if (remaining.protein_g > 25 && slot !== "breakfast") {
    tips.push(`たんぱく質がまだ${remaining.protein_g}g足りません。肉・魚・卵・プロテインがおすすめです。`);
  }
  if (remaining.kcal < -200) {
    tips.push("食べ過ぎというより「今日はここで止める」が効きます。夜の間食を控えてください。");
  }
  if ((lifestyle?.alcohol_drinks ?? 0) > 0) {
    tips.push(`アルコール ${lifestyle?.alcohol_drinks}杯分はカロリーに乗りやすいです。水分を多めに。`);
  }
  if (lifestyle?.water_ml != null && lifestyle.water_ml < 1500) {
    tips.push(`水分 ${lifestyle.water_ml}ml です。体重が落ちにくいときは、まず2Lを目指してください。`);
  }
  if (lifestyle?.bowel_count === 0 || lifestyle?.bowel_quality === "none") {
    tips.push("お通じがまだです。水分と食物繊維を意識すると体重のブレが減ります。");
  }
  if (lifestyle?.bowel_quality === "hard") {
    tips.push("便が硬い日は水分不足のことが多いです。");
  }

  return { headline, tips: tips.slice(0, 3) };
}

export function buildMealAnalysis(params: {
  meals: MemberMealLogView[];
  lifestyles: MemberLifestyleLogView[];
  target: MemberNutritionTargetView | null;
  today: string;
}): MealAnalysisHint {
  const from = DateTime.fromISO(params.today, { zone: MEAL_LOG_TZ }).minus({ days: 6 }).toFormat("yyyy-MM-dd");
  const dates: string[] = [];
  for (let i = 0; i < 7; i += 1) {
    dates.push(DateTime.fromISO(params.today, { zone: MEAL_LOG_TZ }).minus({ days: i }).toFormat("yyyy-MM-dd"));
  }
  const meals = params.meals.filter((m) => m.log_date >= from);
  const lifestyles = params.lifestyles.filter((l) => l.log_date >= from);
  const byDate = new Map<string, MemberMealLogView[]>();
  for (const m of meals) {
    const list = byDate.get(m.log_date) ?? [];
    list.push(m);
    byDate.set(m.log_date, list);
  }
  const lifeByDate = new Map(lifestyles.map((l) => [l.log_date, l]));
  const dailyKcals = dates.map((d) => sumMeals(byDate.get(d) ?? []).kcal).filter((n) => n > 0);
  const avg = dailyKcals.length ? Math.round(dailyKcals.reduce((a, b) => a + b, 0) / dailyKcals.length) : null;
  const targetKcal = params.target?.intake_kcal;
  const over =
    targetKcal == null ? 0 : dates.filter((d) => sumMeals(byDate.get(d) ?? []).kcal > targetKcal + 150).length;
  const alcoholDays = dates.filter((d) => (lifeByDate.get(d)?.alcohol_drinks ?? 0) > 0).length;
  const lowWater = dates.filter((d) => {
    const w = lifeByDate.get(d)?.water_ml;
    return w != null && w < 1500;
  }).length;
  const noBowel = dates.filter((d) => {
    const l = lifeByDate.get(d);
    return l != null && (l.bowel_count === 0 || l.bowel_quality === "none");
  }).length;
  const missing = dates.filter((d) => (byDate.get(d)?.length ?? 0) < 2).length;

  const hints: string[] = [];
  if (params.target && avg != null && avg > params.target.intake_kcal + 150) {
    hints.push(`直近の平均摂取が約${avg}kcalで、目標${params.target.intake_kcal}kcalを超えています。`);
  }
  if (alcoholDays >= 2) hints.push(`直近7日でアルコール記録が${alcoholDays}日あります。減量が止まる主因になりやすいです。`);
  if (lowWater >= 3) hints.push("水分が少ない日が続いています。むくみで体重が落ちにくく見えます。");
  if (noBowel >= 2) hints.push("お通じが少ない日があります。体重の増減が食事以外の影響を受けています。");
  if (missing >= 4) hints.push("食事記録が欠けている日が多いです。まず3食の記録を優先してください。");
  if (hints.length === 0 && avg != null) hints.push("大きな乱れは見えていません。継続して同じ条件で測ると原因が切り分けやすくなります。");

  return {
    last_7d_kcal_avg: avg,
    over_target_days: over,
    alcohol_days: alcoholDays,
    low_water_days: lowWater,
    no_bowel_days: noBowel,
    missing_meal_days: missing,
    hints,
  };
}

async function signedPhotoUrl(supabase: SupabaseClient, path: string | null | undefined): Promise<string | null> {
  if (!path) return null;
  const { data, error } = await supabase.storage.from(MEMBER_BODY_PHOTO_BUCKET).createSignedUrl(path, 3600);
  if (error || !data?.signedUrl) return null;
  return data.signedUrl;
}

function toMealView(row: Record<string, unknown>, photoUrls: string[]): MemberMealLogView {
  return {
    id: String(row.id),
    log_date: String(row.log_date),
    meal_slot: isMealSlot(row.meal_slot) ? row.meal_slot : "snack",
    photo_url: photoUrls[0] ?? null,
    photo_urls: photoUrls,
    note: row.note == null ? null : String(row.note),
    items: itemsOf(row.items),
    kcal: n0(row.kcal),
    protein_g: n1(row.protein_g),
    fat_g: n1(row.fat_g),
    carb_g: n1(row.carb_g),
    alcohol_g: row.alcohol_g == null ? null : n1(row.alcohol_g),
    confidence: row.confidence == null ? null : Number(row.confidence),
    source: row.source === "manual" ? "manual" : "ai",
    created_at: String(row.created_at ?? ""),
  };
}

function toLifestyleView(row: Record<string, unknown>): MemberLifestyleLogView {
  const q = String(row.bowel_quality ?? "");
  return {
    log_date: String(row.log_date),
    water_ml: row.water_ml == null ? null : n0(row.water_ml),
    alcohol_drinks: row.alcohol_drinks == null ? null : n1(row.alcohol_drinks),
    bowel_count: row.bowel_count == null ? null : n0(row.bowel_count),
    bowel_quality: q === "normal" || q === "hard" || q === "loose" || q === "none" ? q : null,
    note: row.note == null ? null : String(row.note),
  };
}

export async function listMemberMealLogs(
  supabase: SupabaseClient,
  memberId: string,
  today = tokyoTodayYmd()
): Promise<{ ok: true; meals: MemberMealLogView[] } | { ok: false; error: string; missingTable?: boolean }> {
  const from = DateTime.fromISO(today, { zone: MEAL_LOG_TZ }).minus({ days: MEAL_LOG_HISTORY_DAYS }).toFormat("yyyy-MM-dd");
  const { data, error } = await supabase
    .from("member_meal_logs" as never)
    .select("id, member_id, log_date, meal_slot, photo_path, note, items, kcal, protein_g, fat_g, carb_g, alcohol_g, confidence, source, created_at")
    .eq("member_id", memberId)
    .gte("log_date", from)
    .lte("log_date", today)
    .order("log_date", { ascending: false })
    .order("created_at", { ascending: false });
  if (error) return { ok: false, error: error.message, missingTable: isMissingMealPersonalTable(error) };
  const rows = (data ?? []) as Record<string, unknown>[];
  const meals = await Promise.all(
    rows.map(async (row) => {
      const paths = decodeMealPhotoPaths(row.photo_path);
      const urls = (
        await Promise.all(paths.map((path) => signedPhotoUrl(supabase, path)))
      ).filter((u): u is string => Boolean(u));
      return toMealView(row, urls);
    })
  );
  return { ok: true, meals };
}

export async function listMemberLifestyleLogs(
  supabase: SupabaseClient,
  memberId: string,
  today = tokyoTodayYmd()
): Promise<{ ok: true; logs: MemberLifestyleLogView[] } | { ok: false; error: string; missingTable?: boolean }> {
  const from = DateTime.fromISO(today, { zone: MEAL_LOG_TZ }).minus({ days: MEAL_LOG_HISTORY_DAYS }).toFormat("yyyy-MM-dd");
  const { data, error } = await supabase
    .from("member_lifestyle_logs" as never)
    .select("id, member_id, log_date, water_ml, alcohol_drinks, bowel_count, bowel_quality, note")
    .eq("member_id", memberId)
    .gte("log_date", from)
    .lte("log_date", today)
    .order("log_date", { ascending: false });
  if (error) return { ok: false, error: error.message, missingTable: isMissingMealPersonalTable(error) };
  return { ok: true, logs: ((data ?? []) as Record<string, unknown>[]).map(toLifestyleView) };
}

export async function insertMemberMealLog(
  supabase: SupabaseClient,
  params: {
    memberId: string;
    logDate: string;
    mealSlot: MealSlot;
    photoPath?: string | null;
    note?: string | null;
    items?: string[];
    kcal: number;
    proteinG: number;
    fatG: number;
    carbG: number;
    alcoholG?: number | null;
    confidence?: number | null;
    source?: "ai" | "manual";
  }
): Promise<{ ok: true; meal: MemberMealLogView } | { ok: false; error: string; missingTable?: boolean }> {
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("member_meal_logs" as never)
    .insert({
      member_id: params.memberId,
      log_date: params.logDate,
      meal_slot: params.mealSlot,
      photo_path: params.photoPath ?? null,
      note: params.note ?? null,
      items: params.items ?? [],
      kcal: params.kcal,
      protein_g: params.proteinG,
      fat_g: params.fatG,
      carb_g: params.carbG,
      alcohol_g: params.alcoholG ?? null,
      confidence: params.confidence ?? null,
      source: params.source ?? "ai",
      updated_at: now,
    } as never)
    .select("id, member_id, log_date, meal_slot, photo_path, note, items, kcal, protein_g, fat_g, carb_g, alcohol_g, confidence, source, created_at")
    .maybeSingle();
  if (error) return { ok: false, error: error.message, missingTable: isMissingMealPersonalTable(error) };
  if (!data) return { ok: false, error: "保存結果を取得できませんでした" };
  const row = data as Record<string, unknown>;
  const paths = decodeMealPhotoPaths(row.photo_path);
  const urls = (
    await Promise.all(paths.map((path) => signedPhotoUrl(supabase, path)))
  ).filter((u): u is string => Boolean(u));
  return { ok: true, meal: toMealView(row, urls) };
}

export async function updateMemberMealLog(
  supabase: SupabaseClient,
  params: {
    memberId: string;
    mealId: string;
    items?: string[];
    kcal: number;
    proteinG: number;
    fatG: number;
    carbG: number;
    note?: string | null;
    source?: "ai" | "manual";
  }
): Promise<{ ok: true; meal: MemberMealLogView } | { ok: false; error: string; missingTable?: boolean }> {
  const now = new Date().toISOString();
  const patch: Record<string, unknown> = {
    kcal: params.kcal,
    protein_g: params.proteinG,
    fat_g: params.fatG,
    carb_g: params.carbG,
    source: params.source ?? "manual",
    updated_at: now,
  };
  if (params.items) patch.items = params.items;
  if (params.note !== undefined) patch.note = params.note;
  const { data, error } = await supabase
    .from("member_meal_logs" as never)
    .update(patch as never)
    .eq("id", params.mealId)
    .eq("member_id", params.memberId)
    .select("id, member_id, log_date, meal_slot, photo_path, note, items, kcal, protein_g, fat_g, carb_g, alcohol_g, confidence, source, created_at")
    .maybeSingle();
  if (error) return { ok: false, error: error.message, missingTable: isMissingMealPersonalTable(error) };
  if (!data) return { ok: false, error: "対象の食事が見つかりません" };
  const row = data as Record<string, unknown>;
  const paths = decodeMealPhotoPaths(row.photo_path);
  const urls = (
    await Promise.all(paths.map((path) => signedPhotoUrl(supabase, path)))
  ).filter((u): u is string => Boolean(u));
  return { ok: true, meal: toMealView(row, urls) };
}

export async function upsertMemberLifestyleLog(
  supabase: SupabaseClient,
  params: {
    memberId: string;
    logDate: string;
    waterMl?: number | null;
    alcoholDrinks?: number | null;
    bowelCount?: number | null;
    bowelQuality?: BowelQuality | null;
    note?: string | null;
  }
): Promise<{ ok: true; log: MemberLifestyleLogView } | { ok: false; error: string; missingTable?: boolean }> {
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("member_lifestyle_logs" as never)
    .upsert(
      {
        member_id: params.memberId,
        log_date: params.logDate,
        water_ml: params.waterMl ?? null,
        alcohol_drinks: params.alcoholDrinks ?? null,
        bowel_count: params.bowelCount ?? null,
        bowel_quality: params.bowelQuality ?? null,
        note: params.note ?? null,
        updated_at: now,
      } as never,
      { onConflict: "member_id,log_date" }
    )
    .select("id, member_id, log_date, water_ml, alcohol_drinks, bowel_count, bowel_quality, note")
    .maybeSingle();
  if (error) return { ok: false, error: error.message, missingTable: isMissingMealPersonalTable(error) };
  if (!data) return { ok: false, error: "保存結果を取得できませんでした" };
  return { ok: true, log: toLifestyleView(data as Record<string, unknown>) };
}

export async function uploadMealPhoto(params: {
  supabase: SupabaseClient;
  memberId: string;
  logDate: string;
  fileBytes: ArrayBuffer;
  contentType: string;
}): Promise<{ ok: true; path: string } | { ok: false; error: string }> {
  const ext = params.contentType.includes("png") ? "png" : params.contentType.includes("webp") ? "webp" : "jpg";
  const path = `meals/${params.memberId}/${params.logDate}/${crypto.randomUUID()}.${ext}`;
  const { error } = await params.supabase.storage.from(MEMBER_BODY_PHOTO_BUCKET).upload(path, params.fileBytes, {
    contentType: params.contentType || "image/jpeg",
    upsert: false,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true, path };
}

export async function hasMealSlotLogged(
  supabase: SupabaseClient,
  memberId: string,
  logDate: string,
  slot: MealSlot
): Promise<boolean> {
  const { data, error } = await supabase
    .from("member_meal_logs" as never)
    .select("id")
    .eq("member_id", memberId)
    .eq("log_date", logDate)
    .eq("meal_slot", slot)
    .limit(1)
    .maybeSingle();
  if (error) return false;
  return Boolean((data as { id?: string } | null)?.id);
}

export async function deleteMemberMealLogsForSlot(
  supabase: SupabaseClient,
  memberId: string,
  logDate: string,
  slot: MealSlot
): Promise<{ ok: true; deleted: number } | { ok: false; error: string; missingTable?: boolean }> {
  const { data, error } = await supabase
    .from("member_meal_logs" as never)
    .delete()
    .eq("member_id", memberId)
    .eq("log_date", logDate)
    .eq("meal_slot", slot)
    .select("id, photo_path");
  if (error) return { ok: false, error: error.message, missingTable: isMissingMealPersonalTable(error) };
  const rows = (data ?? []) as Record<string, unknown>[];
  await removeMealPhotos(supabase, rows);
  return { ok: true, deleted: rows.length };
}

export async function deleteMemberMealLogsByIds(
  supabase: SupabaseClient,
  memberId: string,
  mealIds: string[]
): Promise<{ ok: true; deleted: number } | { ok: false; error: string; missingTable?: boolean }> {
  const ids = [...new Set(mealIds.map((id) => id.trim()).filter(Boolean))];
  if (ids.length === 0) return { ok: false, error: "対象の食事がありません" };
  const { data, error } = await supabase
    .from("member_meal_logs" as never)
    .delete()
    .eq("member_id", memberId)
    .in("id", ids)
    .select("id, photo_path");
  if (error) return { ok: false, error: error.message, missingTable: isMissingMealPersonalTable(error) };
  const rows = (data ?? []) as Record<string, unknown>[];
  if (rows.length === 0) return { ok: false, error: "対象の食事が見つかりません" };
  await removeMealPhotos(supabase, rows);
  return { ok: true, deleted: rows.length };
}

async function removeMealPhotos(supabase: SupabaseClient, rows: Record<string, unknown>[]) {
  const paths = rows.flatMap((row) => decodeMealPhotoPaths(row.photo_path));
  if (paths.length === 0) return;
  await supabase.storage.from(MEMBER_BODY_PHOTO_BUCKET).remove(paths);
}
