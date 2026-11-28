export const UENO_CLEANING_VIDEO_URL = "https://youtu.be/fQjBcif6B0A";

export type UenoCleaningStep = { key: string; label: string; detail: string };

export type UenoCleaningPlace = {
  key: string;
  label: string;
  manual: string[];
  steps: UenoCleaningStep[];
};

export type UenoCleaningArea = {
  key: "booth" | "pilates" | "rest" | "kitchen";
  label: string;
  videoUrl: string | null;
  places: UenoCleaningPlace[];
};

const BOOTH_STEPS: UenoCleaningStep[] = [
  { key: "prep", label: "準備", detail: "マシンのアタッチメントを外し、周辺を掃除しやすくする。" },
  {
    key: "vacuum",
    label: "掃除機",
    detail: "ドアの裏、床の端や角、ローラーの下、マシン周辺を重点的に掃除する。届きにくい隙間は細いノズルに替えて、髪の毛やホコリを吸う。",
  },
  { key: "roller", label: "コロコロ", detail: "床に残った髪の毛や細かいゴミを取る。特に床の縁は念入りにかける。" },
  {
    key: "wipe",
    label: "拭き掃除",
    detail: "アルコールで汚れや跡を拭く。置いてある物を一度どかし、その下や裏、ホコリがたまりやすい縁まで拭く。",
  },
  {
    key: "corners",
    label: "窓際・四隅",
    detail: "窓際や四隅を、アルコールティッシュ、またはキッチンペーパーとスプレーでしっかり拭いた。",
  },
  {
    key: "restore",
    label: "片付け・補充",
    detail: "動かした備品を戻す。潤滑剤と六角レンチはお客様の目に入りにくい場所へ。お客様用のアルコール、ティッシュ、アルコールティッシュを確認し、不足分を補充する。",
  },
  { key: "gear", label: "器具の位置", detail: "アタッチメントや器具を正しい位置に戻した。" },
  { key: "trash", label: "ゴミ箱", detail: "ブースのゴミ箱は空になっている。" },
  {
    key: "dumbbell",
    label: "ダンベル・鏡",
    detail: "ダンベルを拭く。鏡が汚れていたら、拭き跡が残らないよう上から下へ一定方向に拭く。",
  },
  {
    key: "final",
    label: "最終確認",
    detail: "床や縁に髪の毛・ホコリが残っていないか、周辺に物が置きっぱなしになっていないか、ダンベルと鏡がきれいかを確認する。",
  },
  { key: "vacuum-bin", label: "掃除機のゴミ", detail: "清掃終了時に掃除機のゴミは空になっている。" },
];

export const UENO_CLEANING_AREAS: UenoCleaningArea[] = [
  {
    key: "booth",
    label: "ブース1、ブース2",
    videoUrl: UENO_CLEANING_VIDEO_URL,
    places: [
      { key: "booth1", label: "ブース1", manual: [], steps: BOOTH_STEPS },
      { key: "booth2", label: "ブース2", manual: [], steps: BOOTH_STEPS },
    ],
  },
  {
    key: "pilates",
    label: "ピラティススペース、更衣室",
    videoUrl: null,
    places: [
      {
        key: "pilates",
        label: "ピラティススペース",
        manual: [
          "マットと器具を所定の位置に戻す。",
          "床を掃いてモップする。",
          "器具が定位置にあり、床にごみが残っていなければ完了。",
        ],
        steps: [
          { key: "gear", label: "器具", detail: "器具を定位置に戻した" },
          { key: "floor", label: "床", detail: "床を掃いてモップした" },
        ],
      },
      {
        key: "locker",
        label: "更衣室",
        manual: ["床とベンチを拭く。", "鏡のくもりと指紋を拭き取る。", "忘れ物がなく、床とベンチが拭いてあれば完了。"],
        steps: [
          { key: "bench", label: "床とベンチ", detail: "床とベンチを拭いた" },
          { key: "mirror", label: "鏡", detail: "鏡を拭き、忘れ物がない" },
        ],
      },
    ],
  },
  {
    key: "rest",
    label: "トイレ、待合",
    videoUrl: null,
    places: [
      {
        key: "toilet",
        label: "トイレ",
        manual: ["便器、床、洗面の汚れと水滴を拭く。", "ペーパーと石鹸が半分未満なら補充する。", "汚れが残っておらず、補充が半分以上なら完了。"],
        steps: [
          { key: "wipe", label: "拭き掃除", detail: "便器、床、洗面を拭いた" },
          { key: "stock", label: "補充", detail: "ペーパーと石鹸が半分以上" },
        ],
      },
      {
        key: "waiting",
        label: "待合",
        manual: ["椅子とテーブルを拭き、テーブルの上を空にする。", "床を掃く。", "テーブルの上が空で、床にごみが残っていなければ完了。"],
        steps: [
          { key: "wipe", label: "拭き掃除", detail: "椅子とテーブルを拭いた" },
          { key: "floor", label: "床", detail: "床を掃いた" },
        ],
      },
    ],
  },
  {
    key: "kitchen",
    label: "キッチン、冷蔵庫",
    videoUrl: null,
    places: [
      {
        key: "kitchen",
        label: "キッチン",
        manual: ["シンクと調理台の汚れを拭く。", "生ごみを捨て、袋を替える。", "シンクに汚れと生ごみが残っていなければ完了。"],
        steps: [
          { key: "wipe", label: "拭き掃除", detail: "シンクと調理台を拭いた" },
          { key: "trash", label: "生ごみ", detail: "生ごみを捨てた" },
        ],
      },
      {
        key: "fridge",
        label: "冷蔵庫",
        manual: ["中を見て、期限が切れたものを出す。", "棚とドアの内側を拭く。", "期限切れがなく、棚が拭いてあれば完了。開けた中を撮る。"],
        steps: [
          { key: "expiry", label: "期限", detail: "期限切れを出した" },
          { key: "shelf", label: "棚", detail: "棚とドアの内側を拭いた" },
        ],
      },
    ],
  },
];

export const UENO_CLEANING_PLACE_PHOTO_KEY = "place";

export function isUenoStoreName(name: string): boolean {
  return String(name ?? "").replace(/店$/u, "").trim() === "上野";
}

export function uenoCleaningAreaByKey(key: string): UenoCleaningArea | null {
  return UENO_CLEANING_AREAS.find((area) => area.key === key) ?? null;
}

function hashString(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function pickPhotoStepKeys(seed: string, keys: string[], count = 3): string[] {
  const list = [...keys];
  let state = hashString(seed) || 1;
  for (let i = list.length - 1; i > 0; i -= 1) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    const j = state % (i + 1);
    const swap = list[i];
    list[i] = list[j];
    list[j] = swap;
  }
  return list.slice(0, Math.min(count, list.length));
}

function placesShareSteps(area: UenoCleaningArea): boolean {
  const first = area.places[0]?.steps.map((step) => step.key).join("|") ?? "";
  return area.places.every((place) => place.steps.map((step) => step.key).join("|") === first);
}

export type UenoCleaningPhotoSlot = { placeKey: string; stepKey: string; label: string };

export function uenoCleaningPhotoSlots(areaKey: string, slotStart: string): UenoCleaningPhotoSlot[] {
  const area = uenoCleaningAreaByKey(areaKey);
  if (!area) return [];
  const shared = placesShareSteps(area);
  const stepCount = area.places[0]?.steps.length ?? 0;
  if (shared && stepCount > 3) {
    const keys = pickPhotoStepKeys(`${slotStart}|${area.key}`, area.places[0].steps.map((step) => step.key), 3);
    return area.places.flatMap((place) =>
      keys.map((stepKey) => {
        const step = place.steps.find((item) => item.key === stepKey);
        return { placeKey: place.key, stepKey, label: step?.label ?? stepKey };
      })
    );
  }
  return area.places.map((place) => ({ placeKey: place.key, stepKey: UENO_CLEANING_PLACE_PHOTO_KEY, label: place.label }));
}

export function uenoCleaningPhotoStepLabels(areaKey: string, slotStart: string): string[] {
  const area = uenoCleaningAreaByKey(areaKey);
  if (!area || !placesShareSteps(area) || (area.places[0]?.steps.length ?? 0) <= 3) return [];
  const slots = uenoCleaningPhotoSlots(areaKey, slotStart).filter((slot) => slot.placeKey === area.places[0]?.key);
  return slots.map((slot) => slot.label);
}

export type UenoCleaningCheckInput = { placeKey: string; stepKey: string; done: boolean };
export type UenoCleaningPhotoInput = { placeKey: string; stepKey: string };

export function validateUenoCleaningSubmission(input: {
  areaKey: string;
  slotStart: string;
  checks: UenoCleaningCheckInput[];
  photos: UenoCleaningPhotoInput[];
  note?: string | null;
}): { ok: true; taskLabel: string; detail: string; slots: UenoCleaningPhotoSlot[] } | { ok: false; error: string } {
  const area = uenoCleaningAreaByKey(input.areaKey);
  if (!area) return { ok: false, error: "掃除の場所を選んでください" };

  const done = new Set(input.checks.filter((check) => check.done).map((check) => `${check.placeKey}:${check.stepKey}`));
  for (const place of area.places) {
    for (const step of place.steps) {
      if (!done.has(`${place.key}:${step.key}`)) {
        return { ok: false, error: `${place.label}の「${step.label}」をチェックしてください` };
      }
    }
  }

  const slots = uenoCleaningPhotoSlots(area.key, input.slotStart);
  const attached = new Set(input.photos.map((photo) => `${photo.placeKey}:${photo.stepKey}`));
  for (const slot of slots) {
    if (!attached.has(`${slot.placeKey}:${slot.stepKey}`)) {
      const place = area.places.find((item) => item.key === slot.placeKey);
      const name = slot.stepKey === UENO_CLEANING_PLACE_PHOTO_KEY ? place?.label ?? "写真" : slot.label;
      return { ok: false, error: `${place?.label ?? "場所"}の「${name}」の写真は必須です` };
    }
  }

  const photoLabels = uenoCleaningPhotoStepLabels(area.key, input.slotStart);
  const lines = [`場所: ${area.label}`];
  if (photoLabels.length > 0) lines.push(`今回の写真: ${photoLabels.join("、")}`);
  for (const place of area.places) {
    lines.push(place.label);
    for (const step of place.steps) lines.push(`✓ ${step.label}`);
    const placeShots = slots.filter((slot) => slot.placeKey === place.key).map((slot) => slot.label);
    if (placeShots.length > 0) lines.push(`写真: ${placeShots.join("、")}`);
  }
  const note = String(input.note ?? "").trim();
  if (note) lines.push("", note);
  return { ok: true, taskLabel: `掃除（${area.label}）`, detail: lines.join("\n"), slots };
}
