import { fillItemKcal, type MealEstimate } from "@/lib/memberMealEstimate";
import { isMealBarcode, mealBarcodeLookupCodes } from "@/lib/memberMealFoodFacts";
import { isMissingMealPersonalTable } from "@/lib/memberMealLogs";
import type { SupabaseClient } from "@supabase/supabase-js";

export function mealEstimateProductName(estimate: MealEstimate, fallback = "バーコード商品"): string {
  const fromDetail = estimate.item_details[0]?.name?.trim();
  if (fromDetail) return fromDetail.slice(0, 160);
  const fromItems = estimate.items.find((n) => typeof n === "string" && n.trim());
  if (fromItems) return String(fromItems).trim().slice(0, 160);
  return fallback;
}

export type MealBarcodeProduct = {
  barcode: string;
  name: string;
  kcal: number;
  protein_g: number;
  fat_g: number;
  carb_g: number;
};

export function canonicalMealBarcode(raw: string): string {
  const n = String(raw ?? "").replace(/\D/g, "");
  if (n.length === 14 && n.startsWith("0")) return n.slice(1);
  return n;
}

export function mealBarcodeProductToEstimate(product: MealBarcodeProduct): MealEstimate {
  const item = fillItemKcal({
    name: product.name,
    kcal: product.kcal,
    protein_g: product.protein_g,
    fat_g: product.fat_g,
    carb_g: product.carb_g,
    source: "catalog",
  });
  return {
    kcal: Math.round(item.kcal),
    protein_g: Math.round(item.protein_g * 10) / 10,
    fat_g: Math.round(item.fat_g * 10) / 10,
    carb_g: Math.round(item.carb_g * 10) / 10,
    alcohol_g: null,
    items: [item.name],
    item_details: [item],
    confidence: 0.95,
    note: "バーコード（過去の記録）",
  };
}

export async function lookupMealBarcodeProduct(
  supabase: SupabaseClient,
  barcodeRaw: string
): Promise<MealBarcodeProduct | null> {
  const codes = mealBarcodeLookupCodes(canonicalMealBarcode(barcodeRaw));
  if (codes.length === 0) return null;
  const { data, error } = await supabase
    .from("meal_barcode_products" as never)
    .select("barcode, name, kcal, protein_g, fat_g, carb_g")
    .in("barcode", codes)
    .order("updated_at", { ascending: false })
    .limit(1);
  if (error) {
    if (isMissingMealPersonalTable(error)) return null;
    return null;
  }
  const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | undefined;
  if (!row) return null;
  const name = String(row.name ?? "").trim();
  const kcal = Number(row.kcal);
  const protein = Number(row.protein_g);
  const fat = Number(row.fat_g);
  const carb = Number(row.carb_g);
  if (!name || ![kcal, protein, fat, carb].every((n) => Number.isFinite(n))) return null;
  return {
    barcode: String(row.barcode ?? codes[0]),
    name,
    kcal: Math.round(kcal),
    protein_g: Math.round(protein * 10) / 10,
    fat_g: Math.round(fat * 10) / 10,
    carb_g: Math.round(carb * 10) / 10,
  };
}

export async function upsertMealBarcodeProduct(
  supabase: SupabaseClient,
  params: {
    barcode: string;
    name: string;
    kcal: number;
    proteinG: number;
    fatG: number;
    carbG: number;
    memberId?: string | null;
  }
): Promise<{ ok: true } | { ok: false; error: string; missingTable?: boolean }> {
  const barcode = canonicalMealBarcode(params.barcode);
  const name = params.name.trim().slice(0, 160);
  if (!isMealBarcode(barcode) || !name) return { ok: false, error: "barcode" };
  if (![params.kcal, params.proteinG, params.fatG, params.carbG].every((n) => Number.isFinite(n))) {
    return { ok: false, error: "macros" };
  }
  const now = new Date().toISOString();
  const row = {
    barcode,
    name,
    kcal: Math.round(Math.min(5000, Math.max(0, params.kcal))),
    protein_g: Math.round(Math.min(400, Math.max(0, params.proteinG)) * 10) / 10,
    fat_g: Math.round(Math.min(400, Math.max(0, params.fatG)) * 10) / 10,
    carb_g: Math.round(Math.min(800, Math.max(0, params.carbG)) * 10) / 10,
    last_member_id: params.memberId ?? null,
    updated_at: now,
  };
  const existing = await lookupMealBarcodeProduct(supabase, barcode);
  if (!existing) {
    const { error } = await supabase.from("meal_barcode_products" as never).insert({
      ...row,
      confirm_count: 1,
    });
    if (error) return { ok: false, error: error.message, missingTable: isMissingMealPersonalTable(error) };
    return { ok: true };
  }
  const { data: current, error: readErr } = await supabase
    .from("meal_barcode_products" as never)
    .select("confirm_count")
    .eq("barcode", existing.barcode)
    .maybeSingle();
  if (readErr) return { ok: false, error: readErr.message, missingTable: isMissingMealPersonalTable(readErr) };
  const count = Number((current as { confirm_count?: number } | null)?.confirm_count ?? 1);
  const { error } = await supabase
    .from("meal_barcode_products" as never)
    .update({
      ...row,
      barcode: existing.barcode,
      confirm_count: count + 1,
    })
    .eq("barcode", existing.barcode);
  if (error) return { ok: false, error: error.message, missingTable: isMissingMealPersonalTable(error) };
  return { ok: true };
}
