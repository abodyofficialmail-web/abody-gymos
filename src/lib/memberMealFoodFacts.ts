import { fillItemKcal, type MealEstimate, type MealEstimateItem } from "@/lib/memberMealEstimate";
import {
  isProteinProduct,
  resolveDishGrams,
  scaleFromProtein,
  scalePer100g,
  type MealDishGrams,
} from "@/lib/memberMealCatalog";

type OffProduct = {
  product_name?: string;
  product_name_ja?: string;
  brands?: string;
  serving_size?: string;
  nutriments?: Record<string, unknown>;
};

function num(raw: unknown): number | null {
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function servingGrams(raw: string | undefined): number | null {
  const m = String(raw ?? "").match(/(\d+(?:\.\d+)?)\s*g/i);
  return m ? Number(m[1]) : null;
}

function looksPackaged(name: string): boolean {
  return /プロテイン|サプリ|エクスプロージョン|ザバス|マイプロテイン|ウイダー|x-plosion|whey/i.test(name);
}

function searchQuery(name: string): string {
  return name
    .replace(/エクスプロージョン/g, "x-plosion")
    .replace(/プロテイン/g, "protein")
    .trim();
}

function pickProduct(products: OffProduct[], name: string): OffProduct | null {
  const n = name.toLowerCase();
  const scored = products
    .map((p) => {
      const label = `${p.brands ?? ""} ${p.product_name ?? ""} ${p.product_name_ja ?? ""}`.toLowerCase();
      const nutriments = p.nutriments ?? {};
      const kcal = num(nutriments["energy-kcal_100g"]) ?? num(nutriments["energy-kcal"]);
      const protein = num(nutriments.proteins_100g);
      if (kcal == null || protein == null) return { p, score: 0 };
      let score = 1;
      if (/x-plosion|xplosion/.test(label) && /エクスプロージョン|x-plosion|xplosion/i.test(n)) score += 5;
      if (/protein|whey|プロテイン/.test(label) && /プロテイン|protein|whey/i.test(n)) score += 3;
      if (kcal > 0 && protein > 0) score += 1;
      return { p, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);
  return scored[0]?.p ?? null;
}

function toItem(product: OffProduct, amount: number, fallbackName: string, asProtein: boolean): MealEstimateItem | null {
  const n = product.nutriments ?? {};
  const kcal = num(n["energy-kcal_100g"]) ?? num(n["energy-kcal"]);
  const protein = num(n.proteins_100g);
  const fat = num(n.fat_100g) ?? 0;
  const carb = num(n.carbohydrates_100g) ?? 0;
  if (kcal == null || protein == null) return null;
  const brand = String(product.brands ?? "").split(",")[0]?.trim();
  const pname = String(product.product_name_ja || product.product_name || fallbackName).trim();
  const name = [brand, pname].filter(Boolean).join(" ");
  const per100g = { kcal, protein_g: protein, fat_g: fat, carb_g: carb };
  if (asProtein) return scaleFromProtein(per100g, amount, name || fallbackName);
  return scalePer100g(per100g, amount, name || fallbackName);
}

async function searchOpenFoodFacts(name: string): Promise<OffProduct[]> {
  const q = searchQuery(name);
  if (!q) return [];
  const url = `https://world.openfoodfacts.org/cgi/search.pl?search_terms=${encodeURIComponent(q)}&search_simple=1&action=process&json=1&page_size=5`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4000);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "AbodyGymOS/1.0 (https://abody-gymos.vercel.app)",
        Accept: "application/json",
      },
    });
    if (!res.ok) return [];
    const json = (await res.json()) as { products?: OffProduct[] };
    return Array.isArray(json.products) ? json.products : [];
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

function digitsOnly(raw: string): string {
  return String(raw ?? "").replace(/\D/g, "");
}

export function isMealBarcode(raw: string): boolean {
  const n = digitsOnly(raw);
  return n.length >= 8 && n.length <= 14;
}

export function mealBarcodeLookupCodes(raw: string): string[] {
  const n = digitsOnly(raw);
  const out: string[] = [];
  const add = (code: string) => {
    if (code && !out.includes(code)) out.push(code);
  };
  add(n);
  if (n.length === 12) add(`0${n}`);
  if (n.length === 13) add(`0${n}`);
  if (n.length === 13 && n.startsWith("0")) add(n.slice(1));
  if (n.length === 14 && n.startsWith("0")) add(n.slice(1));
  return out;
}

function productNameOf(product: OffProduct): string {
  const brand = String(product.brands ?? "").split(",")[0]?.trim();
  const pname = String(product.product_name_ja || product.product_name || "").trim();
  return [brand, pname].filter(Boolean).join(" ") || "商品";
}

function estimateFromOffProduct(product: OffProduct): MealEstimate | null {
  const n = product.nutriments ?? {};
  const kcal100 = num(n["energy-kcal_100g"]) ?? num(n["energy-kcal"]);
  const p100 = num(n.proteins_100g);
  const f100 = num(n.fat_100g) ?? 0;
  const c100 = num(n.carbohydrates_100g) ?? 0;
  const servingKcal = num(n["energy-kcal_serving"]);
  const servingP = num(n.proteins_serving);
  const servingF = num(n.fat_serving);
  const servingC = num(n.carbohydrates_serving);
  const grams = servingGrams(product.serving_size);
  const name = productNameOf(product);
  let item: MealEstimateItem | null = null;
  let note = "バーコード（Open Food Facts）";
  if (servingKcal != null && servingKcal > 0) {
    item = fillItemKcal({
      name,
      kcal: servingKcal,
      protein_g: servingP ?? 0,
      fat_g: servingF ?? 0,
      carb_g: servingC ?? 0,
      source: "catalog",
    });
    note = grams ? `${note} / 1食 ${grams}g` : `${note} / 1食分`;
  } else if (kcal100 != null && p100 != null) {
    const amount = grams && grams > 0 ? grams : 100;
    item = scalePer100g({ kcal: kcal100, protein_g: p100, fat_g: f100, carb_g: c100 }, amount, name);
    note = grams ? `${note} / ${grams}g` : `${note} / 100gあたり`;
  }
  if (!item) return null;
  return {
    kcal: Math.round(item.kcal),
    protein_g: Math.round(item.protein_g * 10) / 10,
    fat_g: Math.round(item.fat_g * 10) / 10,
    carb_g: Math.round(item.carb_g * 10) / 10,
    alcohol_g: null,
    items: [item.name],
    item_details: [item],
    confidence: 0.9,
    note: note.slice(0, 240),
  };
}

const OFF_HOSTS_PRIMARY = ["https://jp.openfoodfacts.org", "https://world.openfoodfacts.org"];
const OFF_HOSTS_FALLBACK = ["https://world.openbeautyfacts.org", "https://world.openproductsfacts.org"];

async function fetchOffProductFromHosts(
  codes: string[],
  hosts: string[],
  signal: AbortSignal
): Promise<OffProduct | null> {
  const urls = codes.flatMap((code) =>
    hosts.map((host) => `${host}/api/v2/product/${encodeURIComponent(code)}.json`)
  );
  const results = await Promise.all(
    urls.map(async (url) => {
      try {
        const res = await fetch(url, {
          signal,
          headers: {
            "User-Agent": "AbodyGymOS/1.0 (https://abody-gymos.vercel.app)",
            Accept: "application/json",
          },
        });
        if (!res.ok) return null;
        const json = (await res.json().catch(() => ({}))) as { status?: number; product?: OffProduct };
        if (json.status === 1 && json.product) return json.product;
      } catch {
        return null;
      }
      return null;
    })
  );
  return results.find((p): p is OffProduct => Boolean(p)) ?? null;
}

async function fetchOffProduct(barcode: string): Promise<OffProduct | null> {
  const codes = mealBarcodeLookupCodes(barcode);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);
  try {
    const primary = await fetchOffProductFromHosts(codes, OFF_HOSTS_PRIMARY, controller.signal);
    if (primary) return primary;
    return await fetchOffProductFromHosts(codes, OFF_HOSTS_FALLBACK, controller.signal);
  } finally {
    clearTimeout(timer);
  }
}

export async function lookupMealBarcode(barcodeRaw: string): Promise<{
  estimate: MealEstimate | null;
  productName: string | null;
}> {
  const barcode = digitsOnly(barcodeRaw);
  if (!isMealBarcode(barcode)) return { estimate: null, productName: null };
  const product = await fetchOffProduct(barcode);
  if (!product) return { estimate: null, productName: null };
  const name = productNameOf(product);
  return {
    estimate: estimateFromOffProduct(product),
    productName: name === "商品" ? null : name,
  };
}

export async function lookupOpenFoodFactsBarcode(barcodeRaw: string): Promise<MealEstimate | null> {
  const found = await lookupMealBarcode(barcodeRaw);
  return found.estimate;
}

export async function applyOpenFoodFacts(estimate: MealEstimate, dishes?: MealDishGrams[]): Promise<MealEstimate> {
  const details = estimate.item_details.length
    ? [...estimate.item_details]
    : estimate.items.map((name) => fillItemKcal({ name, kcal: 0, protein_g: 0, fat_g: 0, carb_g: 0, source: "ai" }));

  let changed = false;
  for (let i = 0; i < details.length; i += 1) {
    const item = details[i];
    if (item.source === "catalog") continue;
    if (!looksPackaged(item.name)) continue;
    const products = await searchOpenFoodFacts(item.name);
    const product = pickProduct(products, item.name);
    if (!product) continue;
    const asProtein = isProteinProduct(item.name);
    const amount = asProtein
      ? resolveDishGrams(item.name, dishes) ?? (item.protein_g > 0 ? item.protein_g : 20)
      : resolveDishGrams(item.name, dishes) ?? servingGrams(product.serving_size) ?? 100;
    const next = toItem(product, amount, item.name, asProtein);
    if (!next) continue;
    details[i] = next;
    changed = true;
  }
  if (!changed) return estimate;

  const totals = details.reduce(
    (a, d) => ({
      kcal: a.kcal + d.kcal,
      protein_g: a.protein_g + d.protein_g,
      fat_g: a.fat_g + d.fat_g,
      carb_g: a.carb_g + d.carb_g,
    }),
    { kcal: 0, protein_g: 0, fat_g: 0, carb_g: 0 }
  );
  return {
    ...estimate,
    kcal: Math.round(totals.kcal),
    protein_g: Math.round(totals.protein_g * 10) / 10,
    fat_g: Math.round(totals.fat_g * 10) / 10,
    carb_g: Math.round(totals.carb_g * 10) / 10,
    items: details.map((d) => d.name),
    item_details: details,
    confidence: Math.max(estimate.confidence, 0.88),
    note: [estimate.note, "商品データベースで補正"].filter(Boolean).join(" / ").slice(0, 240),
  };
}
