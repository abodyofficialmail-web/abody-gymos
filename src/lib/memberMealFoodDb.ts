/** 日本食品標準成分表（八訂）増補2023年 から引用。100gあたりのエネルギー・PFC。 */
import foodsJson from "@/lib/data/mext-foods-pfc.json";
import { fillItemKcal, type MealEstimate, type MealEstimateItem } from "@/lib/memberMealEstimate";
import {
  inferEggGramsFromItem,
  isEggCookedDish,
  isWholeEggName,
  resolveDishGrams,
  scalePer100g,
  type MealDishGrams,
} from "@/lib/memberMealCatalog";

type MextFood = { n: string; k: number; p: number; f: number; c: number };

const FOODS = foodsJson as MextFood[];

const ALIASES: Array<{ keys: string[]; name: string; grams: number }> = [
  { keys: ["鶏むね", "鶏胸"], name: "にわとり 若どり・主品目 むね 皮なし 生", grams: 100 },
  { keys: ["ささみ", "ササミ"], name: "にわとり 若どり・副品目 ささみ 生", grams: 100 },
  { keys: ["鶏もも"], name: "にわとり 若どり・主品目 もも 皮なし 生", grams: 100 },
  { keys: ["白米", "ご飯", "ごはん", "ライス"], name: "こめ 水稲めし 精白米 うるち米", grams: 150 },
  { keys: ["玄米"], name: "こめ 水稲めし 玄米", grams: 150 },
  { keys: ["おにぎり"], name: "こめ うるち米製品 おにぎり", grams: 110 },
  { keys: ["卵", "たまご", "鶏卵"], name: "鶏卵 全卵 生", grams: 50 },
  { keys: ["ゆで卵", "ゆでたまご", "味玉", "煮卵"], name: "鶏卵 全卵 ゆで", grams: 50 },
  { keys: ["温泉卵"], name: "鶏卵 全卵 生", grams: 50 },
  { keys: ["目玉焼き"], name: "鶏卵 全卵 目玉焼き", grams: 50 },
  { keys: ["いり卵", "スクランブル"], name: "鶏卵 全卵 いり", grams: 50 },
  { keys: ["卵黄", "黄身"], name: "鶏卵 卵黄 生", grams: 16 },
  { keys: ["卵白", "白身"], name: "鶏卵 卵白 生", grams: 34 },
  { keys: ["木綿豆腐", "豆腐"], name: "だいず 豆腐・油揚げ類 木綿豆腐", grams: 150 },
  { keys: ["納豆"], name: "だいず 納豆類 糸引き納豆", grams: 50 },
  { keys: ["バナナ"], name: "バナナ 生", grams: 90 },
  { keys: ["りんご", "リンゴ"], name: "りんご 皮つき 生", grams: 150 },
  { keys: ["牛乳"], name: "（液状乳類） 普通牛乳", grams: 200 },
  { keys: ["ヨーグルト"], name: "（発酵乳・乳酸菌飲料） ヨーグルト 全脂無糖", grams: 100 },
  { keys: ["食パン", "トースト"], name: "こむぎ パン類 角形食パン 食パン", grams: 60 },
  { keys: ["うどん"], name: "こむぎ うどん・そうめん類 うどん ゆで", grams: 250 },
  { keys: ["そば", "蕎麦"], name: "そば そば ゆで", grams: 250 },
  { keys: ["パスタ", "スパゲッティ"], name: "こむぎ マカロニ・スパゲッティ類 マカロニ・スパゲッティ ゆで", grams: 200 },
  { keys: ["ブロッコリー"], name: "ブロッコリー 花序 ゆで", grams: 80 },
  { keys: ["アボカド"], name: "アボカド 生", grams: 70 },
  { keys: ["サーモン", "鮭", "さけ"], name: "（さけ・ます類） しろさけ 生", grams: 80 },
  { keys: ["まぐろ赤身", "マグロ赤身"], name: "（まぐろ類） くろまぐろ 天然 赤身 生", grams: 80 },
  { keys: ["まぐろ", "マグロ"], name: "（まぐろ類） きはだ 生", grams: 80 },
  { keys: ["マヨネーズ", "マヨ"], name: "（ドレッシング類） 半固体状ドレッシング マヨネーズ 全卵型", grams: 12 },
  { keys: ["ハンバーグ"], name: "洋風料理 ハンバーグステーキ類 合いびきハンバーグ", grams: 150 },
  { keys: ["餃子", "ぎょうざ"], name: "中国料理 点心類 ぎょうざ", grams: 80 },
  { keys: ["ビーフカレー"], name: "洋風料理 カレー類 ビーフカレー", grams: 300 },
  { keys: ["チキンカレー"], name: "洋風料理 カレー類 チキンカレー", grams: 300 },
  { keys: ["カレー"], name: "洋風料理 カレー類 ポークカレー", grams: 300 },
];

const SYNONYM: Array<[RegExp, string]> = [
  [/鶏胸肉|鶏むね肉|鶏胸/g, "鶏むね"],
  [/鶏肉/g, "にわとり"],
  [/ご飯|ごはん|ライス/g, "白米"],
  [/たまご/g, "卵"],
];

function normalize(s: string): string {
  return s
    .replace(/\s+/g, "")
    .replace(/　/g, "")
    .replace(/蕎麦/g, "そば")
    .replace(/ご飯/g, "ごはん")
    .toLowerCase();
}

function byName(name: string): MextFood | null {
  return FOODS.find((f) => f.n === name) ?? null;
}

function defaultGramsFor(food: MextFood): number {
  if (/めし|おにぎり/.test(food.n)) return 150;
  if (/ゆで/.test(food.n) && /うどん|そば|めん|スパゲッティ/.test(food.n)) return 250;
  if (/牛乳/.test(food.n)) return 200;
  if (/豆腐/.test(food.n)) return 150;
  if (/全卵/.test(food.n) && !/加糖|乾燥|缶詰/.test(food.n)) return 50;
  if (/バナナ/.test(food.n)) return 90;
  return 100;
}

function scoreFood(query: string, food: MextFood): number {
  const q = normalize(query);
  const n = normalize(food.n);
  if (!q || q.length < 2) return 0;
  if (!n.includes(q) && !q.split(/[+と＆]/).every((t) => t && n.includes(t))) {
    const tokens = query.replace(/[・、,]/g, " ").split(/\s+/).filter((t) => t.length >= 2);
    if (!tokens.length || !tokens.every((t) => n.includes(normalize(t)))) return 0;
  }
  let score = 40;
  if (n.includes(q)) score += Math.min(40, q.length * 3);
  if (/生$/.test(food.n) || food.n.includes(" 生")) score += 8;
  if (food.n.includes("皮なし")) score += 10;
  if (food.n.includes("めし") && /ごはん|ご飯|白米|ライス/.test(query)) score += 20;
  if (food.n.includes("ゆで") && /うどん|そば|パスタ/.test(query)) score += 12;
  if (/乾|粉$|玄穀|穀粒|缶詰|油いため|皮つき|濃縮/.test(food.n) && !/乾|粉|缶|皮つき/.test(query)) score -= 25;
  if (/ハンバーグ/.test(food.n) && /ステーキ/.test(query) && !/ハンバーグ/.test(query)) score -= 40;
  score -= Math.min(20, food.n.length / 8);
  return score;
}

function aliasHits(query: string, key: string): boolean {
  const n = normalize(query);
  const k = normalize(key);
  if (!n || !k) return false;
  if (n === k) return true;
  if (!n.includes(k) || k.length < 2) return false;
  const extra = n.replace(k, "");
  if (!extra) return true;
  if (/^(肉|類|生|ゆで)?[\d.]*(?:[×xX][\d.]+)?(?:個|本|枚|杯|切れ|袋|g|ｇ)?$/.test(extra)) return true;
  return extra.length <= 1;
}

function lookupAlias(query: string): { food: MextFood; grams: number } | null {
  const n = normalize(query);
  const ranked = ALIASES.flatMap((row) =>
    row.keys.filter((k) => aliasHits(n, k)).map((k) => ({ row, len: normalize(k).length }))
  ).sort((a, b) => b.len - a.len);
  const hit = ranked[0]?.row;
  if (!hit) return null;
  const food = byName(hit.name);
  if (!food) return null;
  return { food, grams: hit.grams };
}

export function lookupMextFood(rawName: string): { food: MextFood; grams: number; label: string } | null {
  const name = SYNONYM.reduce((s, [re, to]) => s.replace(re, to), rawName).trim();
  if (!name || /プロテイン|サプリ|エクスプロージョン/.test(name)) return null;
  const aliased = isEggCookedDish(name) ? null : lookupAlias(name);
  if (aliased) {
    return { food: aliased.food, grams: aliased.grams, label: name.replace(/\s+/g, "") };
  }
  let best: { food: MextFood; score: number } | null = null;
  for (const food of FOODS) {
    const score = scoreFood(name, food);
    if (score < 48) continue;
    if (!best || score > best.score) best = { food, score };
  }
  if (!best) return null;
  return { food: best.food, grams: defaultGramsFor(best.food), label: best.food.n };
}

function mextPer100(food: MextFood): { kcal: number; protein_g: number; fat_g: number; carb_g: number } {
  const carb = /鶏卵/.test(food.n) && !/加糖/.test(food.n) ? Math.min(food.c, 0.5) : food.c;
  if (food.n === "鶏卵 全卵 生") return { kcal: 151, protein_g: 12.2, fat_g: 10.2, carb_g: 0.3 };
  if (food.n === "鶏卵 全卵 ゆで") return { kcal: 151, protein_g: 12.5, fat_g: 10.4, carb_g: 0.3 };
  return { kcal: food.k, protein_g: food.p, fat_g: food.f, carb_g: carb };
}

export function mextItemFromName(name: string, dishes?: MealDishGrams[], item?: MealEstimateItem): MealEstimateItem | null {
  const hit = lookupMextFood(name);
  if (!hit) return null;
  const resolved = resolveDishGrams(name, dishes);
  const grams =
    resolved ??
    (isWholeEggName(name) && item ? inferEggGramsFromItem(item, hit.grams) : hit.grams);
  return scalePer100g(mextPer100(hit.food), grams, hit.label || hit.food.n);
}

export function applyMextFoods(estimate: MealEstimate, dishes?: MealDishGrams[]): MealEstimate {
  const source = estimate.item_details.length
    ? estimate.item_details
    : estimate.items.map((name) => fillItemKcal({ name, kcal: 0, protein_g: 0, fat_g: 0, carb_g: 0, source: "ai" }));
  let changed = false;
  const details = source.map((item) => {
    if (item.source === "catalog" || item.source === "label") return item;
    const next = mextItemFromName(item.name, dishes, item);
    if (!next) return item;
    changed = true;
    return next;
  });
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
    confidence: Math.max(estimate.confidence, 0.9),
    note: [estimate.note, "食品成分表で補正"].filter(Boolean).join(" / ").slice(0, 240),
  };
}

export const MEXT_FOOD_COUNT = FOODS.length;
