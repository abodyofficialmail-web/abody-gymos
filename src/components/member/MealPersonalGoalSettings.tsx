"use client";

import {
  ACTIVITY_OPTIONS,
  PRIMARY_GOAL_OPTIONS,
  SEX_OPTIONS,
  WEIGHT_DIRECTION_OPTIONS,
  type GoalHearingFormPayload,
} from "@/lib/goalHearing";
import { estimateGoalHearingNutrition } from "@/lib/goalHearingNutrition";
import { formatIntakeLabel, type MemberNutritionTargetView } from "@/lib/memberNutritionTargets";
import { useEffect, useMemo, useState } from "react";

export type NutritionProfile = {
  sex?: string | null;
  age_years?: number | null;
  height_cm?: number | null;
  current_weight_kg?: number | null;
  target_weight_kg?: number | null;
  activity_level?: string | null;
  weight_direction?: string | null;
  primary_goal?: string | null;
};

function pfcPercents(target: { protein_g: number; fat_g: number; carb_g: number }) {
  const p = target.protein_g * 4;
  const f = target.fat_g * 9;
  const c = target.carb_g * 4;
  const total = p + f + c;
  if (total <= 0) return { p: 0, f: 0, c: 0 };
  return {
    p: Math.round((p / total) * 100),
    f: Math.round((f / total) * 100),
    c: Math.round((c / total) * 100),
  };
}

function toForm(input: {
  sex: string;
  age: string;
  height: string;
  weight: string;
  targetWeight: string;
  activity: string;
  direction: string;
  primaryGoal: string;
}): GoalHearingFormPayload | null {
  const sex = input.sex === "male" || input.sex === "female" ? input.sex : null;
  const age = Number(input.age);
  const height = Number(input.height);
  const weight = Number(input.weight);
  if (!sex || !Number.isFinite(age) || !Number.isFinite(height) || !Number.isFinite(weight)) return null;
  const targetWeight = input.targetWeight.trim() === "" ? null : Number(input.targetWeight);
  return {
    primary_goal: input.primaryGoal || "habit",
    focus_areas: [],
    weight_direction: input.direction || "maintain",
    current_weight_kg: weight,
    target_weight_kg: targetWeight != null && Number.isFinite(targetWeight) ? targetWeight : null,
    deadline_type: "none",
    sex,
    age_years: Math.round(age),
    height_cm: height,
    activity_level: input.activity || "light",
    ideal_frequency: "week_2",
    sleep_hours: "7_8",
    challenges: [],
    pain_areas: [],
    goal_photo_paths: ["placeholder"],
  };
}

export function MealPersonalGoalSettings({
  current,
  onSaved,
}: {
  current?: MemberNutritionTargetView | null;
  onSaved?: (target: MemberNutritionTargetView) => void;
}) {
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [target, setTarget] = useState<MemberNutritionTargetView | null>(current ?? null);
  const [sex, setSex] = useState("female");
  const [age, setAge] = useState("");
  const [height, setHeight] = useState("");
  const [weight, setWeight] = useState("");
  const [targetWeight, setTargetWeight] = useState("");
  const [activity, setActivity] = useState("light");
  const [direction, setDirection] = useState("lose");
  const [primaryGoal, setPrimaryGoal] = useState("diet");

  useEffect(() => {
    if (current) setTarget(current);
  }, [current]);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/member/nutrition-targets", { cache: "no-store" })
      .then(async (res) => {
        const json = (await res.json().catch(() => ({}))) as {
          target?: MemberNutritionTargetView | null;
          profile?: NutritionProfile | null;
        };
        if (cancelled) return;
        if (json.target) setTarget(json.target);
        const p = json.profile;
        if (!p) return;
        if (p.sex === "male" || p.sex === "female") setSex(p.sex);
        if (p.age_years != null) setAge(String(p.age_years));
        if (p.height_cm != null) setHeight(String(p.height_cm));
        if (p.current_weight_kg != null) setWeight(String(p.current_weight_kg));
        if (p.target_weight_kg != null) setTargetWeight(String(p.target_weight_kg));
        if (p.activity_level) setActivity(p.activity_level);
        if (p.weight_direction) setDirection(p.weight_direction);
        if (p.primary_goal) setPrimaryGoal(p.primary_goal);
      })
      .catch(() => {
        if (!cancelled) setErr("いまの設定を読み込めませんでした");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const preview = useMemo(
    () =>
      estimateGoalHearingNutrition(
        toForm({ sex, age, height, weight, targetWeight, activity, direction, primaryGoal }) ??
          ({ current_weight_kg: null } as GoalHearingFormPayload)
      ),
    [sex, age, height, weight, targetWeight, activity, direction, primaryGoal]
  );

  const shown = preview
    ? {
        daily_expenditure_kcal: preview.tdee,
        intake_kcal: preview.intake_mid,
        intake_kcal_min: preview.intake_min,
        intake_kcal_max: preview.intake_max,
        protein_g: preview.protein_g,
        fat_g: preview.fat_g,
        carb_g: preview.carb_g,
        note: preview.note,
      }
    : target
      ? target
      : null;
  const pct = shown ? pfcPercents(shown) : null;

  async function save() {
    const form = toForm({ sex, age, height, weight, targetWeight, activity, direction, primaryGoal });
    if (!form) {
      setErr("性別・年齢・身長・いまの体重を入れてください");
      return;
    }
    setBusy(true);
    setErr(null);
    setSaved(null);
    try {
      const res = await fetch("/api/member/nutrition-targets", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sex: form.sex,
          age_years: form.age_years,
          height_cm: form.height_cm,
          current_weight_kg: form.current_weight_kg,
          target_weight_kg: form.target_weight_kg,
          activity_level: form.activity_level,
          weight_direction: form.weight_direction,
          primary_goal: form.primary_goal,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as { target?: MemberNutritionTargetView; error?: string };
      if (!res.ok) throw new Error(json.error || "保存に失敗しました");
      if (!json.target) throw new Error("カロリーとPFCを出せませんでした。体重・身長・年齢を確認してください");
      setTarget(json.target);
      setSaved("いまの設定と目標から、カロリーとPFCを出しました");
      onSaved?.(json.target);
    } catch (e) {
      setErr(String((e as Error)?.message ?? "保存に失敗しました"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="space-y-1">
          <div className="text-sm font-bold text-slate-900">いまの消費カロリー・PFC</div>
          <p className="text-xs text-slate-500">いまの設定と目標から出した1日の目安です。トレーナーが調整する場合があります。</p>
        </div>
        {loading ? (
          <div className="text-sm text-slate-600">読み込み中…</div>
        ) : shown ? (
          <>
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3">
                <div className="text-[11px] font-semibold text-slate-500">1日の消費カロリー</div>
                <div className="mt-0.5 text-lg font-bold text-slate-900">
                  {shown.daily_expenditure_kcal}
                  <span className="ml-1 text-xs font-semibold text-slate-500">kcal</span>
                </div>
              </div>
              <div className="rounded-xl border border-teal-200 bg-teal-50 px-3 py-3">
                <div className="text-[11px] font-semibold text-teal-800">目標摂取カロリー</div>
                <div className="mt-0.5 text-lg font-bold text-teal-900">
                  {formatIntakeLabel(shown)}
                  <span className="ml-1 text-xs font-semibold text-teal-700">kcal</span>
                </div>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2 text-center">
              <div>
                <div className="text-[11px] font-semibold text-rose-700">P たんぱく質</div>
                <div className="text-base font-bold text-slate-900">{shown.protein_g}g</div>
                <div className="text-[11px] text-slate-500">{pct?.p ?? 0}%</div>
              </div>
              <div>
                <div className="text-[11px] font-semibold text-amber-700">F 脂質</div>
                <div className="text-base font-bold text-slate-900">{shown.fat_g}g</div>
                <div className="text-[11px] text-slate-500">{pct?.f ?? 0}%</div>
              </div>
              <div>
                <div className="text-[11px] font-semibold text-sky-700">C 炭水化物</div>
                <div className="text-base font-bold text-slate-900">{shown.carb_g}g</div>
                <div className="text-[11px] text-slate-500">{pct?.c ?? 0}%</div>
              </div>
            </div>
            {shown.note ? <div className="text-xs text-slate-600">※{shown.note}</div> : null}
          </>
        ) : (
          <p className="text-sm text-slate-600">まだ出せていません。下の目標設定を入れてください。</p>
        )}
      </section>

      <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="space-y-1">
          <div className="text-sm font-bold text-slate-900">目標設定する</div>
          <p className="text-xs text-slate-500">いまの体と目標を入れると、消費カロリーとPFCを出します。</p>
        </div>
        <label className="block text-xs font-semibold text-slate-700">
          性別
          <select value={sex} onChange={(e) => setSex(e.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-normal">
            {SEX_OPTIONS.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <div className="grid grid-cols-3 gap-2">
          <label className="text-xs font-semibold text-slate-700">
            年齢
            <input value={age} onChange={(e) => setAge(e.target.value)} inputMode="numeric" placeholder="30" className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-normal" />
          </label>
          <label className="text-xs font-semibold text-slate-700">
            身長 cm
            <input value={height} onChange={(e) => setHeight(e.target.value)} inputMode="decimal" placeholder="165" className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-normal" />
          </label>
          <label className="text-xs font-semibold text-slate-700">
            いまの体重 kg
            <input value={weight} onChange={(e) => setWeight(e.target.value)} inputMode="decimal" placeholder="60" className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-normal" />
          </label>
        </div>
        <label className="block text-xs font-semibold text-slate-700">
          目標体重 kg（任意）
          <input
            value={targetWeight}
            onChange={(e) => setTargetWeight(e.target.value)}
            inputMode="decimal"
            placeholder="空欄でも可"
            className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-normal"
          />
        </label>
        <label className="block text-xs font-semibold text-slate-700">
          いちばんの目標
          <select value={primaryGoal} onChange={(e) => setPrimaryGoal(e.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-normal">
            {PRIMARY_GOAL_OPTIONS.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-xs font-semibold text-slate-700">
          体重の方向
          <select value={direction} onChange={(e) => setDirection(e.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-normal">
            {WEIGHT_DIRECTION_OPTIONS.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-xs font-semibold text-slate-700">
          普段の活動量
          <select value={activity} onChange={(e) => setActivity(e.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-normal">
            {ACTIVITY_OPTIONS.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        {err ? <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">{err}</div> : null}
        {saved ? <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">{saved}</div> : null}
        <button
          type="button"
          disabled={busy}
          onClick={() => void save()}
          className="w-full rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
        >
          {busy ? "計算中…" : "カロリーとPFCを出す"}
        </button>
      </section>
    </div>
  );
}
