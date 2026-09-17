"use client";

import { Apple, ChevronLeft, ChevronRight, Home, Keyboard, Lock, MapPin, MessageCircle, Plus, ScanBarcode, Settings } from "lucide-react";
import { DateTime } from "luxon";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { MemberNutritionTargetView } from "@/lib/memberNutritionTargets";
import { formatIntakeLabel } from "@/lib/memberNutritionTargets";
import {
  MEAL_LOG_TZ,
  MEAL_COUNT_UNITS,
  MEAL_SERVING_LABELS,
  MEAL_SERVINGS,
  MEAL_SLOT_LABELS,
  MAX_MEAL_PHOTOS,
  type MealCountUnit,
  type BowelQuality,
  type MealAnalysisHint,
  type MealDayTotals,
  type MealFeedback,
  type MealRemaining,
  type MealServing,
  type MealSlot,
  type MemberLifestyleLogView,
  type MemberMealLogView,
} from "@/lib/memberMealLogs";
import type { MealEstimate, MealEstimateItem } from "@/lib/memberMealEstimate";
import { MEAL_CHAT_GREETING } from "@/lib/memberMealChat";
import { MealPersonalChat } from "@/components/member/MealPersonalChat";
import { MealBarcodeInput } from "@/components/member/MealBarcodeInput";
import { NearbyMealSuggest } from "@/components/member/NearbyMealSuggest";
import { MealPlanSuggest } from "@/components/member/MealPlanSuggest";
import { HomeCookSuggest } from "@/components/member/HomeCookSuggest";
import { TrainingLogPanel } from "@/components/member/TrainingLogPanel";
import { TrainingDiaryPanel } from "@/components/member/TrainingDiaryPanel";
import { WeightLogPanel } from "@/components/member/WeightLogPanel";
import { HOME_PAGE_CLASS, HomeSwipePager } from "@/components/member/WeightHomeCarousel";
import { MealPersonalPaywall } from "@/components/member/MealPersonalPaywall";
import { MealPersonalGoalSettings } from "@/components/member/MealPersonalGoalSettings";
import {
  DEFAULT_MEAL_REMINDER_SETTINGS,
  type MealReminderSettings,
} from "@/lib/memberMealReminderSettings";

type MealDashboard = {
  enabled?: boolean;
  today: string;
  default_slot?: MealSlot;
  meals: MemberMealLogView[];
  today_meals: MemberMealLogView[];
  today_lifestyle: MemberLifestyleLogView | null;
  nutrition?: MemberNutritionTargetView | null;
  totals: MealDayTotals;
  remaining: MealRemaining | null;
  feedback: MealFeedback;
  analysis?: MealAnalysisHint;
  reminder_settings?: MealReminderSettings | null;
  store_name?: string | null;
  estimate_note?: string;
  preview?: boolean;
  estimate?: MealEstimate;
  error?: string;
  reply?: string;
  ready?: boolean;
  applied?: "deleted" | "updated" | null;
  dishes?: Array<{
    menu: string;
    grams: number | null;
    count: number | null;
    count_unit: MealCountUnit;
    serving: MealServing | null;
  }>;
};

function compressImage(file: File): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const max = 1280;
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        URL.revokeObjectURL(url);
        reject(new Error("画像を圧縮できませんでした"));
        return;
      }
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      canvas.toBlob(
        (blob) => {
          URL.revokeObjectURL(url);
          if (!blob) reject(new Error("画像を圧縮できませんでした"));
          else resolve(blob);
        },
        "image/jpeg",
        0.82
      );
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("画像を読み込めませんでした"));
    };
    img.src = url;
  });
}

type MealPersonalTab = "home" | "diary" | "add" | "suggest" | "settings";
type MealAddMode = "picker" | "chat" | "record" | "barcode";

function formatYmd(ymd: string) {
  const dt = DateTime.fromISO(ymd, { zone: MEAL_LOG_TZ });
  if (!dt.isValid) return ymd;
  const dow = ["日", "月", "火", "水", "木", "金", "土"][dt.weekday % 7];
  return `${dt.toFormat("M/d")}（${dow}）`;
}

function formatHomeDate(ymd: string) {
  const dt = DateTime.fromISO(ymd, { zone: MEAL_LOG_TZ });
  if (!dt.isValid) return ymd;
  const dow = ["月曜日", "火曜日", "水曜日", "木曜日", "金曜日", "土曜日", "日曜日"][dt.weekday - 1];
  return `${dow}, ${dt.toFormat("M月d日")}`;
}

function last7DayValues(meals: MemberMealLogView[], today: string, key: "kcal" | "protein_g") {
  return [6, 5, 4, 3, 2, 1, 0].map((ago) => {
    const d = DateTime.fromISO(today, { zone: MEAL_LOG_TZ }).minus({ days: ago }).toFormat("yyyy-MM-dd");
    const sum = meals.filter((m) => m.log_date === d).reduce((a, m) => a + m[key], 0);
    return key === "kcal" ? Math.round(sum) : Math.round(sum * 10) / 10;
  });
}

function pendingItems(estimate: MealEstimate): MealEstimateItem[] {
  if (estimate.item_details.length) return estimate.item_details;
  return estimate.items.map((name) => ({
    name,
    kcal: estimate.kcal,
    protein_g: estimate.protein_g,
    fat_g: estimate.fat_g,
    carb_g: estimate.carb_g,
    source: "ai" as const,
  }));
}

function withPendingDetails(prev: MealEstimate, details: MealEstimateItem[]): MealEstimate {
  return {
    ...prev,
    item_details: details,
    items: details.map((d) => d.name),
    kcal: Math.round(details.reduce((a, d) => a + d.kcal, 0)),
    protein_g: Math.round(details.reduce((a, d) => a + d.protein_g, 0) * 10) / 10,
    fat_g: Math.round(details.reduce((a, d) => a + d.fat_g, 0) * 10) / 10,
    carb_g: Math.round(details.reduce((a, d) => a + d.carb_g, 0) * 10) / 10,
  };
}

function sourceBadge(source: MealEstimateItem["source"]) {
  if (source === "catalog") return "公開値";
  if (source === "label") return "ラベル";
  return "推定";
}

const EMPTY_DISH = {
  menu: "",
  grams: "",
  count: "",
  count_unit: "個" as MealCountUnit,
  serving: "" as MealServing | "",
};

function lockedDemoMeals(today: string): MemberMealLogView[] {
  return [
    {
      id: "demo-breakfast",
      log_date: today,
      meal_slot: "breakfast",
      photo_url: null,
      photo_urls: [],
      note: null,
      items: ["鶏むね", "ご飯", "サラダ"],
      kcal: 480,
      protein_g: 38,
      fat_g: 12,
      carb_g: 48,
      alcohol_g: null,
      confidence: 0.9,
      source: "ai",
      created_at: `${today}T08:10:00+09:00`,
    },
    {
      id: "demo-lunch",
      log_date: today,
      meal_slot: "lunch",
      photo_url: null,
      photo_urls: [],
      note: null,
      items: ["大戸屋 さばの塩焼き定食"],
      kcal: 720,
      protein_g: 42,
      fat_g: 22,
      carb_g: 82,
      alcohol_g: null,
      confidence: 0.88,
      source: "ai",
      created_at: `${today}T12:30:00+09:00`,
    },
  ];
}

function fieldsFromApiDishes(
  dishes: NonNullable<MealDashboard["dishes"]>
): Array<{ menu: string; grams: string; count: string; count_unit: MealCountUnit; serving: MealServing | "" }> {
  if (!dishes.length) return [{ ...EMPTY_DISH }];
  return dishes.map((d) => ({
    menu: d.menu,
    grams: d.grams == null ? "" : String(d.grams),
    count: d.count == null ? "" : String(d.count),
    count_unit: d.count_unit || "個",
    serving: d.serving || "",
  }));
}

export function MealPersonalPanel({
  signed,
  compact = false,
  apiPath = "/api/member/meal-logs",
  readOnly = false,
  initialSlot,
  locked = false,
  subscribeUrl = null,
  priceLabel = "食事パーソナル（月額）",
}: {
  signed?: { s: string; sig: string } | null;
  compact?: boolean;
  apiPath?: string;
  readOnly?: boolean;
  initialSlot?: MealSlot | null;
  locked?: boolean;
  subscribeUrl?: string | null;
  priceLabel?: string;
}) {
  const [data, setData] = useState<MealDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [slot, setSlot] = useState<MealSlot>(initialSlot ?? "lunch");
  const [eatenTime, setEatenTime] = useState(() => DateTime.now().setZone(MEAL_LOG_TZ).toFormat("HH:mm"));
  const [dishes, setDishes] = useState<
    Array<{ menu: string; grams: string; count: string; count_unit: MealCountUnit; serving: MealServing | "" }>
  >([{ menu: "", grams: "", count: "", count_unit: "個", serving: "" }]);
  const [mealPhotos, setMealPhotos] = useState<Array<{ file: File; preview: string }>>([]);
  const [pending, setPending] = useState<MealEstimate | null>(null);
  const cameraInputRef = useRef<HTMLInputElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);
  const [water, setWater] = useState("");
  const [alcohol, setAlcohol] = useState("");
  const [bowel, setBowel] = useState("");
  const [bowelQuality, setBowelQuality] = useState<BowelQuality | "">("");
  const [reminderTimes, setReminderTimes] = useState<MealReminderSettings>(DEFAULT_MEAL_REMINDER_SETTINGS);
  const [chatMessages, setChatMessages] = useState<Array<{ role: "user" | "assistant"; text: string }>>([
    { role: "assistant", text: MEAL_CHAT_GREETING },
  ]);
  const [chatInput, setChatInput] = useState("");
  const [barcodeMiss, setBarcodeMiss] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<{
    items: string;
    kcal: string;
    protein_g: string;
    fat_g: string;
    carb_g: string;
  } | null>(null);
  const [tab, setTab] = useState<MealPersonalTab>(locked || !initialSlot ? "home" : "add");
  const [settingsPage, setSettingsPage] = useState<"menu" | "goal" | "reminders" | "lifestyle">("menu");
  const [addMode, setAddMode] = useState<MealAddMode>(initialSlot ? "record" : "picker");
  const [intakeMode, setIntakeMode] = useState<"intake" | "remaining">("intake");
  const [suggestView, setSuggestView] = useState<"menu" | "map">("menu");
  const [geo, setGeo] = useState<{ lat: number; lng: number } | null>(null);

  const mealPhotosRef = useRef(mealPhotos);
  mealPhotosRef.current = mealPhotos;

  function addMealFiles(incoming: File[]) {
    setMealPhotos((prev) => {
      const room = MAX_MEAL_PHOTOS - prev.length;
      const added = incoming.slice(0, Math.max(0, room)).map((file) => ({
        file,
        preview: URL.createObjectURL(file),
      }));
      return [...prev, ...added];
    });
  }

  function removeMealPhoto(index: number) {
    setMealPhotos((prev) => {
      const target = prev[index];
      if (target) URL.revokeObjectURL(target.preview);
      return prev.filter((_, j) => j !== index);
    });
  }

  useEffect(() => {
    return () => {
      mealPhotosRef.current.forEach((p) => URL.revokeObjectURL(p.preview));
    };
  }, []);

  const query = signed ? `?s=${encodeURIComponent(signed.s)}&sig=${encodeURIComponent(signed.sig)}` : "";
  const listUrl = `${apiPath}${query}`;

  const applyLifestyleInputs = (life: MemberLifestyleLogView | null) => {
    setWater(life?.water_ml != null ? String(life.water_ml) : "");
    setAlcohol(life?.alcohol_drinks != null ? String(life.alcohol_drinks) : "");
    setBowel(life?.bowel_count != null ? String(life.bowel_count) : "");
    setBowelQuality(life?.bowel_quality ?? "");
  };

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch(listUrl, { cache: "no-store" });
      const json = (await res.json().catch(() => ({}))) as MealDashboard;
      if (!res.ok) throw new Error(json.error || "取得に失敗しました");
      setData(json);
      if (json.default_slot) setSlot((prev) => (initialSlot ? prev : json.default_slot ?? prev));
      applyLifestyleInputs(json.today_lifestyle);
      if (json.reminder_settings) setReminderTimes(json.reminder_settings);
    } catch (e) {
      setErr(String((e as Error)?.message ?? "取得に失敗しました"));
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [listUrl, initialSlot]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (tab !== "settings") setSettingsPage("menu");
  }, [tab]);

  useEffect(() => {
    if (tab !== "suggest") setSuggestView("menu");
  }, [tab]);

  useEffect(() => {
    if (tab !== "suggest" || suggestView !== "map") return;
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => setGeo({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => setGeo(null),
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 300000 }
    );
  }, [tab, suggestView]);

  async function saveMeal() {
    if (locked || !data) return;
    const hasMenu = dishes.some((d) => d.menu.trim());
    if (mealPhotos.length === 0 && !hasMenu) return;
    setBusy(true);
    setErr(null);
    setSavedMsg(null);
    try {
      const form = await buildMealForm();
      form.set("preview", "1");
      const res = await fetch(apiPath, { method: "POST", body: form });
      const json = (await res.json().catch(() => ({}))) as MealDashboard;
      if (!res.ok) throw new Error(json.error || "解析に失敗しました");
      if (json.estimate) {
        setPending(json.estimate);
        return;
      }
      throw new Error("解析結果がありません");
    } catch (e) {
      setErr(String((e as Error)?.message ?? "解析に失敗しました"));
    } finally {
      setBusy(false);
    }
  }

  async function confirmMeal() {
    if (locked || !data || !pending) return;
    setBusy(true);
    setErr(null);
    setSavedMsg(null);
    try {
      const form = await buildMealForm();
      form.set(
        "estimate",
        JSON.stringify({
          ...pending,
          items: pendingItems(pending),
        })
      );
      const res = await fetch(apiPath, { method: "POST", body: form });
      const json = (await res.json().catch(() => ({}))) as MealDashboard;
      if (!res.ok) throw new Error(json.error || "保存に失敗しました");
      setData(json);
      applyLifestyleInputs(json.today_lifestyle);
      setSavedMsg(`${MEAL_SLOT_LABELS[slot]}ごはんを記録しました`);
      mealPhotos.forEach((p) => URL.revokeObjectURL(p.preview));
      setMealPhotos([]);
      setPending(null);
      setDishes([{ ...EMPTY_DISH }]);
      setChatMessages([{ role: "assistant", text: MEAL_CHAT_GREETING }]);
      setChatInput("");
      setTab("home");
    } catch (e) {
      setErr(String((e as Error)?.message ?? "保存に失敗しました"));
    } finally {
      setBusy(false);
    }
  }

  async function sendChat() {
    if (locked || !data) return;
    const raw = chatInput.trim();
    if (!raw && mealPhotos.length === 0) return;
    const userText = raw || "写真を送ります";
    const history = [...chatMessages, { role: "user" as const, text: userText }];
    setChatMessages(history);
    setChatInput("");
    setBusy(true);
    setErr(null);
    setSavedMsg(null);
    try {
      const form = await buildMealForm();
      form.set("kind", "chat");
      form.set(
        "messages",
        JSON.stringify(history.map((m) => ({ role: m.role, content: m.text })))
      );
      const res = await fetch(apiPath, { method: "POST", body: form });
      const json = (await res.json().catch(() => ({}))) as MealDashboard;
      if (!res.ok) throw new Error(json.error || "会話に失敗しました");
      const reply = json.reply?.trim() || "内容を確認できませんでした。もう一度送ってください。";
      setChatMessages((prev) => [...prev, { role: "assistant", text: reply }]);
      if (json.dishes?.length) setDishes(fieldsFromApiDishes(json.dishes));
      if (json.applied && json.today) {
        setData(json);
        applyLifestyleInputs(json.today_lifestyle);
        setSavedMsg(json.applied === "deleted" ? "記録を削除しました" : "記録を修正しました");
        setPending(null);
        setEditingId(null);
        setEditDraft(null);
      } else if (json.ready && json.estimate) {
        setPending(json.estimate);
      }
    } catch (e) {
      setErr(String((e as Error)?.message ?? "会話に失敗しました"));
    } finally {
      setBusy(false);
    }
  }

  async function lookupBarcode(barcode: string) {
    const digits = barcode.replace(/\D/g, "");
    if (digits.length < 8) return;
    setBusy(true);
    setErr(null);
    setBarcodeMiss(null);
    setSavedMsg(null);
    try {
      const res = await fetch(apiPath, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          kind: "barcode",
          barcode: digits,
          ...(signed ? { s: signed.s, sig: signed.sig } : {}),
        }),
      });
      const json = (await res.json().catch(() => ({}))) as MealDashboard;
      if (!res.ok) throw new Error(json.error || "商品の取得に失敗しました");
      if (json.estimate) {
        setPending(json.estimate);
        return;
      }
      throw new Error("商品の栄養情報が見つかりませんでした");
    } catch (e) {
      setBarcodeMiss(digits);
      setErr(String((e as Error)?.message ?? "商品の取得に失敗しました"));
    } finally {
      setBusy(false);
    }
  }

  function continueBarcodeAsRecord(openCamera: boolean) {
    setAddMode("record");
    if (openCamera) {
      window.setTimeout(() => cameraInputRef.current?.click(), 0);
    }
  }

  async function buildMealForm() {
    const form = new FormData();
    if (signed) {
      form.set("s", signed.s);
      form.set("sig", signed.sig);
    }
    form.set("log_date", data!.today);
    form.set("meal_slot", slot);
    if (eatenTime) form.set("eaten_time", eatenTime);
    form.set(
      "dishes",
      JSON.stringify(
        dishes
          .filter((d) => d.menu.trim())
          .map((d) => ({
            menu: d.menu.trim(),
            grams: d.grams.trim() === "" ? null : Number(d.grams),
            count: d.count.trim() === "" ? null : Number(d.count),
            count_unit: d.count_unit,
            serving: d.serving || null,
          }))
      )
    );
    for (const photo of mealPhotos) {
      const blob = await compressImage(photo.file);
      form.append("photos", new File([blob], "meal.jpg", { type: "image/jpeg" }));
    }
    return form;
  }

  async function saveReminderTimes() {
    if (locked) return;
    setBusy(true);
    setErr(null);
    setSavedMsg(null);
    try {
      const res = await fetch(apiPath, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...(signed ? { s: signed.s, sig: signed.sig } : {}),
          kind: "reminder_settings",
          ...reminderTimes,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as MealDashboard;
      if (!res.ok) throw new Error(json.error || "保存に失敗しました");
      setData(json);
      if (json.reminder_settings) setReminderTimes(json.reminder_settings);
      applyLifestyleInputs(json.today_lifestyle);
      setSavedMsg("配信時間を保存しました");
    } catch (e) {
      setErr(String((e as Error)?.message ?? "保存に失敗しました"));
    } finally {
      setBusy(false);
    }
  }

  async function saveLifestyle() {
    if (locked || !data) return;
    setBusy(true);
    setErr(null);
    setSavedMsg(null);
    try {
      const res = await fetch(apiPath, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...(signed ? { s: signed.s, sig: signed.sig } : {}),
          log_date: data.today,
          water_ml: water.trim() === "" ? null : Number(water),
          alcohol_drinks: alcohol.trim() === "" ? null : Number(alcohol),
          bowel_count: bowel.trim() === "" ? null : Number(bowel),
          bowel_quality: bowelQuality || null,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as MealDashboard;
      if (!res.ok) throw new Error(json.error || "保存に失敗しました");
      setData(json);
      applyLifestyleInputs(json.today_lifestyle);
      setSavedMsg("水分・お酒・お通じを記録しました");
    } catch (e) {
      setErr(String((e as Error)?.message ?? "保存に失敗しました"));
    } finally {
      setBusy(false);
    }
  }

  function startEditMeal(meal: MemberMealLogView) {
    setEditingId(meal.id);
    setEditDraft({
      items: meal.items.join("\n"),
      kcal: String(meal.kcal),
      protein_g: String(meal.protein_g),
      fat_g: String(meal.fat_g),
      carb_g: String(meal.carb_g),
    });
    setErr(null);
    setSavedMsg(null);
  }

  async function saveEditMeal() {
    if (locked || !editDraft || !editingId) return;
    const kcal = Math.round(Number(editDraft.kcal));
    const proteinG = Number(editDraft.protein_g);
    const fatG = Number(editDraft.fat_g);
    const carbG = Number(editDraft.carb_g);
    if (![kcal, proteinG, fatG, carbG].every((n) => Number.isFinite(n))) {
      setErr("カロリーとPFCは数字で入力してください");
      return;
    }
    setBusy(true);
    setErr(null);
    setSavedMsg(null);
    try {
      const res = await fetch(apiPath, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...(signed ? { s: signed.s, sig: signed.sig } : {}),
          kind: "update_meal",
          meal_id: editingId,
          items: editDraft.items
            .split(/\n|・|,|、/)
            .map((x) => x.trim())
            .filter(Boolean),
          kcal,
          protein_g: proteinG,
          fat_g: fatG,
          carb_g: carbG,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as MealDashboard;
      if (!res.ok) throw new Error(json.error || "修正に失敗しました");
      setData(json);
      applyLifestyleInputs(json.today_lifestyle);
      setEditingId(null);
      setEditDraft(null);
      setSavedMsg("記録を修正しました");
    } catch (e) {
      setErr(String((e as Error)?.message ?? "修正に失敗しました"));
    } finally {
      setBusy(false);
    }
  }

  async function deleteMeal(meal: MemberMealLogView) {
    if (locked) return;
    const label = meal.items.length ? meal.items.slice(0, 2).join("・") : MEAL_SLOT_LABELS[meal.meal_slot];
    if (!window.confirm(`${formatYmd(meal.log_date)}の${MEAL_SLOT_LABELS[meal.meal_slot]}（${label}）を削除しますか？`)) {
      return;
    }
    setBusy(true);
    setErr(null);
    setSavedMsg(null);
    try {
      const res = await fetch(apiPath, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...(signed ? { s: signed.s, sig: signed.sig } : {}),
          kind: "delete_meal",
          meal_id: meal.id,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as MealDashboard;
      if (!res.ok) throw new Error(json.error || "削除に失敗しました");
      setData(json);
      applyLifestyleInputs(json.today_lifestyle);
      if (editingId === meal.id) {
        setEditingId(null);
        setEditDraft(null);
      }
      setSavedMsg("記録を削除しました");
    } catch (e) {
      setErr(String((e as Error)?.message ?? "削除に失敗しました"));
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-5 text-sm text-slate-600 shadow-sm">
        食事パーソナルを読み込み中…
      </div>
    );
  }
  if (err && !data) {
    return <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{err}</div>;
  }
  if (!data) return null;

  const remaining = data.remaining;
  const useTabs = !compact;
  const activeTab = readOnly && tab === "add" ? "home" : tab;

  const statusBanners = (
    <>
      {savedMsg ? (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">{savedMsg}</div>
      ) : null}
      {err ? <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">{err}</div> : null}
    </>
  );

  const renderMealCards = (meals: MemberMealLogView[], showDate: boolean) => (
    <div className="grid gap-2">
      {meals.map((m) => (
        <MealLogCard
          key={m.id}
          meal={m}
          showDate={showDate}
          readOnly={readOnly || locked}
          busy={busy}
          editing={editingId === m.id}
          draft={editingId === m.id ? editDraft : null}
          onDraftChange={setEditDraft}
          onStartEdit={() => startEditMeal(m)}
          onCancelEdit={() => {
            setEditingId(null);
            setEditDraft(null);
          }}
          onSaveEdit={() => void saveEditMeal()}
          onDelete={() => void deleteMeal(m)}
        />
      ))}
    </div>
  );

  const slotButtons = (
    <div className="grid grid-cols-4 gap-1">
      {(Object.keys(MEAL_SLOT_LABELS) as MealSlot[]).map((s) => (
        <button
          key={s}
          type="button"
          onClick={() => setSlot(s)}
          className={[
            "rounded-xl px-2 py-2 text-xs font-semibold",
            slot === s ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-700",
          ].join(" ")}
        >
          {MEAL_SLOT_LABELS[s]}
        </button>
      ))}
    </div>
  );

  const photoInputs = readOnly ? null : (
    <>
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => {
          const next = e.target.files?.[0];
          if (next) addMealFiles([next]);
          e.target.value = "";
        }}
      />
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => {
          addMealFiles(Array.from(e.target.files ?? []));
          e.target.value = "";
        }}
      />
    </>
  );

  const photoPicker = (
    <div className="space-y-2">
      <div className="text-xs font-semibold text-slate-700">
        食事写真
        <span className="ml-2 font-normal text-slate-500">
          {mealPhotos.length}/{MAX_MEAL_PHOTOS}枚
        </span>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => cameraInputRef.current?.click()}
          disabled={mealPhotos.length >= MAX_MEAL_PHOTOS}
          className="rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm font-semibold text-slate-800 disabled:opacity-50"
        >
          {mealPhotos.length ? "追加で撮影" : "撮影する"}
        </button>
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={mealPhotos.length >= MAX_MEAL_PHOTOS}
          className="rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm font-semibold text-slate-800 disabled:opacity-50"
        >
          {mealPhotos.length ? "写真を追加" : "ファイルから選ぶ"}
        </button>
      </div>
      {mealPhotos.length ? (
        <div className="grid grid-cols-4 gap-2">
          {mealPhotos.map((photo, i) => (
            <div key={photo.preview} className="relative">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={photo.preview} alt={`食事写真${i + 1}`} className="h-20 w-full rounded-xl object-cover" />
              <button
                type="button"
                onClick={() => removeMealPhoto(i)}
                className="absolute right-1 top-1 rounded-full bg-black/70 px-1.5 py-0.5 text-[10px] font-semibold text-white"
              >
                削除
              </button>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );

  const pendingCard = pending ? (
    <PendingEstimateCard
      pending={pending}
      busy={busy}
      onChange={setPending}
      onRetry={() => setPending(null)}
      onConfirm={() => void confirmMeal()}
    />
  ) : null;

  const dishForm = (
    <details className="rounded-xl border border-slate-200 bg-white px-3 py-2">
      <summary className="cursor-pointer text-xs font-semibold text-slate-700">グラムや個数で手入力する</summary>
      <div className="mt-3 space-y-3">
        {dishes.map((dish, i) => (
          <div key={i} className="space-y-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-3">
            <input
              value={dish.menu}
              onChange={(e) =>
                setDishes((prev) => prev.map((d, j) => (j === i ? { ...d, menu: e.target.value } : d)))
              }
              placeholder="例: 鶏むね、白米、プロテイン"
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
            />
            <div className="flex items-center gap-2">
              <input
                inputMode="decimal"
                value={dish.grams}
                onChange={(e) =>
                  setDishes((prev) => prev.map((d, j) => (j === i ? { ...d, grams: e.target.value } : d)))
                }
                placeholder="グラム"
                className="w-20 rounded-xl border border-slate-200 bg-white px-2 py-2 text-sm"
              />
              <span className="text-xs text-slate-500">g</span>
              <span className="shrink-0 text-xs font-bold text-slate-400">or</span>
              <input
                inputMode="decimal"
                value={dish.count}
                onChange={(e) =>
                  setDishes((prev) => prev.map((d, j) => (j === i ? { ...d, count: e.target.value } : d)))
                }
                placeholder="個数"
                className="w-16 rounded-xl border border-slate-200 bg-white px-2 py-2 text-sm"
              />
              <select
                value={dish.count_unit}
                onChange={(e) =>
                  setDishes((prev) =>
                    prev.map((d, j) => (j === i ? { ...d, count_unit: e.target.value as MealCountUnit } : d))
                  )
                }
                className="rounded-xl border border-slate-200 bg-white px-1.5 py-2 text-xs"
              >
                {MEAL_COUNT_UNITS.map((u) => (
                  <option key={u} value={u}>
                    {u}
                  </option>
                ))}
              </select>
            </div>
            <p className="text-[11px] text-slate-500">グラムか個数、どちらか一方でOK。プロテインはたんぱく質のグラムでOK</p>
            <div className="flex min-w-0 flex-1 gap-1">
              {MEAL_SERVINGS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() =>
                    setDishes((prev) =>
                      prev.map((d, j) => (j === i ? { ...d, serving: d.serving === s ? "" : s } : d))
                    )
                  }
                  className={[
                    "flex-1 rounded-lg px-1 py-2 text-[11px] font-semibold",
                    dish.serving === s ? "bg-slate-900 text-white" : "border border-slate-200 bg-white text-slate-700",
                  ].join(" ")}
                >
                  {MEAL_SERVING_LABELS[s]}
                </button>
              ))}
            </div>
          </div>
        ))}
        <button
          type="button"
          onClick={() => setDishes((prev) => [...prev, { ...EMPTY_DISH }])}
          className="text-xs font-semibold text-slate-800"
        >
          メニューを追加
        </button>
      </div>
    </details>
  );

  const homeBody = compact ? (
    <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <IntakeDashboard
        today={data.today}
        totals={data.totals}
        remaining={remaining}
        nutrition={data.nutrition ?? null}
        feedback={null}
        analysis={undefined}
        kcalSeries={last7DayValues(data.meals, data.today, "kcal")}
        proteinSeries={last7DayValues(data.meals, data.today, "protein_g")}
        intakeMode={intakeMode}
        onIntakeMode={setIntakeMode}
        showTitle={false}
      />
      <div className="space-y-2">
        <div className="text-sm font-bold text-slate-900">{formatYmd(data.today)}の記録</div>
        {data.today_meals.length === 0 ? <div className="text-sm text-slate-600">まだ食事がありません。</div> : null}
        {renderMealCards(data.today_meals.slice(0, 4), false)}
      </div>
    </section>
  ) : (
    <HomeSwipePager labels={["ホーム", "体重"]}>
      <section className={HOME_PAGE_CLASS}>
        <IntakeDashboard
          today={data.today}
          totals={data.totals}
          remaining={remaining}
          nutrition={data.nutrition ?? null}
          feedback={data.feedback}
          analysis={data.analysis}
          kcalSeries={last7DayValues(data.meals, data.today, "kcal")}
          proteinSeries={last7DayValues(data.meals, data.today, "protein_g")}
          intakeMode={intakeMode}
          onIntakeMode={setIntakeMode}
          showTitle
          weightHint
        />
      </section>
      {readOnly ? null : (
        <WeightLogPanel
          signed={signed}
          compact
          showLogList={false}
          showNutrition={false}
          showOutlook
          recentKcalAvg={data.analysis?.last_7d_kcal_avg ?? null}
        />
      )}
    </HomeSwipePager>
  );

  const diaryMeals = locked ? lockedDemoMeals(data.today) : data.today_meals;
  const diaryPast = locked ? [] : data.meals.filter((m) => m.log_date !== data.today);

  const diaryBody = (
    <HomeSwipePager labels={["食事", "トレーニング"]}>
      <section className={HOME_PAGE_CLASS}>
        <div className="text-center">
          <div className="text-3xl font-bold tracking-tight text-slate-900">食事</div>
          {readOnly ? null : <div className="mt-0.5 text-[11px] font-semibold text-slate-400">トレーニング →</div>}
        </div>
        <div className="mt-4 space-y-4">
          <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="text-sm font-bold text-slate-900">{formatYmd(data.today)}の記録</div>
            {diaryMeals.length === 0 ? <div className="text-sm text-slate-600">まだ食事がありません。</div> : null}
            {renderMealCards(diaryMeals.slice(0, 20), false)}
          </section>
          {diaryPast.length ? (
            <section className="space-y-2 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="text-sm font-bold text-slate-900">過去の食事</div>
              <p className="text-xs text-slate-500">間違えた記録はここから削除・修正できます。</p>
              {renderMealCards(diaryPast.slice(0, 40), true)}
            </section>
          ) : null}
        </div>
      </section>
      {readOnly || locked ? (
        <section className={HOME_PAGE_CLASS}>
          <div className="text-center">
            <div className="text-3xl font-bold tracking-tight text-slate-900">トレーニング</div>
            <div className="mt-0.5 text-[11px] font-semibold text-slate-400">← 食事</div>
          </div>
          <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="text-sm font-bold text-slate-900">{formatYmd(data.today)}の記録</div>
            <div className="mt-2 text-sm text-slate-600">ジム・45分・調子ふつう</div>
          </div>
        </section>
      ) : (
        <TrainingDiaryPanel signed={signed} />
      )}
    </HomeSwipePager>
  );

  const addBack = (
    <button
      type="button"
      onClick={() => setAddMode("picker")}
      className="text-xs font-semibold text-slate-600 underline"
    >
      記録方法を選ぶ
    </button>
  );

  const recordBody = (
    <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="space-y-1">
        {addBack}
        <div className="text-sm font-bold text-slate-900">手入力で記録</div>
        <p className="text-xs leading-relaxed text-slate-500">メニューとグラム、または写真を入れて解析します。</p>
      </div>
      {slotButtons}
      <label className="block text-xs font-semibold text-slate-700">
        食べた時間
        <input
          type="time"
          value={eatenTime}
          onChange={(e) => setEatenTime(e.target.value)}
          className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-normal"
        />
      </label>
      {photoPicker}
      {pendingCard}
      {dishForm}
      <button
        type="button"
        disabled={busy || (mealPhotos.length === 0 && !dishes.some((d) => d.menu.trim()))}
        onClick={() => void saveMeal()}
        className="w-full rounded-xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white disabled:opacity-60"
      >
        {busy ? "解析中…" : "解析して確認する"}
      </button>
    </section>
  );

  const chatBody = (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="space-y-3 border-b border-slate-100 px-4 py-3">
        {addBack}
        <div className="text-sm font-bold text-slate-900">AIチャット</div>
        <p className="text-xs leading-relaxed text-slate-500">
          相談も記録もできます。間違えた記録は「昼ごはん消して」「カロリーを600に直して」と送ってください。
        </p>
        {slotButtons}
      </div>
      {pendingCard ? <div className="px-4 pt-3">{pendingCard}</div> : null}
      <MealPersonalChat
        fill
        messages={chatMessages}
        input={chatInput}
        busy={busy}
        canSend={Boolean(chatInput.trim() || mealPhotos.length)}
        onInput={setChatInput}
        onSend={() => void sendChat()}
        extra={
          <div className="space-y-2 border-t border-slate-100 bg-white px-3 py-2">
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => cameraInputRef.current?.click()}
                disabled={mealPhotos.length >= MAX_MEAL_PHOTOS}
                className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-800 disabled:opacity-50"
              >
                撮影
              </button>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={mealPhotos.length >= MAX_MEAL_PHOTOS}
                className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-800 disabled:opacity-50"
              >
                写真
              </button>
              <span className="self-center text-[11px] text-slate-500">
                {mealPhotos.length}/{MAX_MEAL_PHOTOS}
              </span>
            </div>
            {mealPhotos.length ? (
              <div className="grid grid-cols-4 gap-2">
                {mealPhotos.map((photo, i) => (
                  <div key={photo.preview} className="relative">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={photo.preview} alt={`食事写真${i + 1}`} className="h-14 w-full rounded-lg object-cover" />
                    <button
                      type="button"
                      onClick={() => removeMealPhoto(i)}
                      className="absolute right-1 top-1 rounded-full bg-black/70 px-1.5 py-0.5 text-[10px] font-semibold text-white"
                    >
                      削除
                    </button>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        }
      />
    </section>
  );

  const barcodeBody = (
    <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="space-y-1">
        {addBack}
        <div className="text-sm font-bold text-slate-900">バーコードで記録</div>
        <p className="text-xs leading-relaxed text-slate-500">
          市販品のJANをカメラか番号で読みます。カメラは画面いっぱいに開き、バーコード全体が枠に入れば読み取れます。
        </p>
      </div>
      {slotButtons}
      {pendingCard}
      <MealBarcodeInput busy={busy} onLookup={(code) => void lookupBarcode(code)} />
      {barcodeMiss ? (
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => continueBarcodeAsRecord(false)}
            className="rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm font-semibold text-slate-800"
          >
            手入力する
          </button>
          <button
            type="button"
            onClick={() => continueBarcodeAsRecord(true)}
            className="rounded-xl bg-slate-900 px-3 py-2.5 text-sm font-semibold text-white"
          >
            成分表を撮る
          </button>
        </div>
      ) : null}
    </section>
  );

  const addPicker = (
    <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="space-y-1">
        <div className="text-sm font-bold text-slate-900">記録する</div>
        <p className="text-xs leading-relaxed text-slate-500">チャットでも手入力でも、バーコードでも記録できます。</p>
      </div>
      {slotButtons}
      {pendingCard}
      {(
        [
          { id: "chat" as const, title: "チャット", desc: "相談しながら記録する", icon: MessageCircle },
          { id: "record" as const, title: "手入力", desc: "メニュー・グラム・写真で記録する", icon: Keyboard },
          { id: "barcode" as const, title: "バーコード", desc: "市販品のJANを読んで記録する", icon: ScanBarcode },
        ] as const
      ).map((item) => {
        const Icon = item.icon;
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => setAddMode(item.id)}
            className="flex w-full items-start gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-left"
          >
            <Icon className="mt-0.5 h-5 w-5 shrink-0 text-slate-700" />
            <span>
              <span className="block text-sm font-bold text-slate-900">{item.title}</span>
              <span className="mt-0.5 block text-xs text-slate-600">{item.desc}</span>
            </span>
          </button>
        );
      })}
    </section>
  );

  const suggestBody = (
    <div className="space-y-3">
      {suggestView === "menu" ? (
        <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <MealPlanSuggest
            remaining={remaining}
            totals={data.totals}
            nutrition={data.nutrition ?? null}
            todayMeals={data.today_meals}
            analysis={data.analysis}
          />
          <div className="space-y-2 border-t border-slate-100 pt-3">
            {readOnly ? null : (
              <button
                type="button"
                onClick={() => {
                  setAddMode("chat");
                  setTab("add");
                }}
                className="flex w-full items-start gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-left"
              >
                <MessageCircle className="mt-0.5 h-5 w-5 shrink-0 text-slate-700" />
                <span>
                  <span className="block text-sm font-bold text-slate-900">チャットで相談する</span>
                  <span className="mt-0.5 block text-xs text-slate-600">
                    「夜は定食とコンビニどっち？」のように聞くと、今の残りに合わせて返せます。
                  </span>
                </span>
              </button>
            )}
            <button
              type="button"
              onClick={() => setSuggestView("map")}
              className="flex w-full items-start gap-3 rounded-2xl border border-teal-200 bg-teal-50 px-4 py-3 text-left"
            >
              <MapPin className="mt-0.5 h-5 w-5 shrink-0 text-teal-800" />
              <span>
                <span className="block text-sm font-bold text-teal-900">マップからおすすめを見る</span>
                <span className="mt-0.5 block text-xs text-teal-800">
                  所属店舗の街、またはいまの位置から、セブン・大戸屋・やよい軒などを2〜3件出します。
                </span>
              </span>
            </button>
          </div>
          <HomeCookSuggest remaining={remaining} />
        </section>
      ) : (
        <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <button
            type="button"
            onClick={() => setSuggestView("menu")}
            className="text-xs font-semibold text-slate-600 underline"
          >
            提案メニューに戻る
          </button>
          <NearbyMealSuggest remaining={remaining} storeName={data.store_name} lat={geo?.lat} lng={geo?.lng} />
        </section>
      )}
    </div>
  );

  const reminderSection = (
    <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="space-y-1">
        <div className="text-sm font-bold text-slate-900">LINE配信時間</div>
        <p className="text-xs text-slate-500">朝昼夜と間食の案内を、この時刻に送ります（日本時間）。</p>
      </div>
      {readOnly ? (
        <div className="grid grid-cols-2 gap-2 text-sm text-slate-700">
          {(Object.keys(MEAL_SLOT_LABELS) as MealSlot[]).map((s) => (
            <div key={s}>
              {MEAL_SLOT_LABELS[s]} {data.reminder_settings?.[`${s}_time`] ?? "—"}
            </div>
          ))}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2">
            {(Object.keys(MEAL_SLOT_LABELS) as MealSlot[]).map((s) => (
              <label key={s} className="text-xs font-semibold text-slate-700">
                {MEAL_SLOT_LABELS[s]}
                <input
                  type="time"
                  value={reminderTimes[`${s}_time`]}
                  onChange={(e) =>
                    setReminderTimes((prev) => ({ ...prev, [`${s}_time`]: e.target.value }))
                  }
                  className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-normal"
                />
              </label>
            ))}
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={() => void saveReminderTimes()}
            className="w-full rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-800 disabled:opacity-60"
          >
            配信時間を保存
          </button>
        </>
      )}
    </section>
  );

  const lifestyleSection = (
    <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="text-sm font-bold text-slate-900">水分・お酒・お通じ</div>
      {readOnly ? (
        <div className="text-sm text-slate-700">
          水分 {data.today_lifestyle?.water_ml ?? "—"} ml / 酒 {data.today_lifestyle?.alcohol_drinks ?? "—"} 杯 / お通じ{" "}
          {data.today_lifestyle?.bowel_count ?? "—"} 回
        </div>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-2">
            <NumField label="水分 ml" value={water} onChange={setWater} placeholder="2000" />
            <NumField label="酒 杯" value={alcohol} onChange={setAlcohol} placeholder="0" />
            <NumField label="お通じ 回" value={bowel} onChange={setBowel} placeholder="1" />
          </div>
          <div className="grid grid-cols-4 gap-1">
            {(
              [
                ["", "状態"],
                ["normal", "普通"],
                ["hard", "硬い"],
                ["loose", "緩い"],
              ] as Array<[BowelQuality | "", string]>
            ).map(([v, label]) => (
              <button
                key={label}
                type="button"
                onClick={() => setBowelQuality(v)}
                className={[
                  "rounded-xl px-2 py-2 text-[11px] font-semibold",
                  bowelQuality === v ? "bg-slate-800 text-white" : "bg-slate-100 text-slate-700",
                ].join(" ")}
              >
                {label}
              </button>
            ))}
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={() => void saveLifestyle()}
            className="w-full rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-800 disabled:opacity-60"
          >
            生活記録を保存
          </button>
        </>
      )}
    </section>
  );

  const lockedFeatureCard = (
    <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="text-sm font-bold text-slate-900">課金すると使えます</div>
      <p className="text-xs text-slate-500">{priceLabel}に申し込むと、この項目が使えます。</p>
      {subscribeUrl ? (
        <a
          href={subscribeUrl}
          className="inline-flex w-full items-center justify-center rounded-xl bg-teal-800 px-4 py-2.5 text-sm font-semibold text-white"
        >
          オプションを申し込む
        </a>
      ) : (
        <p className="rounded-xl bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-700">現在お申し込みの準備中です</p>
      )}
    </section>
  );

  const settingsBody = (
    <div className="space-y-4">
      {settingsPage === "menu" ? (
        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          {locked ? (
            subscribeUrl ? (
              <a
                href={subscribeUrl}
                className="flex w-full items-center justify-between gap-3 border-b border-slate-100 px-4 py-4 text-left"
              >
                <span>
                  <span className="block text-sm font-bold text-slate-900">オプションに申し込む</span>
                  <span className="mt-0.5 block text-xs text-slate-500">{priceLabel}</span>
                </span>
                <ChevronRight className="h-4 w-4 shrink-0 text-slate-400" />
              </a>
            ) : (
              <div className="border-b border-slate-100 px-4 py-4">
                <div className="text-sm font-bold text-slate-900">オプションに申し込む</div>
                <div className="mt-0.5 text-xs text-slate-500">現在お申し込みの準備中です</div>
              </div>
            )
          ) : null}
          <SettingsRow
            title="目標設定"
            hint={data.nutrition ? `${formatIntakeLabel(data.nutrition)}kcal` : "未設定"}
            onClick={() => setSettingsPage("goal")}
          />
          <SettingsRow
            title="LINE配信時間"
            hint={locked ? "課金すると使えます" : undefined}
            locked={locked}
            onClick={() => setSettingsPage("reminders")}
          />
          <SettingsRow
            title="水分・お酒・お通じ"
            hint={locked ? "課金すると使えます" : undefined}
            locked={locked}
            last
            onClick={() => setSettingsPage("lifestyle")}
          />
        </section>
      ) : null}

      {settingsPage === "goal" ? (
        <MealPersonalGoalSettings
          current={data.nutrition ?? null}
          onBack={() => setSettingsPage("menu")}
          onSaved={(next) => {
            setData((prev) => (prev ? { ...prev, nutrition: next } : prev));
          }}
        />
      ) : null}

      {settingsPage === "reminders" ? (
        <div className="space-y-4">
          <button type="button" onClick={() => setSettingsPage("menu")} className="inline-flex items-center gap-1 text-xs font-semibold text-slate-600">
            <ChevronLeft className="h-4 w-4" />
            設定に戻る
          </button>
          {locked ? lockedFeatureCard : reminderSection}
        </div>
      ) : null}

      {settingsPage === "lifestyle" ? (
        <div className="space-y-4">
          <button type="button" onClick={() => setSettingsPage("menu")} className="inline-flex items-center gap-1 text-xs font-semibold text-slate-600">
            <ChevronLeft className="h-4 w-4" />
            設定に戻る
          </button>
          {locked ? lockedFeatureCard : lifestyleSection}
        </div>
      ) : null}
    </div>
  );

  function withPaywall(body: ReactNode) {
    if (!locked) return body;
    return (
      <MealPersonalPaywall priceLabel={priceLabel} subscribeUrl={subscribeUrl}>
        {body}
      </MealPersonalPaywall>
    );
  }

  const addBody =
    addMode === "chat"
      ? chatBody
      : addMode === "record"
        ? recordBody
        : addMode === "barcode"
          ? barcodeBody
          : (
            <div className="space-y-4">
              {addPicker}
              {locked ? (
                <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                  <div className="text-sm font-bold text-slate-900">トレーニングを記録</div>
                  <div className="mt-2 text-sm text-slate-600">ジム・45分・調子ふつう</div>
                </section>
              ) : (
                <TrainingLogPanel signed={signed} />
              )}
            </div>
          );

  return (
    <div className={useTabs ? "space-y-4 pb-28" : "space-y-4"}>
      {photoInputs}
      {statusBanners}
      {compact ? (
        homeBody
      ) : (
        <>
          {activeTab === "home" ? homeBody : null}
          {activeTab === "diary" ? withPaywall(diaryBody) : null}
          {activeTab === "add" && !readOnly ? withPaywall(addBody) : null}
          {activeTab === "suggest" ? withPaywall(suggestBody) : null}
          {activeTab === "settings" ? settingsBody : null}
          <MealPersonalTabBar
            tab={activeTab}
            readOnly={readOnly}
            locked={locked}
            pending={Boolean(pending)}
            onChange={(next) => {
              if (next === "add") setAddMode("picker");
              setTab(next);
            }}
          />
        </>
      )}
    </div>
  );
}

function MealLogCard({
  meal,
  showDate,
  readOnly,
  busy,
  editing,
  draft,
  onDraftChange,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
  onDelete,
}: {
  meal: MemberMealLogView;
  showDate: boolean;
  readOnly: boolean;
  busy: boolean;
  editing: boolean;
  draft: { items: string; kcal: string; protein_g: string; fat_g: string; carb_g: string } | null;
  onDraftChange: (next: { items: string; kcal: string; protein_g: string; fat_g: string; carb_g: string }) => void;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onSaveEdit: () => void;
  onDelete: () => void;
}) {
  const photos = meal.photo_urls?.length ? meal.photo_urls : meal.photo_url ? [meal.photo_url] : [];
  return (
    <div className="rounded-xl border border-slate-200 px-3 py-2 space-y-2">
      <div className="flex gap-3">
        {photos.length ? (
          <div className="flex gap-1">
            {photos.slice(0, 2).map((src) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={src} src={src} alt="" className="h-14 w-14 rounded-lg object-cover" />
            ))}
          </div>
        ) : (
          <div className="h-14 w-14 rounded-lg bg-slate-100" />
        )}
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold leading-snug text-slate-900">
            {showDate ? `${formatYmd(meal.log_date)} ` : ""}
            {meal.items.length ? meal.items.join("・") : MEAL_SLOT_LABELS[meal.meal_slot]}
          </div>
          <div className="text-xs text-slate-500">
            {MEAL_SLOT_LABELS[meal.meal_slot]} {meal.kcal}kcal　P{meal.protein_g} / F{meal.fat_g} / C{meal.carb_g}
          </div>
          {meal.note ? <div className="text-[11px] text-slate-500">{meal.note}</div> : null}
        </div>
      </div>
      {readOnly ? null : editing && draft ? (
        <div className="space-y-2">
          <textarea
            value={draft.items}
            onChange={(e) => onDraftChange({ ...draft, items: e.target.value })}
            rows={2}
            placeholder="メニュー（改行や・で区切る）"
            className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm"
          />
          <div className="grid grid-cols-4 gap-1">
            {(
              [
                ["kcal", "kcal"],
                ["protein_g", "P"],
                ["fat_g", "F"],
                ["carb_g", "C"],
              ] as const
            ).map(([key, label]) => (
              <label key={key} className="text-[10px] font-semibold text-slate-600">
                {label}
                <input
                  inputMode="decimal"
                  value={draft[key]}
                  onChange={(e) => onDraftChange({ ...draft, [key]: e.target.value })}
                  className="mt-0.5 w-full rounded-lg border border-slate-200 px-1.5 py-1 text-xs font-normal"
                />
              </label>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={onCancelEdit}
              className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-800"
            >
              やめる
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={onSaveEdit}
              className="rounded-xl bg-teal-800 px-3 py-2 text-xs font-semibold text-white disabled:opacity-60"
            >
              {busy ? "保存中…" : "修正を保存"}
            </button>
          </div>
        </div>
      ) : (
        <div className="flex justify-end gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={onStartEdit}
            className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-700 disabled:opacity-60"
          >
            修正
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onDelete}
            className="rounded-lg border border-red-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-red-700 disabled:opacity-60"
          >
            削除
          </button>
        </div>
      )}
    </div>
  );
}

function IntakeDashboard({
  today,
  totals,
  remaining,
  nutrition,
  feedback,
  analysis,
  kcalSeries,
  proteinSeries,
  intakeMode,
  onIntakeMode,
  showTitle = true,
  weightHint = false,
}: {
  today: string;
  totals: MealDayTotals;
  remaining: MealRemaining | null;
  nutrition: MemberNutritionTargetView | null;
  feedback: MealFeedback | null;
  analysis?: MealAnalysisHint;
  kcalSeries: number[];
  proteinSeries: number[];
  intakeMode: "intake" | "remaining";
  onIntakeMode: (mode: "intake" | "remaining") => void;
  showTitle?: boolean;
  weightHint?: boolean;
}) {
  const targetKcal = nutrition?.intake_kcal ?? 0;
  const remainingKcal = remaining?.kcal ?? Math.max(0, targetKcal - totals.kcal);
  const centerValue = intakeMode === "remaining" ? Math.max(0, remainingKcal) : totals.kcal;
  const centerLabel = intakeMode === "remaining" ? "残り摂取量" : "摂取量";

  return (
    <div className="space-y-4">
      {showTitle ? (
        <div className="text-center">
          <div className="text-3xl font-bold tracking-tight text-slate-900">ホーム</div>
          {weightHint ? <div className="mt-0.5 text-[11px] font-semibold text-slate-400">体重 →</div> : null}
          <div className="mt-2 text-2xl font-bold tracking-tight text-slate-900">{formatHomeDate(today)}</div>
        </div>
      ) : (
        <div className="text-2xl font-bold tracking-tight text-slate-900">{formatHomeDate(today)}</div>
      )}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="text-lg font-bold text-slate-900">今日の摂取量</div>
        <CalorieRing
          consumed={totals.kcal}
          target={targetKcal}
          remaining={remainingKcal}
          centerValue={centerValue}
          centerLabel={centerLabel}
        />
        <div className="mt-5 grid grid-cols-3 gap-3">
          <MacroBar label="たんぱく質" consumed={totals.protein_g} target={nutrition?.protein_g ?? 0} color="#f97316" />
          <MacroBar label="脂質" consumed={totals.fat_g} target={nutrition?.fat_g ?? 0} color="#eab308" />
          <MacroBar label="炭水化物" consumed={totals.carb_g} target={nutrition?.carb_g ?? 0} color="#22c55e" />
        </div>
        <div className="mt-5 flex justify-center">
          <div className="inline-flex rounded-full bg-slate-100 p-1">
            {(
              [
                ["intake", "摂取量"],
                ["remaining", "残り摂取量"],
              ] as const
            ).map(([mode, label]) => (
              <button
                key={mode}
                type="button"
                onClick={() => onIntakeMode(mode)}
                className={[
                  "rounded-full px-4 py-1.5 text-xs font-semibold",
                  intakeMode === mode ? "bg-slate-900 text-white" : "text-slate-500",
                ].join(" ")}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>
      {feedback?.headline ? (
        <div className="rounded-2xl border border-slate-200 bg-white px-4 py-4 text-sm text-slate-800 shadow-sm">
          <div className="font-semibold">{feedback.headline}</div>
          {feedback.tips?.length ? (
            <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-slate-600">
              {feedback.tips.map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
      {analysis ? (
        <div className="space-y-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="text-lg font-bold text-slate-900">現状の分析</div>
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-2xl bg-slate-50 px-3 py-3">
              <div className="text-sm font-semibold text-slate-900">摂取カロリー</div>
              <div className="text-[11px] text-slate-500">直近7日</div>
              <Sparkline values={kcalSeries} color="#fb923c" />
            </div>
            <div className="rounded-2xl bg-slate-50 px-3 py-3">
              <div className="text-sm font-semibold text-slate-900">たんぱく質</div>
              <div className="text-[11px] text-slate-500">直近7日</div>
              <Sparkline values={proteinSeries} color="#818cf8" />
            </div>
          </div>
          {analysis.hints.length ? (
            <div className="space-y-1">
              {analysis.hints.map((h) => (
                <div key={h} className="text-sm text-slate-600">
                  {h}
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function CalorieRing({
  consumed,
  target,
  remaining,
  centerValue,
  centerLabel,
}: {
  consumed: number;
  target: number;
  remaining: number;
  centerValue: number;
  centerLabel: string;
}) {
  const size = 168;
  const stroke = 10;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const arc = c * 0.78;
  const gap = c - arc;
  const ratio = target > 0 ? Math.min(consumed / target, 1) : 0;
  const remainingShown = remaining >= 0 ? remaining : 0;

  return (
    <div className="mt-4 flex items-center justify-between gap-2">
      <div className="w-16 text-center">
        <div className="text-2xl font-bold text-slate-900">{remainingShown}</div>
        <div className="mt-0.5 text-[11px] leading-tight text-slate-500">残り摂取量</div>
      </div>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="shrink-0">
        <g transform={`rotate(140 ${size / 2} ${size / 2})`}>
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke="#e2e8f0"
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={`${arc} ${gap}`}
          />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke={consumed > target && target > 0 ? "#f97316" : "#3b82f6"}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={`${arc * ratio} ${c}`}
          />
        </g>
        <text x="50%" y="46%" textAnchor="middle" className="fill-slate-900" fontSize="32" fontWeight="700">
          {centerValue}
        </text>
        <text x="50%" y="60%" textAnchor="middle" className="fill-slate-500" fontSize="11">
          {centerLabel}
        </text>
      </svg>
      <div className="w-16 text-center">
        <div className="text-2xl font-bold text-slate-900">{target || "—"}</div>
        <div className="mt-0.5 text-[11px] leading-tight text-slate-500">目標値</div>
      </div>
    </div>
  );
}

function MacroBar({
  label,
  consumed,
  target,
  color,
}: {
  label: string;
  consumed: number;
  target: number;
  color: string;
}) {
  const ratio = target > 0 ? Math.min(consumed / target, 1) : 0;
  const over = target > 0 && consumed > target;
  return (
    <div>
      <div className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-600">
        <span className="h-2 w-2 rounded-full" style={{ background: color }} />
        {label}
      </div>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-100">
        <div
          className="h-full rounded-full"
          style={{ width: `${Math.max(ratio * 100, consumed > 0 ? 4 : 0)}%`, background: over ? "#ef4444" : color }}
        />
      </div>
      <div className="mt-1 text-xs font-medium text-slate-700">
        {Math.round(consumed)} / {target || "—"}g
      </div>
    </div>
  );
}

function Sparkline({ values, color }: { values: number[]; color: string }) {
  const w = 140;
  const h = 48;
  const pad = 6;
  const max = Math.max(...values, 1);
  const points = values.map((v, i) => {
    const x = pad + (i * (w - pad * 2)) / Math.max(values.length - 1, 1);
    const y = h - pad - (v / max) * (h - pad * 2);
    return { x, y };
  });
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="mt-2 h-12 w-full">
      <polyline
        fill="none"
        stroke={color}
        strokeWidth="2"
        strokeLinejoin="round"
        strokeLinecap="round"
        points={points.map((p) => `${p.x},${p.y}`).join(" ")}
      />
      {points.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r="2.4" fill={color} />
      ))}
    </svg>
  );
}

function SettingsRow({
  title,
  hint,
  locked,
  last,
  onClick,
}: {
  title: string;
  hint?: string;
  locked?: boolean;
  last?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "flex w-full items-center justify-between gap-3 px-4 py-4 text-left",
        last ? "" : "border-b border-slate-100",
      ].join(" ")}
    >
      <span>
        <span className="inline-flex items-center gap-1 text-sm font-bold text-slate-900">
          {locked ? <Lock className="h-3.5 w-3.5" strokeWidth={2.4} /> : null}
          {title}
        </span>
        {hint ? <span className="mt-0.5 block text-xs text-slate-500">{hint}</span> : null}
      </span>
      <ChevronRight className="h-4 w-4 shrink-0 text-slate-400" />
    </button>
  );
}

function MealPersonalTabBar({
  tab,
  readOnly,
  locked,
  pending,
  onChange,
}: {
  tab: MealPersonalTab;
  readOnly: boolean;
  locked: boolean;
  pending: boolean;
  onChange: (tab: MealPersonalTab) => void;
}) {
  const items: Array<{ id: MealPersonalTab; label: string; icon: typeof Home } | { id: "add"; plus: true }> = readOnly
    ? [
        { id: "home", label: "ホーム", icon: Home },
        { id: "diary", label: "日記", icon: Apple },
        { id: "suggest", label: "提案", icon: MapPin },
        { id: "settings", label: "設定", icon: Settings },
      ]
    : [
        { id: "home", label: "ホーム", icon: Home },
        { id: "diary", label: "日記", icon: Apple },
        { id: "add", plus: true },
        { id: "suggest", label: "提案", icon: MapPin },
        { id: "settings", label: "設定", icon: Settings },
      ];

  return (
    <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur">
      <div className="mx-auto flex max-w-3xl items-end px-2 pt-1">
        {items.map((item) => {
          if ("plus" in item) {
            return (
              <button
                key="add"
                type="button"
                onClick={() => onChange("add")}
                className="relative flex flex-1 flex-col items-center justify-end pb-1"
                aria-label="記録する"
              >
                <span
                  className={[
                    "-mt-5 flex h-14 w-14 items-center justify-center rounded-full text-white shadow-lg",
                    tab === "add" ? "bg-slate-900" : "bg-slate-800",
                  ].join(" ")}
                >
                  <Plus className="h-8 w-8" strokeWidth={2.6} />
                </span>
                <span
                  className={[
                    "mt-0.5 inline-flex items-center gap-0.5 text-[10px] font-semibold",
                    tab === "add" ? "text-slate-900" : "text-slate-400",
                  ].join(" ")}
                >
                  {locked ? <Lock className="h-2.5 w-2.5" strokeWidth={2.4} /> : null}
                  記録
                </span>
                {pending ? (
                  <span className="absolute right-[calc(50%-28px)] top-0 h-2.5 w-2.5 rounded-full bg-orange-500" />
                ) : null}
              </button>
            );
          }
          const Icon = item.icon;
          const active = tab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onChange(item.id)}
              className={[
                "flex flex-1 flex-col items-center gap-0.5 py-2 text-[10px] font-semibold",
                active ? "text-slate-900" : "text-slate-400",
              ].join(" ")}
            >
              <Icon className="h-5 w-5" strokeWidth={active ? 2.4 : 1.8} />
              <span className="inline-flex items-center gap-0.5">
                {locked && item.id !== "home" && item.id !== "settings" ? (
                  <Lock className="h-2.5 w-2.5" strokeWidth={2.4} />
                ) : null}
                {item.label}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}

function PendingEstimateCard({
  pending,
  busy,
  onChange,
  onRetry,
  onConfirm,
}: {
  pending: MealEstimate;
  busy: boolean;
  onChange: (next: MealEstimate | ((prev: MealEstimate | null) => MealEstimate | null)) => void;
  onRetry: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="space-y-3 rounded-xl border border-teal-200 bg-teal-50 px-3 py-3">
      <div className="text-xs font-semibold text-teal-900">この内容で記録します。名前や数字が違ったら直してください。</div>
      {pendingItems(pending).map((item, i) => (
        <div key={i} className="space-y-1.5">
          <input
            value={item.name}
            onChange={(e) => {
              const name = e.target.value;
              onChange((prev) =>
                prev ? withPendingDetails(prev, pendingItems(prev).map((row, j) => (j === i ? { ...row, name } : row))) : prev
              );
            }}
            className="w-full rounded-lg border border-teal-200 bg-white px-2 py-1.5 text-sm"
          />
          <div className="grid grid-cols-4 gap-1">
            {(
              [
                ["kcal", "kcal", item.kcal],
                ["protein_g", "P", item.protein_g],
                ["fat_g", "F", item.fat_g],
                ["carb_g", "C", item.carb_g],
              ] as const
            ).map(([key, label, value]) => (
              <label key={key} className="text-[10px] font-semibold text-teal-800">
                {label}
                <input
                  inputMode="decimal"
                  value={value}
                  onChange={(e) => {
                    const n = Number(e.target.value);
                    onChange((prev) => {
                      if (!prev) return prev;
                      const next = pendingItems(prev).map((row, j) =>
                        j === i
                          ? {
                              ...row,
                              [key]: Number.isFinite(n) ? n : 0,
                              source: (row.source === "catalog" ? "catalog" : "label") as MealEstimateItem["source"],
                            }
                          : row
                      );
                      return withPendingDetails(prev, next);
                    });
                  }}
                  className="mt-0.5 w-full rounded-lg border border-teal-200 bg-white px-1.5 py-1 text-xs font-normal"
                />
              </label>
            ))}
          </div>
          <div className="text-[11px] text-teal-800">{sourceBadge(item.source)}</div>
        </div>
      ))}
      <div className="text-sm font-semibold text-teal-950">
        {pending.kcal}kcal　P{pending.protein_g} / F{pending.fat_g} / C{pending.carb_g}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={onRetry}
          className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-800"
        >
          やり直す
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={onConfirm}
          className="rounded-xl bg-teal-800 px-3 py-2 text-sm font-semibold text-white disabled:opacity-60"
        >
          {busy ? "保存中…" : "この内容で記録"}
        </button>
      </div>
    </div>
  );
}

function NumField({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  return (
    <label className="text-xs font-semibold text-slate-700">
      {label}
      <input
        inputMode="decimal"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="mt-1 w-full rounded-xl border border-slate-200 px-2 py-2 text-sm font-normal"
      />
    </label>
  );
}
