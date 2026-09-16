import { fillItemKcal, type MealEstimate, type MealEstimateItem } from "@/lib/memberMealEstimate";

export type MealDishGrams = {
  menu: string;
  grams: number | null;
  count?: number | null;
  count_unit?: string | null;
};

type Per100g = {
  kcal: number;
  protein_g: number;
  fat_g: number;
  carb_g: number;
};

type CatalogEntry = {
  keys: string[];
  exclude?: string[];
  name: string;
  kcal?: number;
  protein_g?: number;
  fat_g?: number;
  carb_g?: number;
  per_100g?: Per100g;
  default_grams?: number;
  gram_means?: "weight" | "protein";
};

const CATALOG: CatalogEntry[] = [
  {
    keys: ["親子丼セット", "そば"],
    exclude: ["満腹"],
    name: "小諸そば 親子丼セット（そば）",
    kcal: 768,
    protein_g: 33,
    fat_g: 13,
    carb_g: 131,
  },
  {
    keys: ["小諸", "親子丼"],
    exclude: ["セット"],
    name: "小諸そば 親子丼",
    kcal: 657,
    protein_g: 28.5,
    fat_g: 15,
    carb_g: 100,
  },
  {
    keys: ["小諸", "ざるそば"],
    name: "小諸そば ざるそば",
    kcal: 309,
    protein_g: 13,
    fat_g: 2.3,
    carb_g: 61,
  },
  {
    keys: ["エクスプロージョン"],
    exclude: ["バー", "クッキー"],
    name: "エクスプロージョン ホエイプロテイン",
    per_100g: { kcal: 393, protein_g: 72, fat_g: 6, carb_g: 13 },
    default_grams: 20,
    gram_means: "protein",
  },
  {
    keys: ["x-plosion"],
    exclude: ["バー", "クッキー"],
    name: "エクスプロージョン ホエイプロテイン",
    per_100g: { kcal: 393, protein_g: 72, fat_g: 6, carb_g: 13 },
    default_grams: 20,
    gram_means: "protein",
  },
  {
    keys: ["ホエイプロテイン"],
    exclude: ["バー", "クッキー", "パンケーキ"],
    name: "ホエイプロテイン",
    per_100g: { kcal: 390, protein_g: 72, fat_g: 6, carb_g: 12 },
    default_grams: 20,
    gram_means: "protein",
  },
  {
    keys: ["プロテイン"],
    exclude: ["バー", "クッキー", "パンケーキ", "パスタ"],
    name: "ホエイプロテイン",
    per_100g: { kcal: 390, protein_g: 72, fat_g: 6, carb_g: 12 },
    default_grams: 20,
    gram_means: "protein",
  },
  {
    keys: ["ゆで卵"],
    name: "ゆで卵",
    per_100g: { kcal: 151, protein_g: 12.5, fat_g: 10.4, carb_g: 0.3 },
    default_grams: 50,
  },
  {
    keys: ["温泉卵"],
    name: "温泉卵",
    per_100g: { kcal: 151, protein_g: 12.2, fat_g: 10.2, carb_g: 0.3 },
    default_grams: 50,
  },
  {
    keys: ["目玉焼き"],
    name: "目玉焼き",
    per_100g: { kcal: 205, protein_g: 14.8, fat_g: 17.6, carb_g: 0.4 },
    default_grams: 50,
  },
  {
    keys: ["いり卵"],
    name: "いり卵",
    per_100g: { kcal: 190, protein_g: 13.3, fat_g: 16.7, carb_g: 0.3 },
    default_grams: 50,
  },
  {
    keys: ["スクランブル"],
    name: "いり卵",
    per_100g: { kcal: 190, protein_g: 13.3, fat_g: 16.7, carb_g: 0.3 },
    default_grams: 50,
  },
  {
    keys: ["卵黄"],
    name: "卵黄",
    per_100g: { kcal: 336, protein_g: 16.5, fat_g: 34.3, carb_g: 0.3 },
    default_grams: 16,
  },
  {
    keys: ["黄身"],
    exclude: ["全卵", "卵白"],
    name: "卵黄",
    per_100g: { kcal: 336, protein_g: 16.5, fat_g: 34.3, carb_g: 0.3 },
    default_grams: 16,
  },
  {
    keys: ["卵白"],
    name: "卵白",
    per_100g: { kcal: 44, protein_g: 10.1, fat_g: 0, carb_g: 0.3 },
    default_grams: 34,
  },
  {
    keys: ["白身"],
    exclude: ["全卵", "卵黄"],
    name: "卵白",
    per_100g: { kcal: 44, protein_g: 10.1, fat_g: 0, carb_g: 0.3 },
    default_grams: 34,
  },
  {
    keys: ["卵"],
    exclude: [
      "卵焼",
      "厚焼",
      "だし巻",
      "サンド",
      "オムレツ",
      "オムライス",
      "親子",
      "天津",
      "目玉",
      "ゆで",
      "いり",
      "スクランブル",
      "卵黄",
      "卵白",
      "黄身",
      "白身",
      "味玉",
      "煮卵",
      "温泉",
    ],
    name: "鶏卵（全卵）",
    per_100g: { kcal: 151, protein_g: 12.2, fat_g: 10.2, carb_g: 0.3 },
    default_grams: 50,
  },
];

/** 日本食品標準成分表の鶏卵Mサイズ可食部。殻付き約60gではない。 */
export const EGG_EDIBLE_G = 50;

const FLUFF = /たっぷり|特選|特製|メガ|プレミアム/g;

export function cleanProductName(name: string): string {
  return name.replace(FLUFF, "").replace(/\s{2,}/g, " ").trim();
}

function normalize(s: string): string {
  return s
    .replace(/\s+/g, "")
    .replace(/蕎麦/g, "そば")
    .replace(/ご飯/g, "ごはん")
    .replace(/たまご/g, "卵")
    .replace(/炒り卵/g, "いり卵")
    .replace(/味玉|煮卵/g, "ゆで卵")
    .replace(/Ｘ/g, "x")
    .toLowerCase();
}

function lookupCatalog(name: string): CatalogEntry | null {
  const n = normalize(name);
  if (/親子丼/.test(n) && /そば|ざる/.test(n) && !/満腹/.test(n)) {
    return CATALOG.find((row) => row.keys.includes("親子丼セット")) ?? null;
  }
  for (const row of CATALOG) {
    if (row.exclude?.some((k) => n.includes(normalize(k)))) continue;
    if (row.keys.every((k) => n.includes(normalize(k)))) return row;
  }
  return null;
}

function round1(n: number) {
  return Math.round(n * 10) / 10;
}

function bumpLargeSoba(item: MealEstimateItem, originalName: string): MealEstimateItem {
  if (!/大盛/.test(originalName)) return item;
  if (!/そば|セット/.test(item.name)) return item;
  return {
    ...item,
    kcal: item.kcal + 140,
    protein_g: round1(item.protein_g + 6),
    fat_g: round1(item.fat_g + 1),
    carb_g: round1(item.carb_g + 28),
  };
}

function fromServing(row: CatalogEntry): MealEstimateItem {
  return {
    name: row.name,
    kcal: row.kcal ?? 0,
    protein_g: row.protein_g ?? 0,
    fat_g: row.fat_g ?? 0,
    carb_g: row.carb_g ?? 0,
    source: "catalog",
  };
}

export function scalePer100g(per100g: Per100g, grams: number, name: string): MealEstimateItem {
  const s = grams / 100;
  const labeled = /\d+(?:\.\d+)?\s*(個|本|枚|杯|切れ|袋|g|ｇ)/.test(name) ? name : `${name} ${grams}g`;
  return {
    name: labeled,
    kcal: Math.round(per100g.kcal * s),
    protein_g: round1(per100g.protein_g * s),
    fat_g: round1(per100g.fat_g * s),
    carb_g: round1(per100g.carb_g * s),
    source: "catalog",
  };
}

export function scaleFromProtein(per100g: Per100g, proteinG: number, name: string): MealEstimateItem {
  const p = per100g.protein_g > 0 ? per100g.protein_g : 72;
  const s = proteinG / p;
  return {
    name: `${name} たんぱく${round1(proteinG)}g`,
    kcal: Math.round(per100g.kcal * s),
    protein_g: round1(proteinG),
    fat_g: round1(per100g.fat_g * s),
    carb_g: round1(per100g.carb_g * s),
    source: "catalog",
  };
}

export function isProteinProduct(name: string): boolean {
  return /プロテイン|サプリ|エクスプロージョン|x-plosion|whey/i.test(name) && !/バー|クッキー|パスタ/.test(name);
}

export function isEggCookedDish(name: string): boolean {
  return /卵焼|たまご焼|厚焼|だし巻|卵サンド|たまごサンド|オムレツ|オムライス|親子丼|天津/.test(name);
}

export function isEggLikeName(name: string): boolean {
  if (isEggCookedDish(name)) return false;
  return /卵|たまご|鶏卵/.test(name);
}

export function isWholeEggName(name: string): boolean {
  return isEggLikeName(name) && !/卵黄|卵白|黄身|白身/.test(name);
}

export function parsePortionFromLabel(label: string): { grams: number | null; count: number | null; unit: string | null } {
  const compact = String(label ?? "").replace(/\s+/g, "");
  const g = compact.match(/(\d+(?:\.\d+)?)(?:g|ｇ)/i);
  if (g) return { grams: Number(g[1]), count: null, unit: null };
  const c = compact.match(/(\d+(?:\.\d+)?)(個|本|枚|杯|切れ|袋)/);
  if (c) return { grams: null, count: Number(c[1]), unit: c[2] };
  const x = compact.match(/[×xX](\d+(?:\.\d+)?)|(\d+(?:\.\d+)?)[×xX]/);
  if (x) return { grams: null, count: Number(x[1] || x[2]), unit: "個" };
  return { grams: null, count: null, unit: null };
}

function countToGrams(itemName: string, count: number, unit: string | null): number | null {
  if (!(count > 0)) return null;
  const u = unit || "個";
  if (isProteinProduct(itemName)) return count * 20;
  if (u === "個" && isEggLikeName(itemName)) return count * EGG_EDIBLE_G;
  if (u === "本" && /バナナ/.test(itemName)) return count * 90;
  if (u === "杯") return count * 200;
  if (u === "枚") return count * 30;
  if (u === "袋" && /納豆/.test(itemName)) return count * 50;
  return null;
}

function isRiceName(name: string): boolean {
  return /白米|ご飯|ごはん|ライス|こめ/.test(name);
}

function dishMatchesItem(itemName: string, menu: string): boolean {
  const n = normalize(itemName);
  const m = normalize(menu);
  if (!n || !m) return false;
  if (n.includes(m) || m.includes(n)) return true;
  if (isEggLikeName(itemName) && isEggLikeName(menu)) return true;
  return isRiceName(itemName) && isRiceName(menu);
}

export function inferEggGramsFromItem(item: MealEstimateItem | undefined, defaultGrams = EGG_EDIBLE_G): number {
  if (!item) return defaultGrams;
  const byProtein = item.protein_g > 0 ? item.protein_g / 6.1 : 0;
  const byKcal = item.kcal > 0 ? item.kcal / 76 : 0;
  const n = byProtein >= 0.75 ? byProtein : byKcal;
  if (n >= 1.4) return Math.max(1, Math.round(n)) * defaultGrams;
  return defaultGrams;
}

function eggDisplayName(name: string, grams: number): string {
  if (isWholeEggName(name) && grams >= EGG_EDIBLE_G && grams % EGG_EDIBLE_G === 0) {
    const base = name.replace(/\s*\d+(?:\.\d+)?\s*(個|g|ｇ).*$/i, "").trim() || name;
    return `${base} ${grams / EGG_EDIBLE_G}個`;
  }
  return name;
}

export function resolveDishGrams(itemName: string, dishes: MealDishGrams[] | undefined): number | null {
  const weighed = (dishes ?? []).filter((d) => d.grams != null && d.grams > 0);
  const weighedHits = weighed.filter((d) => dishMatchesItem(itemName, d.menu));
  if (weighedHits.length === 1) return weighedHits[0].grams;

  const fromName = parsePortionFromLabel(itemName);
  if (fromName.grams != null && fromName.grams > 0) return fromName.grams;

  const counted = (dishes ?? []).filter((d) => d.count != null && d.count > 0);
  const countedHits = counted.filter((d) => dishMatchesItem(itemName, d.menu));
  if (countedHits.length === 1) {
    const grams = countToGrams(itemName, countedHits[0].count ?? 0, countedHits[0].count_unit ?? "個");
    if (grams) return grams;
  }

  if (fromName.count != null && fromName.count > 0) {
    return countToGrams(itemName, fromName.count, fromName.unit);
  }
  return null;
}

function fromCatalog(row: CatalogEntry, grams: number | null, item?: MealEstimateItem): MealEstimateItem {
  if (row.per_100g && row.gram_means === "protein") {
    const proteinG = grams ?? (item && item.protein_g > 0 ? item.protein_g : null) ?? row.default_grams ?? 20;
    return scaleFromProtein(row.per_100g, proteinG, row.name);
  }
  if (row.per_100g) {
    const fallback = row.default_grams ?? 100;
    const g =
      grams ??
      (isWholeEggName(row.name) ? inferEggGramsFromItem(item, fallback) : fallback);
    return scalePer100g(row.per_100g, g, eggDisplayName(row.name, g));
  }
  return fromServing(row);
}

function sumItems(items: MealEstimateItem[]): Pick<MealEstimate, "kcal" | "protein_g" | "fat_g" | "carb_g"> {
  return {
    kcal: Math.round(items.reduce((a, i) => a + i.kcal, 0)),
    protein_g: round1(items.reduce((a, i) => a + i.protein_g, 0)),
    fat_g: round1(items.reduce((a, i) => a + i.fat_g, 0)),
    carb_g: round1(items.reduce((a, i) => a + i.carb_g, 0)),
  };
}

export function applyMealCatalog(estimate: MealEstimate, dishes?: MealDishGrams[]): MealEstimate {
  const originals =
    estimate.item_details.length > 0
      ? estimate.item_details
      : estimate.items.map((name) => ({
          name,
          kcal: 0,
          protein_g: 0,
          fat_g: 0,
          carb_g: 0,
          source: "ai" as const,
        }));
  const joined = originals.map((i) => i.name).join(" ");
  const pairSet =
    originals.length >= 2 &&
    originals.length <= 3 &&
    originals.some((i) => /親子丼/.test(i.name)) &&
    originals.some((i) => /そば|蕎麦|ざる/.test(i.name))
      ? lookupCatalog("親子丼セットそば")
      : null;

  let details: MealEstimateItem[];
  if (pairSet) {
    details = [bumpLargeSoba(fromCatalog(pairSet, resolveDishGrams(joined, dishes)), joined)];
  } else {
    details = originals.map((item) => {
      const cleaned = cleanProductName(item.name) || item.name;
      const hit = lookupCatalog(cleaned);
      if (!hit) return fillItemKcal({ ...item, name: cleaned });
      return bumpLargeSoba(
        fromCatalog(hit, resolveDishGrams(cleaned, dishes) ?? resolveDishGrams(item.name, dishes), item),
        item.name
      );
    });
  }

  const usedCatalog = details.some((d) => d.source === "catalog");
  const usedLabel = details.some((d) => d.source === "label");
  const filledDetails = details.map(fillItemKcal);
  const hasMacros = filledDetails.some((d) => d.kcal > 0 || d.protein_g > 0 || d.fat_g > 0 || d.carb_g > 0);
  const totals = usedCatalog || hasMacros ? sumItems(filledDetails) : estimate;
  const confidence = usedCatalog || usedLabel ? Math.max(estimate.confidence, usedCatalog ? 0.92 : 0.85) : estimate.confidence;
  const extraNote = usedCatalog ? "公開成分表で補正" : usedLabel ? "ラベルの数字を優先" : "";
  return {
    ...estimate,
    kcal: totals.kcal,
    protein_g: totals.protein_g,
    fat_g: totals.fat_g,
    carb_g: totals.carb_g,
    items: filledDetails.map((d) => d.name),
    item_details: filledDetails,
    confidence,
    note: extraNote ? [estimate.note, extraNote].filter(Boolean).join(" / ").slice(0, 240) : estimate.note,
  };
}
