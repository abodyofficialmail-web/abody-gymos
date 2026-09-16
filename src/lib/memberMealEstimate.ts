export type MealEstimateItem = {
  name: string;
  kcal: number;
  protein_g: number;
  fat_g: number;
  carb_g: number;
  source: "label" | "catalog" | "ai";
};

export type MealEstimate = {
  kcal: number;
  protein_g: number;
  fat_g: number;
  carb_g: number;
  alcohol_g: number | null;
  items: string[];
  item_details: MealEstimateItem[];
  confidence: number;
  note: string;
};

export type MealImageInput = {
  base64: string;
  mimeType: string;
};

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

function round1(n: number) {
  return Math.round(n * 10) / 10;
}

export function kcalFromMacros(proteinG: number, fatG: number, carbG: number, alcoholG = 0) {
  return proteinG * 4 + fatG * 9 + carbG * 4 + alcoholG * 7;
}

export function fillItemKcal(item: MealEstimateItem): MealEstimateItem {
  const implied = kcalFromMacros(item.protein_g, item.fat_g, item.carb_g);
  if (implied <= 0) return item;
  if (item.kcal > 0) return item;
  return { ...item, kcal: Math.round(implied) };
}

function itemNameOf(raw: unknown): string {
  if (typeof raw === "string") return raw.trim();
  if (!raw || typeof raw !== "object") return "";
  const o = raw as Record<string, unknown>;
  return String(o.name ?? o.menu ?? o.label ?? o.product ?? "").trim();
}

function numOrNull(raw: unknown): number | null {
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function withPortionInName(name: string, raw: Record<string, unknown>): string {
  if (/\d+(?:\.\d+)?\s*(個|本|枚|杯|切れ|袋|g|ｇ)/.test(name) || /[×xX]\s*\d+/.test(name)) return name;
  const grams = numOrNull(raw.grams ?? raw.gram);
  if (grams != null && grams > 0) return `${name} ${Math.round(grams)}g`;
  const count = numOrNull(raw.count ?? raw.qty);
  if (count == null || count <= 0) return name;
  const unit = String(raw.count_unit ?? raw.unit ?? "個").trim();
  const ok = ["個", "本", "枚", "杯", "切れ", "袋"].includes(unit) ? unit : "個";
  return `${name}${count}${ok}`;
}

function parseEstimateItems(raw: unknown): MealEstimateItem[] {
  if (!Array.isArray(raw)) return [];
  const out: MealEstimateItem[] = [];
  for (const row of raw.slice(0, 16)) {
    const baseName = itemNameOf(row);
    if (!baseName) continue;
    if (!row || typeof row !== "object") {
      out.push({ name: baseName, kcal: 0, protein_g: 0, fat_g: 0, carb_g: 0, source: "ai" });
      continue;
    }
    const o = row as Record<string, unknown>;
    const name = withPortionInName(baseName, o);
    const labelKcal = numOrNull(o.label_kcal);
    const labelP = numOrNull(o.label_protein_g);
    const labelF = numOrNull(o.label_fat_g);
    const labelC = numOrNull(o.label_carb_g);
    const rawKcal = numOrNull(o.kcal);
    const k = (labelKcal != null && labelKcal > 0 ? labelKcal : null) ?? (rawKcal != null && rawKcal > 0 ? rawKcal : 0);
    const p = labelP ?? numOrNull(o.protein_g ?? o.protein) ?? 0;
    const f = labelF ?? numOrNull(o.fat_g ?? o.fat) ?? 0;
    const c = labelC ?? numOrNull(o.carb_g ?? o.carbs ?? o.carbohydrate_g) ?? 0;
    const fromLabel =
      (labelKcal != null && labelKcal > 0) ||
      (labelP != null && labelF != null && labelC != null && labelP + labelF + labelC > 0);
    const sourceRaw = String(o.source ?? "");
    const source: MealEstimateItem["source"] =
      fromLabel || sourceRaw === "label" ? "label" : sourceRaw === "catalog" ? "catalog" : "ai";
    out.push(
      fillItemKcal({
        name,
        kcal: k,
        protein_g: p,
        fat_g: f,
        carb_g: c,
        source,
      })
    );
  }
  return out;
}

export function sanitizeMealEstimate(raw: Partial<MealEstimate> & { items?: unknown; item_details?: unknown } | null | undefined): MealEstimate | null {
  if (!raw) return null;
  const details = parseEstimateItems(
    Array.isArray(raw.items) && raw.items.length ? raw.items : raw.item_details
  );
  const names = details.map((d) => d.name);
  const filled = details.map(fillItemKcal);
  const fromItems = filled.some((d) => d.kcal > 0 || d.protein_g > 0 || d.fat_g > 0 || d.carb_g > 0);
  const protein = fromItems ? filled.reduce((a, d) => a + d.protein_g, 0) : Number(raw.protein_g);
  const fat = fromItems ? filled.reduce((a, d) => a + d.fat_g, 0) : Number(raw.fat_g);
  const carb = fromItems ? filled.reduce((a, d) => a + d.carb_g, 0) : Number(raw.carb_g);
  let kcal = fromItems ? Math.round(filled.reduce((a, d) => a + d.kcal, 0)) : Math.round(Number(raw.kcal));
  if (![kcal, protein, fat, carb].every((n) => Number.isFinite(n))) return null;
  const alcohol =
    raw.alcohol_g == null || !Number.isFinite(Number(raw.alcohol_g)) ? 0 : clamp(round1(Number(raw.alcohol_g)), 0, 200);
  const fromMacros = kcalFromMacros(protein, fat, carb, alcohol);
  const trustPrinted = filled.some((d) => d.source === "label" || d.source === "catalog");
  if (Number.isFinite(fromMacros) && fromMacros > 0 && kcal <= 0) {
    kcal = Math.round(fromMacros);
  } else if (
    !trustPrinted &&
    Number.isFinite(fromMacros) &&
    fromMacros > 0 &&
    Math.abs(kcal - fromMacros) > Math.max(25, fromMacros * 0.2)
  ) {
    kcal = Math.round(fromMacros);
  }
  return {
    kcal: clamp(kcal, 0, 5000),
    protein_g: clamp(round1(protein), 0, 400),
    fat_g: clamp(round1(fat), 0, 400),
    carb_g: clamp(round1(carb), 0, 800),
    alcohol_g: alcohol > 0 ? alcohol : raw.alcohol_g == null ? null : 0,
    items: names.slice(0, 16),
    item_details: filled.map((d) => ({
      ...d,
      kcal: clamp(Math.round(d.kcal), 0, 5000),
      protein_g: clamp(round1(d.protein_g), 0, 400),
      fat_g: clamp(round1(d.fat_g), 0, 400),
      carb_g: clamp(round1(d.carb_g), 0, 800),
    })),
    confidence: clamp(Number(raw.confidence ?? (names.length ? 0.6 : 0.3)), 0, 1),
    note: String(raw.note ?? "").trim().slice(0, 240),
  };
}

const SYSTEM_PROMPT = [
  "あなたは日本の管理栄養士です。食事写真と会員入力から、写っている料理・市販品を特定し、カロリーとPFCを推定します。JSONのみ返してください。",
  "写真に写る食品はすべて列挙する（セット・複数パック・副菜・飲み物・スープも含む）。写っていないものは足さない。",
  "商品名の規則: ラベルに書いてある文字をそのまま使う。店名が読めれば先頭に付ける。ラベルに無い形容詞は付けない（たっぷり、特選、中巻、大盛り、メガ などは文字が無いなら禁止）。読めなければ短い一般名（海鮮丼、鉄火太巻、ざるそば）。",
  "name には分量を必ず入れる。例: ゆで卵2個、白米150g、鶏むね200g。count と grams も数値で入れる。",
  "コンビニ・スーパー・外食チェーンは公開されている栄養成分を優先する。小諸そばの親子丼セットそばは約768kcal。ざるそばは約309kcal・脂質約2g。親子丼単品でも脂質は約15g。ミニ丼セットで脂質30gはありえない。",
  "セットは構成品ごとに分ける（親子丼とそばは別アイテム）。複数パックも別アイテム。",
  "揚げ物・マヨ・クリームがなければ脂質を盛らない。そば・うどん・刺身・普通の丼は脂質を控えめに。",
  "丼+麺のセットはご飯と麺の炭水化物を両方入れる。",
  "卵の基準（成分表）: 鶏卵M1個は可食部約50g。殻付き60gを可食部にしない。生・ゆで1個は約76kcal・たんぱく6.1g・脂質5.1g・糖質0.2g。2個なら2倍。写真の個数を数えて name に入れる。",
  "卵に糖質はほとんど無い。1個で炭水化物5gは誤り。卵焼き・だし巻き・オムライスは生卵1個に置き換えない。目玉焼きは油で脂質が生より多い。",
  "items は配列。各要素は {\"name\":\"ラベル通りの商品名と分量\",\"count\":個数またはnull,\"grams\":グラムまたはnull,\"kcal\":整数,\"protein_g\":小数,\"fat_g\":小数,\"carb_g\":小数,\"label_kcal\":ラベルのカロリーまたはnull}。空配列は禁止。",
  "パックや成分表示にカロリー・PFCが書いてあれば label_kcal / label_protein_g / label_fat_g / label_carb_g に入れ、推測で上書きしない。",
  "合計の kcal, protein_g, fat_g, carb_g は items の合計と一致させる。",
  "kcal は protein_g*4 + fat_g*9 + carb_g*4 + alcohol_g*7。PFCがあるのに kcal が 0 は禁止。",
  "プロテインのグラムはたんぱく質量（粉末は測らない）。ホエイはたんぱく1gあたり約5.5kcal。たんぱく15gなら約82kcal・脂質約1g。",
  "グラム・個数・盛りが入力されていれば量はそれを正とする。指定がなければ写真の見た目と、その店・商品の一般的な分量。",
  "酒があれば alcohol_g。confidence は 0〜1。ラベルが読めない・量が不明なら下げる。note は短い日本語。",
].join("");

export async function estimateMealFromPhoto(params: {
  imageBase64?: string | null;
  mimeType?: string | null;
  images?: MealImageInput[];
  note?: string | null;
  slotLabel?: string;
  eatenTime?: string | null;
  dishesHint?: string | null;
}): Promise<{ ok: true; estimate: MealEstimate } | { ok: false; error: string }> {
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key) return { ok: false, error: "食事の解析キーが未設定です" };

  const model = process.env.OPENAI_MEAL_MODEL?.trim() || "gpt-4o";
  const images: MealImageInput[] = (params.images?.length
    ? params.images
    : params.imageBase64 && params.mimeType
      ? [{ base64: params.imageBase64, mimeType: params.mimeType }]
      : []
  ).filter((img) => img.base64 && img.mimeType);
  const extras = [
    params.eatenTime?.trim() ? `食事時刻: ${params.eatenTime.trim()}` : "",
    params.dishesHint?.trim()
      ? `会員が入力したメニューと量: ${params.dishesHint.trim()}。グラム・個数・盛りがあれば量はそれを優先。写真があるときは商品名・料理名は写真のラベルと見た目を優先。`
      : "",
    params.note?.trim() ? `補足: ${params.note.trim()}` : "",
  ]
    .filter(Boolean)
    .join(" ");
  if (images.length === 0 && !params.dishesHint?.trim()) {
    return { ok: false, error: "写真かメニューのどちらかを入力してください" };
  }
  const userContent: Array<Record<string, unknown>> = [
    {
      type: "text",
      text: images.length
        ? `写真は${images.length}枚です。まずラベルの文字を読み、書いてある商品名だけを使って品目を列挙してください。ラベルに無い言葉は足さない。卵やパックは個数を数える。そのあと品目ごとの栄養と合計をJSONで返してください。食事区分: ${params.slotLabel ?? "食事"}。${extras}`.trim()
        : `写真はありません。次のメニューと量から、この食事（${params.slotLabel ?? "食事"}）のカロリーとPFCを推定してください。${extras}`.trim(),
    },
  ];
  for (const img of images) {
    userContent.push({
      type: "image_url",
      image_url: { url: `data:${img.mimeType};base64,${img.base64}`, detail: "high" },
    });
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 50_000);
  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        temperature: 0,
        seed: 7,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userContent },
        ],
      }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      return { ok: false, error: `解析に失敗しました（${res.status}）${detail.slice(0, 80)}` };
    }
    const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const text = String(json?.choices?.[0]?.message?.content ?? "");
    const parsed = JSON.parse(text) as Partial<MealEstimate> & { items?: unknown };
    const estimate = sanitizeMealEstimate(parsed);
    if (!estimate) return { ok: false, error: "解析結果を読み取れませんでした" };
    return { ok: true, estimate };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { ok: false, error: /aborted/i.test(message) ? "解析がタイムアウトしました" : "解析中にエラーが発生しました" };
  } finally {
    clearTimeout(timer);
  }
}
