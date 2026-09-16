import {
  isMealSlot,
  isMealCountUnit,
  isMealServing,
  MEAL_SLOT_LABELS,
  type MealCountUnit,
  type MealDishInput,
  type MealServing,
  type MealSlot,
  type MemberMealLogView,
} from "@/lib/memberMealLogs";
import { sanitizeMealEstimate, type MealEstimate, type MealImageInput } from "@/lib/memberMealEstimate";

export const MEAL_CHAT_GREETING =
  "記録も相談もどうぞ。「鶏むね200gと白米」でも「恵比寿で夜ごはん何がいい？」でも大丈夫です。間違えた記録は「昼ごはん消して」「カロリーを600に直して」で削除・修正できます。";

export type MealChatRole = "user" | "assistant";

export type MealChatMessage = {
  role: MealChatRole;
  content: string;
};

export type MealChatAction = "delete" | "update";

export type MealChatTurnResult = {
  reply: string;
  ready: boolean;
  dishes: MealDishInput[];
  estimate: MealEstimate | null;
  action: MealChatAction | null;
  target_meal_id: string | null;
  target_slot: MealSlot | null;
  target_date: string | null;
  patch: MealChatPatch;
};

export type MealChatPatch = {
  kcal: number | null;
  protein_g: number | null;
  fat_g: number | null;
  carb_g: number | null;
  items: string[] | null;
  note: string | null;
};

export type MealChatApplyResult =
  | { applied: "deleted"; meal_ids: string[]; note: string }
  | { applied: "updated"; meal_ids: string[]; note: string }
  | { applied: null; meal_ids: string[]; note: string | null };

const SYSTEM_PROMPT = `あなたはAbody（東京のパーソナルジム）専属の食事コーチです。日本の外食・コンビニ・スーパーに詳しく、ChatGPTと同じ水準で具体的に答える。

役割は3つ。
1) 相談：外食・コンビニ・自炊・残りPFCの使い方。会員が得をする答えにする。
2) 記録：食べたものを特定し、カロリーとPFCを推定する。
3) 既存記録の削除・訂正：間違えた計測を消す・数字やメニューを直す。

口調
- 日本語。優秀な担当トレーナーがLINEで返す感じ。短くても中身は濃く。
- 一般論で終わらせない。「定食がおすすめ」「チェーンを探して」は不合格。
- 店名は出してよい。出すべき。『店名は出せない』『具体名は言えない』は禁止。
- 医療の診断・病気の断定はしない。それ以外の食事の話は全部乗ってよい。

相談の出し方
- 候補は2〜3個。各候補に「店名 / 注文するメニュー / 目安kcalとたんぱく / 今の残りPFCに合う理由」を入れる。改行して読みやすく。
- エリアが分かる（所属店舗や発言）なら、その街の店を優先。不明なら全国チェーンを先に出し、最後にエリアを1つ聞く。
- 失敗しにくい全国チェーン例：大戸屋（チキンかあさん煮定食・さばの塩焼）、やよい軒（さば塩焼定食。牛皿は脂質多め）、松屋（チキン定食。プレミアム牛めしは脂質多め）、サイゼリヤ（ラムのランプステーキ・チキンのグリル）、魚金や回転寿司（まぐろ・えび・たまご。アボカドとマヨは脂質）、セブン/ファミマ（サラダチキン・グリルチキン・プロテインドリンク）。
- Abody店舗の目安エリア：恵比寿・上野・桜木町・新宿・福岡。その周辺なら駅名付きで店を出してよい。個人店の数字は「目安」と書く。
- 残りたんぱくが多い日は鶏・魚・卵・赤身・プロテイン。残り脂質が少ない/マイナスなら揚げ物・クリーム・マヨを避ける。トレ後は炭水化物を怖がらない。
- 公開されている栄養成分は優先して使う。

記録の出し方
- 写真があるときは写真優先。ラベルの文字をそのまま商品名に。ラベルに無い形容詞は付けない。
- プロテインのグラムはたんぱく質量。ホエイはたんぱく1gあたり約5.5kcal。
- セットは構成品ごとに分ける。グラム・個数・盛りがあれば量はそれを正とする。name に分量を入れる（ゆで卵2個、白米150g）。
- 卵M1個は可食部約50g・約76kcal・たんぱく6.1g・脂質5.1g・糖質0.2g。殻付き60gを可食部にしない。写真の個数を数える。卵焼きは生卵1個にしない。
- 相談だけのときは ready=false、itemsは空配列。記録してよいときだけ ready=true。
- ready が true のとき items は空禁止。kcal は protein_g*4 + fat_g*9 + carb_g*4。
- serving は small / regular / large か null。count_unit は 個/本/枚/杯/切れ/袋。
- 新しい食事の追加は ready=true。既存の記録を直すときは ready=false で action を使う。混ぜない。

既存記録の削除・訂正
- 「消して」「削除」「間違えた」「直して」「訂正」「修正」は記録操作。対象がコンテキストの記録で特定できるときだけ action を入れる。
- 曖昧なら action は null のまま、朝/昼/夜やメニューを聞き返す。id はコンテキストにある値だけ使う。捏造しない。
- 削除: action="delete"。target_meal_id か target_slot（breakfast/lunch/dinner/snack）を入れる。昨日なら target_date。
- 訂正: action="update"。直す数字やメニューを kcal / protein_g / fat_g / carb_g / items に入れる。変えない項目は null。
- reply には何を消す/直すかを短く書く。実際の削除・更新はシステムが行う。

出力はJSONのみ。
{"reply":"会員に見せる本文。相談は具体的に。改行OK。","ready":false,"action":null,"target_meal_id":null,"target_slot":null,"target_date":null,"dishes":[{"menu":"鶏むね","grams":200,"count":null,"count_unit":"個","serving":null}],"items":[{"name":"鶏むね皮なし","kcal":220,"protein_g":46,"fat_g":4,"carb_g":0,"source":"ai"}]}`;

function clampText(value: unknown, max: number) {
  return String(value ?? "").trim().slice(0, max);
}

function parseServing(raw: unknown): MealServing | null {
  const v = String(raw ?? "").trim();
  if (isMealServing(v)) return v;
  if (v === "小盛り" || v === "少なめ") return "small";
  if (v === "並盛り" || v === "並" || v === "普通") return "regular";
  if (v === "大盛り" || v === "多め") return "large";
  return null;
}

function parseCountUnit(raw: unknown): MealCountUnit {
  const v = String(raw ?? "").trim();
  return isMealCountUnit(v) ? v : "個";
}

function parseNum(raw: unknown, min: number, max: number): number | null {
  if (raw == null || raw === "") return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < min || n > max) return null;
  return n;
}

export function parseMealChatDishes(raw: unknown): MealDishInput[] {
  if (!Array.isArray(raw)) return [];
  const out: MealDishInput[] = [];
  for (const row of raw.slice(0, 16)) {
    if (!row || typeof row !== "object") continue;
    const o = row as Record<string, unknown>;
    const menu = clampText(o.menu ?? o.name, 80);
    if (!menu) continue;
    out.push({
      menu,
      grams: parseNum(o.grams, 0, 3000),
      count: parseNum(o.count, 0, 100),
      count_unit: parseCountUnit(o.count_unit),
      serving: parseServing(o.serving),
    });
  }
  return out;
}

function extractJsonObject(text: string): unknown {
  const t = text.trim();
  try {
    return JSON.parse(t);
  } catch {
    /* continue */
  }
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(t.slice(start, end + 1));
    } catch {
      return null;
    }
  }
  return null;
}

export function parseMealChatAction(raw: unknown): MealChatAction | null {
  const v = String(raw ?? "")
    .trim()
    .toLowerCase();
  if (v === "delete" || v === "delete_meal" || v === "remove") return "delete";
  if (v === "update" || v === "update_meal" || v === "edit" || v === "correct" || v === "patch") return "update";
  return null;
}

function parseOptionalMacro(raw: unknown): number | null {
  if (raw == null || raw === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function parsePatchItems(raw: unknown): string[] | null {
  if (!Array.isArray(raw)) return null;
  const items = raw
    .map((x) => {
      if (typeof x === "string") return x.trim();
      if (x && typeof x === "object") {
        const o = x as Record<string, unknown>;
        return String(o.name ?? o.menu ?? "").trim();
      }
      return "";
    })
    .filter(Boolean)
    .slice(0, 16);
  return items.length ? items : null;
}

export function parseMealChatPayload(raw: unknown): MealChatTurnResult | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const reply = clampText(o.reply ?? o.message ?? o.text, 2500);
  if (!reply) return null;
  const dishes = parseMealChatDishes(o.dishes);
  const estimate = sanitizeMealEstimate({
    kcal: o.kcal,
    protein_g: o.protein_g,
    fat_g: o.fat_g,
    carb_g: o.carb_g,
    alcohol_g: o.alcohol_g,
    confidence: o.confidence,
    note: o.note,
    items: Array.isArray(o.items) ? o.items : o.item_details,
    item_details: o.item_details,
  } as Parameters<typeof sanitizeMealEstimate>[0]);
  const action = parseMealChatAction(o.action);
  const readyFlag = o.ready === true || o.ready === "true";
  const targetDate = clampText(o.target_date ?? o.log_date, 16);
  return {
    reply,
    ready: Boolean(readyFlag && estimate && !action),
    dishes,
    estimate,
    action,
    target_meal_id: clampText(o.target_meal_id ?? o.meal_id, 80) || null,
    target_slot: isMealSlot(o.target_slot ?? o.meal_slot) ? ((o.target_slot ?? o.meal_slot) as MealSlot) : null,
    target_date: /^\d{4}-\d{2}-\d{2}$/.test(targetDate) ? targetDate : null,
    patch: {
      kcal: parseOptionalMacro(o.kcal),
      protein_g: parseOptionalMacro(o.protein_g),
      fat_g: parseOptionalMacro(o.fat_g),
      carb_g: parseOptionalMacro(o.carb_g),
      items: parsePatchItems(o.items) ?? parsePatchItems(o.item_details),
      note: o.note == null || o.note === "" ? null : clampText(o.note, 240),
    },
  };
}

export function sanitizeMealChatMessages(raw: unknown): MealChatMessage[] {
  if (!Array.isArray(raw)) return [];
  const out: MealChatMessage[] = [];
  for (const row of raw.slice(-20)) {
    if (!row || typeof row !== "object") continue;
    const o = row as Record<string, unknown>;
    const role = o.role === "assistant" ? "assistant" : o.role === "user" ? "user" : null;
    const content = clampText(o.content ?? o.text, role === "assistant" ? 2500 : 1200);
    if (!role || !content) continue;
    out.push({ role, content });
  }
  return out;
}

export function formatMealLogForChat(meal: MemberMealLogView): string {
  const items = meal.items.length ? meal.items.join("・") : "メニュー不明";
  return `id=${meal.id} ${meal.log_date} ${MEAL_SLOT_LABELS[meal.meal_slot]} ${items} ${meal.kcal}kcal P${meal.protein_g} F${meal.fat_g} C${meal.carb_g}`;
}

export function resolveMealChatTargets(params: {
  meals: MemberMealLogView[];
  action: MealChatAction | null;
  mealId?: string | null;
  slot?: MealSlot | null;
  logDate?: string | null;
  today: string;
}): { ok: true; meals: MemberMealLogView[] } | { ok: false; reason: "none" | "not_found" | "ambiguous" } {
  if (!params.action) return { ok: false, reason: "none" };
  const mealId = params.mealId?.trim() || "";
  if (mealId) {
    const found = params.meals.filter((m) => m.id === mealId || m.id.startsWith(mealId));
    if (found.length === 1) return { ok: true, meals: found };
    return { ok: false, reason: found.length === 0 ? "not_found" : "ambiguous" };
  }

  const date = params.logDate?.trim() || params.today;
  let candidates = params.meals.filter((m) => m.log_date === date);
  if (params.slot) candidates = candidates.filter((m) => m.meal_slot === params.slot);
  if (candidates.length === 0) return { ok: false, reason: "not_found" };

  if (params.action === "delete" && params.slot) return { ok: true, meals: candidates };

  if (candidates.length === 1) return { ok: true, meals: candidates };

  const latest = [...candidates].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))[0];
  if (!latest) return { ok: false, reason: "not_found" };
  if (params.action === "update" || !params.slot) return { ok: true, meals: [latest] };
  return { ok: false, reason: "ambiguous" };
}

export function buildMealChatContext(params: {
  slotLabel: string;
  eatenTime?: string | null;
  storeName?: string | null;
  nutrition?: {
    intake_kcal: number;
    protein_g: number;
    fat_g: number;
    carb_g: number;
  } | null;
  remaining?: { kcal: number; protein_g: number; fat_g: number; carb_g: number } | null;
  totals?: { kcal: number; protein_g: number; fat_g: number; carb_g: number } | null;
  todayMeals?: string[];
  recentMeals?: string[];
  lifestyle?: string | null;
  hints?: string[];
  photoCount: number;
}) {
  const target = params.nutrition
    ? `目標 ${params.nutrition.intake_kcal}kcal / P${params.nutrition.protein_g} F${params.nutrition.fat_g} C${params.nutrition.carb_g}`
    : "目標カロリー未設定";
  const remaining = params.remaining
    ? `今日の残り ${params.remaining.kcal}kcal / P${params.remaining.protein_g} F${params.remaining.fat_g} C${params.remaining.carb_g}`
    : "";
  const eaten = params.totals
    ? `今日すでに摂取 ${params.totals.kcal}kcal / P${params.totals.protein_g} F${params.totals.fat_g} C${params.totals.carb_g}`
    : "";
  const today = params.todayMeals?.filter(Boolean).slice(0, 8).join("\n");
  const recent = params.recentMeals?.filter(Boolean).slice(0, 10).join("\n");
  const hints = params.hints?.filter(Boolean).slice(0, 4).join(" / ");
  return [
    `所属店舗: ${params.storeName?.trim() || "不明"}`,
    `食事区分: ${params.slotLabel}`,
    params.eatenTime?.trim() ? `食事時刻: ${params.eatenTime.trim()}` : "",
    target,
    eaten,
    remaining,
    today ? `今日すでに記録:\n${today}` : "今日の食事はまだ未記録",
    recent ? `直近の記録:\n${recent}` : "",
    params.lifestyle?.trim() ? `生活: ${params.lifestyle.trim()}` : "",
    hints ? `直近のヒント: ${hints}` : "",
    params.photoCount > 0 ? `写真: ${params.photoCount}枚添付。ラベルと見た目を優先。` : "写真なし",
    "削除・訂正するときは上の id か食事区分を action に入れる。",
  ]
    .filter(Boolean)
    .join("\n");
}

export async function runMealChatTurn(params: {
  messages: MealChatMessage[];
  images?: MealImageInput[];
  context: string;
}): Promise<{ ok: true; result: MealChatTurnResult } | { ok: false; error: string }> {
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key) return { ok: false, error: "食事の解析キーが未設定です" };

  const model = process.env.OPENAI_MEAL_MODEL?.trim() || "gpt-4o";
  const images = (params.images ?? []).filter((img) => img.base64 && img.mimeType);
  const history = params.messages.filter((m) => m.content.trim());
  if (history.every((m) => m.role !== "user") && images.length === 0) {
    return { ok: false, error: "メッセージか写真を送ってください" };
  }

  const openaiMessages: Array<{ role: string; content: unknown }> = [
    { role: "system", content: `${SYSTEM_PROMPT}\n\n${params.context}` },
  ];
  const lastUserIndex = [...history].map((m, i) => (m.role === "user" ? i : -1)).filter((i) => i >= 0).pop();
  for (let i = 0; i < history.length; i++) {
    const msg = history[i];
    if (i === lastUserIndex && images.length) {
      openaiMessages.push({
        role: "user",
        content: [
          { type: "text", text: msg.content },
          ...images.map((img) => ({
            type: "image_url",
            image_url: { url: `data:${img.mimeType};base64,${img.base64}`, detail: "high" as const },
          })),
        ],
      });
    } else {
      openaiMessages.push({ role: msg.role, content: msg.content });
    }
  }
  if (lastUserIndex == null && images.length) {
    openaiMessages.push({
      role: "user",
      content: [
        { type: "text", text: "写真を送ります。写っている食事を特定してください。" },
        ...images.map((img) => ({
          type: "image_url",
          image_url: { url: `data:${img.mimeType};base64,${img.base64}`, detail: "high" as const },
        })),
      ],
    });
  }

  const lastUser = [...history].reverse().find((m) => m.role === "user")?.content ?? "";
  const manageTurn = /削除|消して|消してほしい|間違えた|直して|訂正|修正|取り消/.test(lastUser);
  const loggingTurn = images.length > 0 || manageTurn || /記録|食べた|飲んだ|\d+\s*g\b|\d+\s*グラム/.test(lastUser);
  const consultTurn =
    !manageTurn &&
    /外食|おすすめ|何がいい|店|レストラン|メニュー|相談|ダイエット|タンパク質|たんぱく|コンビニ|夜ご飯|昼ごはん/.test(
      lastUser
    );

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
        temperature: loggingTurn && !consultTurn ? 0.15 : 0.55,
        max_tokens: 1600,
        response_format: { type: "json_object" },
        messages: openaiMessages,
      }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      return { ok: false, error: `会話に失敗しました（${res.status}）${detail.slice(0, 80)}` };
    }
    const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const parsed = extractJsonObject(String(json?.choices?.[0]?.message?.content ?? ""));
    const result = parseMealChatPayload(parsed);
    if (!result) return { ok: false, error: "返信を読み取れませんでした" };
    return { ok: true, result };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { ok: false, error: /aborted/i.test(message) ? "応答がタイムアウトしました" : "会話中にエラーが発生しました" };
  } finally {
    clearTimeout(timer);
  }
}
