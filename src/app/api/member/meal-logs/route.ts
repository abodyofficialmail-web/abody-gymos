import { jsonResponse } from "@/app/api/booking-v2/_cors";
import { getMemberIdFromCookie } from "@/app/api/member/_cookies";
import { createSupabaseServiceClient } from "@/lib/supabase/admin";
import { loadMealPersonalDashboard } from "@/lib/memberMealDashboard";
import { estimateMealFromPhoto, sanitizeMealEstimate, type MealEstimate } from "@/lib/memberMealEstimate";
import { applyMealCatalog } from "@/lib/memberMealCatalog";
import { applyMextFoods } from "@/lib/memberMealFoodDb";
import { applyOpenFoodFacts, isMealBarcode, lookupOpenFoodFactsBarcode } from "@/lib/memberMealFoodFacts";
import {
  buildMealChatContext,
  formatMealLogForChat,
  resolveMealChatTargets,
  runMealChatTurn,
  sanitizeMealChatMessages,
  type MealChatApplyResult,
  type MealChatTurnResult,
} from "@/lib/memberMealChat";
import { isMemberMealPersonalEnabled } from "@/lib/memberMealPersonalRollout";
import { verifyMemberMealLogSigned } from "@/lib/memberMealLogSigned";
import {
  defaultMealSlot,
  deleteMemberMealLogsByIds,
  encodeMealPhotoPaths,
  formatMealDishesNote,
  insertMemberMealLog,
  isMealCountUnit,
  isMealServing,
  isMealSlot,
  MAX_MEAL_PHOTOS,
  MEAL_SERVING_LABELS,
  MEAL_SLOT_LABELS,
  tokyoTodayYmd,
  updateMemberMealLog,
  uploadMealPhoto,
  upsertMemberLifestyleLog,
  type BowelQuality,
  type MealDishInput,
  type MealSlot,
  type MemberMealLogView,
} from "@/lib/memberMealLogs";
import { isLogDateAllowed } from "@/lib/memberWeightLogs";
import { parseMealReminderSettings, upsertMealReminderSettings } from "@/lib/memberMealReminderSettings";

export const maxDuration = 60;

async function resolveMember(
  supabase: ReturnType<typeof createSupabaseServiceClient>,
  signed?: { s?: string; sig?: string }
): Promise<
  | { ok: true; memberId: string; memberCode: string; slotHint?: string }
  | { ok: false; status: number; error: string }
> {
  const s = signed?.s?.trim() ?? "";
  const sig = signed?.sig?.trim() ?? "";
  if (s && sig) {
    const payload = verifyMemberMealLogSigned(s, sig);
    if (!payload) return { ok: false, status: 400, error: "リンクが無効または期限切れです" };
    const { data: member, error } = await supabase
      .from("members")
      .select("id, member_code, is_active")
      .eq("id", payload.member_id)
      .maybeSingle();
    if (error) return { ok: false, status: 500, error: "会員の取得に失敗しました" };
    if (!member || member.is_active === false) return { ok: false, status: 401, error: "未ログイン" };
    if (!isMemberMealPersonalEnabled(member.member_code)) {
      return { ok: false, status: 403, error: "この機能は現在ご利用いただけません" };
    }
    return { ok: true, memberId: member.id, memberCode: String(member.member_code ?? ""), slotHint: payload.slot };
  }

  const memberId = getMemberIdFromCookie();
  if (!memberId) return { ok: false, status: 401, error: "未ログイン" };
  const { data: member, error } = await supabase
    .from("members")
    .select("id, member_code, is_active")
    .eq("id", memberId)
    .maybeSingle();
  if (error) return { ok: false, status: 500, error: "会員の取得に失敗しました" };
  if (!member || !member.is_active) return { ok: false, status: 401, error: "未ログイン" };
  if (!isMemberMealPersonalEnabled(member.member_code)) {
    return { ok: false, status: 403, error: "この機能は現在ご利用いただけません" };
  }
  return { ok: true, memberId: member.id, memberCode: String(member.member_code ?? "") };
}

function dash(supabase: ReturnType<typeof createSupabaseServiceClient>, memberId: string) {
  return loadMealPersonalDashboard(supabase, memberId);
}

export async function OPTIONS() {
  return jsonResponse({}, 200);
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const supabase = createSupabaseServiceClient();
    const resolved = await resolveMember(supabase, {
      s: url.searchParams.get("s") ?? undefined,
      sig: url.searchParams.get("sig") ?? undefined,
    });
    if (!resolved.ok) return jsonResponse({ error: resolved.error }, resolved.status);
    const data = await dash(supabase, resolved.memberId);
    if (data.error && data.missingTable) {
      return jsonResponse({ enabled: true, ...data, meals: [], lifestyles: [], today_meals: [] });
    }
    if (data.error && !data.missingTable) {
      return jsonResponse({ error: "食事記録の取得に失敗しました", detail: data.error }, 500);
    }
    return jsonResponse({ enabled: true, default_slot: resolved.slotHint ?? defaultMealSlot(), ...data });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return jsonResponse({ error: "取得中にエラーが発生しました", detail: message }, 500);
  }
}

function parseBowelQuality(raw: unknown): BowelQuality | null {
  const v = String(raw ?? "").trim();
  if (v === "normal" || v === "hard" || v === "loose" || v === "none") return v;
  return null;
}

function collectMealPhotos(form: FormData): File[] {
  const out: File[] = [];
  const seen = new Set<File>();
  for (const key of ["photos", "photo"]) {
    for (const value of form.getAll(key)) {
      if (!(value instanceof File) || value.size < 100 || seen.has(value)) continue;
      seen.add(value);
      out.push(value);
      if (out.length >= MAX_MEAL_PHOTOS) return out;
    }
  }
  return out;
}

function dishGramsOf(dishes: MealDishInput[]) {
  return dishes.map((d) => ({ menu: d.menu, grams: d.grams, count: d.count, count_unit: d.count_unit }));
}

async function refineEstimate(estimate: MealEstimate, dishes: MealDishInput[]): Promise<MealEstimate> {
  const grams = dishGramsOf(dishes);
  let refined = applyMealCatalog(estimate, grams);
  refined = applyMextFoods(refined, grams);
  return applyOpenFoodFacts(refined, grams);
}

function parseMealItems(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  return raw.map((x) => String(x).trim()).filter(Boolean).slice(0, 16);
}

function parseMealMacros(raw: Record<string, unknown>) {
  const kcal = Math.round(Number(raw.kcal));
  const proteinG = Number(raw.protein_g);
  const fatG = Number(raw.fat_g);
  const carbG = Number(raw.carb_g);
  if (![kcal, proteinG, fatG, carbG].every((n) => Number.isFinite(n))) return null;
  if (kcal < 0 || kcal > 5000 || proteinG < 0 || fatG < 0 || carbG < 0) return null;
  return { kcal, proteinG, fatG, carbG };
}

async function applyMealChatMutation(params: {
  supabase: ReturnType<typeof createSupabaseServiceClient>;
  memberId: string;
  meals: MemberMealLogView[];
  today: string;
  result: MealChatTurnResult;
}): Promise<MealChatApplyResult> {
  const resolved = resolveMealChatTargets({
    meals: params.meals,
    action: params.result.action,
    mealId: params.result.target_meal_id,
    slot: params.result.target_slot,
    logDate: params.result.target_date,
    today: params.today,
  });
  if (!resolved.ok) {
    if (resolved.reason === "not_found") {
      return { applied: null, meal_ids: [], note: "対象の記録が見つかりませんでした。朝/昼/夜かメニューを指定してください。" };
    }
    if (resolved.reason === "ambiguous") {
      return { applied: null, meal_ids: [], note: "どの記録か特定できませんでした。朝/昼/夜かメニューを指定してください。" };
    }
    return { applied: null, meal_ids: [], note: null };
  }

  const ids = resolved.meals.map((m) => m.id);
  if (params.result.action === "delete") {
    const deleted = await deleteMemberMealLogsByIds(params.supabase, params.memberId, ids);
    if (!deleted.ok) return { applied: null, meal_ids: [], note: deleted.error };
    const label = resolved.meals
      .map((m) => `${MEAL_SLOT_LABELS[m.meal_slot]}（${m.items.slice(0, 2).join("・") || `${m.kcal}kcal`}）`)
      .join("、");
    return { applied: "deleted", meal_ids: ids, note: `${label}の記録を削除しました。` };
  }

  const meal = resolved.meals[0];
  if (!meal) return { applied: null, meal_ids: [], note: "対象の記録が見つかりませんでした。" };
  const estimate = params.result.estimate;
  const patch = params.result.patch;
  const nextItems = estimate?.items.length ? estimate.items : patch.items ?? meal.items;
  const next = {
    kcal: patch.kcal ?? estimate?.kcal ?? meal.kcal,
    proteinG: patch.protein_g ?? estimate?.protein_g ?? meal.protein_g,
    fatG: patch.fat_g ?? estimate?.fat_g ?? meal.fat_g,
    carbG: patch.carb_g ?? estimate?.carb_g ?? meal.carb_g,
  };
  if (next.kcal === meal.kcal && next.proteinG === meal.protein_g && next.fatG === meal.fat_g && next.carbG === meal.carb_g && JSON.stringify(nextItems) === JSON.stringify(meal.items)) {
    return { applied: null, meal_ids: [meal.id], note: "修正内容が読み取れませんでした。数字かメニューを指定してください。" };
  }
  const saved = await updateMemberMealLog(params.supabase, {
    memberId: params.memberId,
    mealId: meal.id,
    items: nextItems,
    kcal: next.kcal,
    proteinG: next.proteinG,
    fatG: next.fatG,
    carbG: next.carbG,
    note: patch.note ?? undefined,
    source: "manual",
  });
  if (!saved.ok) return { applied: null, meal_ids: [], note: saved.error };
  return {
    applied: "updated",
    meal_ids: [meal.id],
    note: `${MEAL_SLOT_LABELS[meal.meal_slot]}を ${next.kcal}kcal / P${next.proteinG} F${next.fatG} C${next.carbG} に直しました。`,
  };
}

function parseDishesJson(raw: string): MealDishInput[] {
  if (!raw.trim()) return [];
  try {
    const parsed = JSON.parse(raw) as Array<Record<string, unknown>>;
    return parsed
      .map((d) => ({
        menu: String(d.menu ?? "").trim(),
        grams: d.grams == null || String(d.grams).trim() === "" ? null : Number(d.grams),
        count: d.count == null || String(d.count).trim() === "" ? null : Number(d.count),
        count_unit: isMealCountUnit(d.count_unit) ? d.count_unit : "個",
        serving: isMealServing(d.serving) ? d.serving : null,
      }))
      .filter((d) => d.menu);
  } catch {
    return [];
  }
}

export async function POST(req: Request) {
  try {
    const contentType = req.headers.get("content-type") ?? "";
    const supabase = createSupabaseServiceClient();
    const today = tokyoTodayYmd();

    if (contentType.includes("application/json")) {
      const raw = (await req.json().catch(() => ({}))) as Record<string, unknown>;
      const resolved = await resolveMember(supabase, { s: String(raw.s ?? ""), sig: String(raw.sig ?? "") });
      if (!resolved.ok) return jsonResponse({ error: resolved.error }, resolved.status);

      if (raw.kind === "reminder_settings") {
        const parsed = parseMealReminderSettings({
          breakfast_time: raw.breakfast_time,
          lunch_time: raw.lunch_time,
          dinner_time: raw.dinner_time,
          snack_time: raw.snack_time,
        });
        if (!parsed) return jsonResponse({ error: "配信時間は 00:00〜23:59 で入力してください" }, 400);
        const saved = await upsertMealReminderSettings(supabase, resolved.memberId, parsed);
        if (!saved.ok) {
          if (saved.missingTable) {
            return jsonResponse({ error: "配信時間の保存準備ができていません。SQLを適用してください。" }, 503);
          }
          return jsonResponse({ error: "配信時間の保存に失敗しました", detail: saved.error }, 500);
        }
        const data = await dash(supabase, resolved.memberId);
        return jsonResponse({ ok: true, ...data, reminder_settings: saved.settings });
      }

      if (raw.kind === "barcode") {
        const barcode = String(raw.barcode ?? "").trim();
        if (!isMealBarcode(barcode)) {
          return jsonResponse({ error: "バーコードは8〜14桁の数字で入力してください" }, 400);
        }
        const estimate = await lookupOpenFoodFactsBarcode(barcode);
        if (!estimate) {
          return jsonResponse(
            { error: "このバーコードの商品が見つかりませんでした。番号を確認するか、手入力してください。" },
            404
          );
        }
        return jsonResponse({ ok: true, preview: true, estimate, estimate_note: estimate.note });
      }

      if (raw.kind === "delete_meal") {
        const mealId = String(raw.meal_id ?? "").trim();
        if (!mealId) return jsonResponse({ error: "meal_id が不正です" }, 400);
        const deleted = await deleteMemberMealLogsByIds(supabase, resolved.memberId, [mealId]);
        if (!deleted.ok) {
          if (deleted.missingTable) return jsonResponse({ error: "食事パーソナルの準備ができていません。SQLを適用してください。" }, 503);
          return jsonResponse({ error: deleted.error }, deleted.error.includes("見つかりません") ? 404 : 500);
        }
        const data = await dash(supabase, resolved.memberId);
        return jsonResponse({ ok: true, applied: "deleted", ...data });
      }

      if (raw.kind === "update_meal") {
        const mealId = String(raw.meal_id ?? "").trim();
        const macros = parseMealMacros(raw);
        if (!mealId) return jsonResponse({ error: "meal_id が不正です" }, 400);
        if (!macros) return jsonResponse({ error: "栄養値が不正です" }, 400);
        const saved = await updateMemberMealLog(supabase, {
          memberId: resolved.memberId,
          mealId,
          items: parseMealItems(raw.items),
          kcal: macros.kcal,
          proteinG: macros.proteinG,
          fatG: macros.fatG,
          carbG: macros.carbG,
          note: raw.note == null ? undefined : String(raw.note),
          source: "manual",
        });
        if (!saved.ok) {
          if (saved.missingTable) return jsonResponse({ error: "食事パーソナルの準備ができていません。SQLを適用してください。" }, 503);
          return jsonResponse({ error: saved.error }, saved.error.includes("見つかりません") ? 404 : 500);
        }
        const data = await dash(supabase, resolved.memberId);
        return jsonResponse({ ok: true, applied: "updated", meal: saved.meal, ...data });
      }

      const logDate = String(raw.log_date ?? today).trim();
      if (!isLogDateAllowed(logDate, today)) {
        return jsonResponse({ error: "記録できる日付は今日から30日前までです" }, 400);
      }
      const water = raw.water_ml == null || String(raw.water_ml).trim() === "" ? null : Number(raw.water_ml);
      const drinks = raw.alcohol_drinks == null || String(raw.alcohol_drinks).trim() === "" ? null : Number(raw.alcohol_drinks);
      const bowel = raw.bowel_count == null || String(raw.bowel_count).trim() === "" ? null : Number(raw.bowel_count);
      if (water != null && (!Number.isFinite(water) || water < 0 || water > 10000)) {
        return jsonResponse({ error: "水分は 0〜10000 ml で入力してください" }, 400);
      }
      if (drinks != null && (!Number.isFinite(drinks) || drinks < 0 || drinks > 30)) {
        return jsonResponse({ error: "アルコールは 0〜30 杯で入力してください" }, 400);
      }
      if (bowel != null && (!Number.isInteger(bowel) || bowel < 0 || bowel > 10)) {
        return jsonResponse({ error: "お通じは 0〜10 回で入力してください" }, 400);
      }
      const saved = await upsertMemberLifestyleLog(supabase, {
        memberId: resolved.memberId,
        logDate,
        waterMl: water,
        alcoholDrinks: drinks,
        bowelCount: bowel,
        bowelQuality: parseBowelQuality(raw.bowel_quality),
        note: raw.note == null ? null : String(raw.note),
      });
      if (!saved.ok) {
        if (saved.missingTable) return jsonResponse({ error: "食事パーソナルの準備ができていません。SQLを適用してください。" }, 503);
        return jsonResponse({ error: "生活記録の保存に失敗しました", detail: saved.error }, 500);
      }
      const data = await dash(supabase, resolved.memberId);
      return jsonResponse({ ok: true, lifestyle: saved.log, ...data });
    }

    const form = await req.formData();
    const resolved = await resolveMember(supabase, {
      s: String(form.get("s") ?? ""),
      sig: String(form.get("sig") ?? ""),
    });
    if (!resolved.ok) return jsonResponse({ error: resolved.error }, resolved.status);

    const logDate = String(form.get("log_date") ?? today).trim();
    if (!isLogDateAllowed(logDate, today)) {
      return jsonResponse({ error: "記録できる日付は今日から30日前までです" }, 400);
    }
    const slotRaw = String(form.get("meal_slot") ?? resolved.slotHint ?? defaultMealSlot());
    if (!isMealSlot(slotRaw)) return jsonResponse({ error: "食事区分が不正です" }, 400);
    const slot = slotRaw as MealSlot;
    const eatenTime = String(form.get("eaten_time") ?? "").trim() || null;
    const dishes = parseDishesJson(String(form.get("dishes") ?? ""));
    if (dishes.some((d) => d.grams != null && (!Number.isFinite(d.grams) || d.grams < 0 || d.grams > 3000))) {
      return jsonResponse({ error: "グラムは 0〜3000 で入力してください" }, 400);
    }
    if (dishes.some((d) => d.count != null && (!Number.isFinite(d.count) || d.count < 0 || d.count > 100))) {
      return jsonResponse({ error: "個数は 0〜100 で入力してください" }, 400);
    }
    const dishesNote = formatMealDishesNote({ eatenTime, dishes });
    const photoFiles = collectMealPhotos(form);
    const isChat = String(form.get("kind") ?? "") === "chat";
    const isPreview = String(form.get("preview") ?? "") === "1";
    const confirmedRaw = String(form.get("estimate") ?? "").trim();
    if (!isChat && photoFiles.length === 0 && dishes.length === 0 && !confirmedRaw) {
      return jsonResponse({ error: "写真かメニューのどちらかを入力してください" }, 400);
    }

    const images: Array<{ base64: string; mimeType: string }> = [];
    const fileBytes: Array<{ bytes: ArrayBuffer; mime: string }> = [];
    for (const file of photoFiles) {
      if (file.size > 6 * 1024 * 1024) {
        return jsonResponse({ error: "写真は1枚6MB以下にしてください" }, 400);
      }
      const mime = file.type || "image/jpeg";
      const bytes = await file.arrayBuffer();
      fileBytes.push({ bytes, mime });
      images.push({ base64: Buffer.from(bytes).toString("base64"), mimeType: mime });
    }

    if (isChat) {
      let messagesRaw: unknown = [];
      try {
        messagesRaw = JSON.parse(String(form.get("messages") ?? "[]"));
      } catch {
        messagesRaw = [];
      }
      const messages = sanitizeMealChatMessages(messagesRaw);
      if (messages.every((m) => m.role !== "user") && images.length === 0) {
        return jsonResponse({ error: "メッセージか写真を送ってください" }, 400);
      }
      const dashData = await dash(supabase, resolved.memberId);
      const { data: memberRow } = await supabase
        .from("members")
        .select("store_id")
        .eq("id", resolved.memberId)
        .maybeSingle();
      const storeId = String((memberRow as { store_id?: string } | null)?.store_id ?? "");
      const { data: storeRow } = storeId
        ? await supabase.from("stores").select("name").eq("id", storeId).maybeSingle()
        : { data: null };
      const life = dashData.today_lifestyle;
      const chat = await runMealChatTurn({
        messages,
        images,
        context: buildMealChatContext({
          slotLabel: MEAL_SLOT_LABELS[slot],
          eatenTime,
          storeName: storeRow && "name" in storeRow ? String(storeRow.name ?? "") : null,
          nutrition: dashData.nutrition
            ? {
                intake_kcal: dashData.nutrition.intake_kcal,
                protein_g: dashData.nutrition.protein_g,
                fat_g: dashData.nutrition.fat_g,
                carb_g: dashData.nutrition.carb_g,
              }
            : null,
          remaining: dashData.remaining,
          totals: dashData.totals,
          todayMeals: (dashData.today_meals ?? []).map(formatMealLogForChat),
          recentMeals: (dashData.meals ?? [])
            .filter((m) => m.log_date !== dashData.today)
            .slice(0, 10)
            .map(formatMealLogForChat),
          lifestyle: life
            ? [
                life.water_ml != null ? `水分${life.water_ml}ml` : "",
                life.alcohol_drinks != null ? `酒${life.alcohol_drinks}杯` : "",
                life.bowel_count != null ? `お通じ${life.bowel_count}回` : "",
              ]
                .filter(Boolean)
                .join(" / ")
            : null,
          hints: dashData.analysis?.hints,
          photoCount: images.length,
        }),
      });
      if (!chat.ok) return jsonResponse({ error: chat.error }, 502);
      const chatDishes = chat.result.dishes.length ? chat.result.dishes : dishes;
      const estimate = chat.result.estimate ? await refineEstimate(chat.result.estimate, chatDishes) : null;
      const refinedResult = { ...chat.result, estimate };
      const mutation = await applyMealChatMutation({
        supabase,
        memberId: resolved.memberId,
        meals: dashData.meals ?? [],
        today: dashData.today,
        result: refinedResult,
      });
      const reply = mutation.note && mutation.applied
        ? `${chat.result.reply}\n\n${mutation.note}`
        : mutation.note && chat.result.action
          ? `${chat.result.reply}\n\n${mutation.note}`
          : chat.result.reply;
      const data = mutation.applied ? await dash(supabase, resolved.memberId) : null;
      return jsonResponse({
        ok: true,
        reply,
        ready: Boolean(chat.result.ready && estimate && !mutation.applied),
        estimate: mutation.applied ? null : estimate,
        dishes: chatDishes,
        applied: mutation.applied,
        ...(data ?? {}),
      });
    }

    let refined: MealEstimate;
    if (confirmedRaw) {
      let parsedConfirm: unknown;
      try {
        parsedConfirm = JSON.parse(confirmedRaw);
      } catch {
        return jsonResponse({ error: "確認内容が不正です" }, 400);
      }
      const sanitized = sanitizeMealEstimate(parsedConfirm as Partial<MealEstimate> & { items?: unknown });
      if (!sanitized) return jsonResponse({ error: "確認内容が不正です" }, 400);
      refined = sanitized;
    } else {
      const estimated = await estimateMealFromPhoto({
        images,
        note: dishesNote,
        slotLabel: slot,
        eatenTime,
        dishesHint: dishesNote,
      });
      if (!estimated.ok) return jsonResponse({ error: estimated.error }, 502);
      refined = await refineEstimate(estimated.estimate, dishes);
      if (isPreview) {
        return jsonResponse({
          ok: true,
          preview: true,
          estimate: refined,
          estimate_note: refined.note,
        });
      }
    }

    const photoPaths: string[] = [];
    for (const file of fileBytes) {
      const uploaded = await uploadMealPhoto({
        supabase,
        memberId: resolved.memberId,
        logDate,
        fileBytes: file.bytes,
        contentType: file.mime,
      });
      if (!uploaded.ok) return jsonResponse({ error: "写真の保存に失敗しました", detail: uploaded.error }, 500);
      photoPaths.push(uploaded.path);
    }

    const userItems = dishes.map((d) => {
      const bits = [d.menu];
      if (d.grams != null && Number.isFinite(d.grams)) bits.push(`${d.grams}g`);
      if (d.count != null && Number.isFinite(d.count)) bits.push(`${d.count}${d.count_unit ?? "個"}`);
      if (d.serving) bits.push(MEAL_SERVING_LABELS[d.serving]);
      return bits.join(" ");
    });
    const itemNames = refined.items.length ? refined.items : userItems;

    const saved = await insertMemberMealLog(supabase, {
      memberId: resolved.memberId,
      logDate,
      mealSlot: slot,
      photoPath: encodeMealPhotoPaths(photoPaths),
      note: dishesNote,
      items: itemNames,
      kcal: refined.kcal,
      proteinG: refined.protein_g,
      fatG: refined.fat_g,
      carbG: refined.carb_g,
      alcoholG: refined.alcohol_g,
      confidence: refined.confidence,
      source: confirmedRaw ? "manual" : "ai",
    });
    if (!saved.ok) {
      if (saved.missingTable) return jsonResponse({ error: "食事パーソナルの準備ができていません。SQLを適用してください。" }, 503);
      return jsonResponse({ error: "食事の保存に失敗しました", detail: saved.error }, 500);
    }

    const data = await dash(supabase, resolved.memberId);
    return jsonResponse({
      ok: true,
      meal: saved.meal,
      estimate_note: refined.note,
      ...data,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return jsonResponse({ error: "保存中にエラーが発生しました", detail: message }, 500);
  }
}
