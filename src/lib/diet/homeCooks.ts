import type { MealRemaining } from "../memberMealLogs";

export type HomeCookIngredient = {
  name: string;
  amount: string;
};

export type HomeCookMeal = {
  id: string;
  name: string;
  kcal: number;
  protein_g: number;
  fat_g: number;
  carb_g: number;
  minutes: number;
  howto: string;
  why: string;
  ingredients: HomeCookIngredient[];
  steps: string[];
  cookpadQuery: string;
  youtubeQuery: string;
  youtubeId?: string;
  youtubeTitle?: string;
  imageUrl?: string;
  imageAlt: string;
};

type HomeCookRecipe = Omit<HomeCookMeal, "why">;

const HOME_COOKS: HomeCookRecipe[] = [
  {
    id: "chicken-microwave-rice",
    name: "鶏むねレンジ＋ご飯150g＋野菜",
    kcal: 470,
    protein_g: 42,
    fat_g: 7,
    carb_g: 52,
    minutes: 12,
    howto: "鶏むね150gに塩胡椒、ラップして600Wで4分。キャベツをレンジし、ご飯は普通盛り。",
    ingredients: [
      { name: "鶏むね肉", amount: "150g" },
      { name: "ご飯", amount: "150g" },
      { name: "キャベツ", amount: "2〜3枚" },
      { name: "塩・こしょう", amount: "少々" },
    ],
    steps: [
      "鶏むねはフォークで全体に穴をあけ、塩こしょうする。",
      "耐熱皿に乗せ、ふんわりラップして600Wで4分。そのまま2分置いて余熱を使う。",
      "キャベツはざく切りにしてラップし、600Wで1分。",
      "ご飯と野菜を盛り、鶏肉を食べやすい大きさに切って乗せる。",
    ],
    cookpadQuery: "鶏むね レンジ しっとり",
    youtubeQuery: "鶏むね肉 レンジ 簡単",
    youtubeId: "VO4OnrNU2bc",
    youtubeTitle: "レンジでしっとり鶏むね",
    imageAlt: "レンジで作る鶏むねとご飯",
  },
  {
    id: "natto-egg-rice",
    name: "卵2個＋納豆ごはん",
    kcal: 420,
    protein_g: 24,
    fat_g: 14,
    carb_g: 48,
    minutes: 8,
    howto: "ご飯150gに納豆1パック、卵は焼きでも生でも可。醤油は小さじ1まで。",
    ingredients: [
      { name: "ご飯", amount: "150g" },
      { name: "納豆", amount: "1パック" },
      { name: "卵", amount: "2個" },
      { name: "醤油", amount: "小さじ1まで" },
    ],
    steps: [
      "卵は好みで、目玉焼きか温泉卵にする。生で乗せるなら黄身だけでも可。",
      "納豆は付属のタレを全部は使わず、醤油は小さじ1までに抑える。",
      "ご飯に納豆をのせ、卵を乗せて混ぜながら食べる。",
    ],
    cookpadQuery: "納豆ご飯 卵",
    youtubeQuery: "納豆ご飯 卵 簡単",
    youtubeId: "UFxnFIzVk68",
    youtubeTitle: "納豆・卵の朝ごはん",
    imageAlt: "納豆と卵のごはん",
  },
  {
    id: "saba-tofu-rice",
    name: "さば缶＋冷奴＋ご飯少なめ",
    kcal: 430,
    protein_g: 36,
    fat_g: 18,
    carb_g: 32,
    minutes: 5,
    howto: "さば水煮缶1缶と豆腐半丁。ご飯は100g。汁はかけすぎない。",
    ingredients: [
      { name: "さば水煮缶", amount: "1缶" },
      { name: "木綿豆腐", amount: "半丁" },
      { name: "ご飯", amount: "100g" },
      { name: "ねぎ・しょうが", amount: "お好み" },
      { name: "醤油またはポン酢", amount: "小さじ1" },
    ],
    steps: [
      "豆腐は水気を切り、食べやすい大きさに切る。",
      "さば缶は汁を少し切ってほぐし、豆腐に乗せる。",
      "醤油やポン酢は小さじ1まで。ねぎがあれば散らす。",
      "ご飯は少なめ（100g）で、さばのたんぱくをメインにする。",
    ],
    cookpadQuery: "さば缶 冷奴",
    youtubeQuery: "さば缶 冷奴 簡単",
    youtubeId: "Bd7y9Cy6o3g",
    youtubeTitle: "さば缶のレンジおかず",
    imageAlt: "さば缶と冷奴",
  },
  {
    id: "tuna-cabbage-rice",
    name: "ツナ缶＋キャベツ炒め＋ご飯",
    kcal: 390,
    protein_g: 28,
    fat_g: 10,
    carb_g: 46,
    minutes: 10,
    howto: "ツナは油を切る。キャベツを少量の油で炒めてご飯150gと合わせる。",
    ingredients: [
      { name: "ツナ缶（油を切る）", amount: "1缶" },
      { name: "キャベツ", amount: "1/6玉" },
      { name: "ご飯", amount: "150g" },
      { name: "サラダ油", amount: "小さじ1" },
      { name: "醤油", amount: "小さじ1" },
    ],
    steps: [
      "ツナ缶は油をしっかり切る。ノンオイルならそのままでよい。",
      "キャベツはざく切り。フライパンに油小さじ1で中火に炒める。",
      "しんなりしたらツナと醤油を加え、さっと混ぜる。",
      "ご飯にのせて完成。マヨネーズは使わない。",
    ],
    cookpadQuery: "ツナ缶 キャベツ炒め",
    youtubeQuery: "キャベツ ツナ缶 炒め 簡単",
    youtubeId: "Eig93i_b21g",
    youtubeTitle: "キャベツとツナ缶の炒め",
    imageAlt: "ツナとキャベツ炒め",
  },
  {
    id: "salmon-miso-rice",
    name: "鮭の塩焼き＋味噌汁＋ご飯少なめ",
    kcal: 480,
    protein_g: 32,
    fat_g: 12,
    carb_g: 50,
    minutes: 15,
    howto: "塩鮭1切を焼く。味噌汁は具だくさん。ご飯は100〜130g。",
    ingredients: [
      { name: "塩鮭", amount: "1切れ" },
      { name: "ご飯", amount: "100〜130g" },
      { name: "味噌", amount: "小さじ2" },
      { name: "豆腐またはわかめ", amount: "適量" },
    ],
    steps: [
      "鮭の水気を拭き、フライパンに皮目を下にして弱めの中火で焼く。",
      "皮がパリッとしたら裏返し、中まで火が通るまで3分ほど。",
      "味噌汁は豆腐やわかめを入れて具だくさんに。",
      "ご飯は100〜130g。塩鮭の塩分があるので醤油は足さない。",
    ],
    cookpadQuery: "鮭の塩焼き",
    youtubeQuery: "鮭の塩焼き フライパン 簡単",
    youtubeId: "U34ELvij50U",
    youtubeTitle: "鮭の塩焼きの作り方",
    imageAlt: "焼き鮭定食",
  },
  {
    id: "oyakodon-light",
    name: "鶏むねと卵の親子丼風（ご飯少なめ）",
    kcal: 510,
    protein_g: 40,
    fat_g: 12,
    carb_g: 55,
    minutes: 15,
    howto: "鶏むね100gを煮て溶き卵1個。ご飯は130g。みりん・砂糖は控えめ。",
    ingredients: [
      { name: "鶏むね肉", amount: "100g" },
      { name: "卵", amount: "1個" },
      { name: "ご飯", amount: "130g" },
      { name: "玉ねぎ", amount: "1/8個" },
      { name: "醤油", amount: "小さじ1" },
      { name: "みりん", amount: "小さじ1（控えめ）" },
    ],
    steps: [
      "鶏むねは薄切り。玉ねぎは薄切りにする。",
      "小さなフライパンに水50ml、醤油・みりんを入れて煮立たせ、鶏肉と玉ねぎを入れる。",
      "火が通ったら溶き卵を回し入れ、半熟で火を止める。砂糖は使わない。",
      "少なめのご飯にのせる。",
    ],
    cookpadQuery: "鶏むね 親子丼",
    youtubeQuery: "電子レンジ 親子丼 簡単",
    youtubeId: "6l70oTWfQKg",
    youtubeTitle: "レンジで親子丼",
    imageAlt: "親子丼風ごはん",
  },
  {
    id: "tofu-hamburg",
    name: "豆腐ハンバーグ＋サラダ",
    kcal: 320,
    protein_g: 26,
    fat_g: 12,
    carb_g: 18,
    minutes: 20,
    howto: "木綿豆腐半丁と鶏ひき100gを混ぜて焼く。ソースは醤油とポン酢。",
    ingredients: [
      { name: "木綿豆腐", amount: "半丁" },
      { name: "鶏ひき肉", amount: "100g" },
      { name: "塩・こしょう", amount: "少々" },
      { name: "サラダ野菜", amount: "適量" },
      { name: "ポン酢", amount: "小さじ1" },
    ],
    steps: [
      "豆腐はキッチンペーパーで包み、しっかり水気を切る。",
      "鶏ひき肉と塩こしょうを混ぜ、小判型にまとめる。",
      "油を薄く引いたフライパンで両面を焼き、蓋をして弱火で4分ほど蒸し焼き。",
      "ポン酢をかけ、サラダを添える。ケチャップは使わない。",
    ],
    cookpadQuery: "豆腐ハンバーグ 鶏ひき",
    youtubeQuery: "豆腐ハンバーグ 鶏ひき 簡単",
    youtubeId: "63spvQOYI_4",
    youtubeTitle: "豆腐チキンハンバーグ",
    imageAlt: "豆腐ハンバーグとサラダ",
  },
  {
    id: "protein-shake",
    name: "プロテイン1杯",
    kcal: 90,
    protein_g: 20,
    fat_g: 1,
    carb_g: 3,
    minutes: 2,
    howto: "水または無脂肪乳で溶く。間食や食後のたんぱく足しに。",
    ingredients: [
      { name: "プロテインパウダー", amount: "1杯（約20gたんぱく）" },
      { name: "水または無脂肪乳", amount: "200ml" },
    ],
    steps: [
      "シェイカーに水（または無脂肪乳）を先に入れる。",
      "粉を加えてよく振る。粉が先だと溶け残りやすい。",
      "間食や食後のたんぱく足しに。甘いジュースでは溶かさない。",
    ],
    cookpadQuery: "プロテイン シェイク",
    youtubeQuery: "プロテイン シェイク 作り方",
    imageUrl:
      "https://images.unsplash.com/photo-1593095948071-474c5cc2989d?auto=format&fit=crop&w=800&q=80",
    imageAlt: "プロテインシェイク",
  },
  {
    id: "salad-eggs",
    name: "サラダ＋ゆで卵2個",
    kcal: 220,
    protein_g: 14,
    fat_g: 12,
    carb_g: 8,
    minutes: 12,
    howto: "レタスとトマトにゆで卵。ドレッシングは小さじ1。残りが少ない日向け。",
    ingredients: [
      { name: "卵", amount: "2個" },
      { name: "レタス", amount: "適量" },
      { name: "トマト", amount: "1/2個" },
      { name: "ドレッシング", amount: "小さじ1" },
    ],
    steps: [
      "卵は沸騰してから8分ゆで、冷水に取って殻をむく。",
      "レタスとトマトを食べやすい大きさに切る。",
      "ゆで卵を半分に切り、野菜にのせる。",
      "ドレッシングは小さじ1まで。マヨネーズは使わない。",
    ],
    cookpadQuery: "ゆで卵 サラダ",
    youtubeQuery: "ゆで卵 サラダ 簡単",
    youtubeId: "PYGNfjeXe9I",
    youtubeTitle: "ゆで卵入りサラダ",
    imageAlt: "サラダとゆで卵",
  },
  {
    id: "chicken-tomato",
    name: "鶏むねのトマト煮",
    kcal: 280,
    protein_g: 38,
    fat_g: 6,
    carb_g: 12,
    minutes: 18,
    howto: "鶏むね150gをカットトマトで煮る。塩胡椒だけ。ご飯を足すなら100gまで。",
    ingredients: [
      { name: "鶏むね肉", amount: "150g" },
      { name: "カットトマト缶", amount: "1/2缶" },
      { name: "塩・こしょう", amount: "少々" },
      { name: "オリーブオイル", amount: "小さじ1" },
    ],
    steps: [
      "鶏むねは一口大に切り、塩こしょうする。",
      "フライパンに油小さじ1、鶏肉の表面に火が通るまで焼く。",
      "カットトマトを加え、蓋をして弱火で5分。煮すぎない。",
      "味を見て塩を足す。ご飯を合わせるなら100gまで。",
    ],
    cookpadQuery: "鶏むね トマト煮",
    youtubeQuery: "鶏むね トマト煮込み 簡単",
    youtubeId: "xopCvFQzkYc",
    youtubeTitle: "鶏むねのトマト煮込み",
    imageAlt: "鶏むねのトマト煮",
  },
];

function scoreHomeCook(meal: HomeCookRecipe, remaining: MealRemaining | null) {
  if (!remaining) return meal.protein_g * 2 - meal.fat_g;
  const cap = remaining.kcal < 0 ? 140 : Math.max(120, remaining.kcal);
  const over = Math.max(0, meal.kcal - cap);
  const proteinNeed = remaining.protein_g;
  const proteinHit = proteinNeed > 12 ? Math.min(meal.protein_g, proteinNeed) : meal.protein_g * 0.4;
  const lightBonus = remaining.kcal < 280 && meal.kcal <= 250 ? 20 : 0;
  return proteinHit * 4 - over * 0.14 - meal.fat_g * 0.5 + lightBonus;
}

function whyOf(meal: HomeCookRecipe, remaining: MealRemaining | null) {
  if (!remaining) return "たんぱくを取りやすい定番";
  if (remaining.kcal < 0) return "目標超過の日はこれ以上足さない前提の最小限";
  if (remaining.kcal < 280 && meal.kcal <= remaining.kcal + 40) {
    return `残り約${Math.round(remaining.kcal)}kcalに収まる`;
  }
  if (remaining.protein_g > 20 && meal.protein_g >= 20) {
    return `たんぱく質を約${meal.protein_g}g足せる`;
  }
  return `残り ${Math.round(remaining.kcal)}kcal の目安メニュー`;
}

export function suggestHomeCooks(remaining: MealRemaining | null, limit = 3): HomeCookMeal[] {
  return [...HOME_COOKS]
    .map((meal) => ({ meal, score: scoreHomeCook(meal, remaining) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ meal }) => ({ ...meal, why: whyOf(meal, remaining) }));
}

export function cookpadSearchUrl(query: string) {
  return `https://cookpad.com/jp/search/${encodeURIComponent(query)}`;
}

export function youtubeSearchUrl(query: string) {
  return `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
}

export function youtubeWatchUrl(id: string) {
  return `https://www.youtube.com/watch?v=${id}`;
}

export function youtubeThumbUrl(id: string) {
  return `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
}

export function homeCookCoverUrl(meal: Pick<HomeCookMeal, "youtubeId" | "imageUrl">) {
  if (meal.youtubeId) return youtubeThumbUrl(meal.youtubeId);
  return meal.imageUrl ?? null;
}
