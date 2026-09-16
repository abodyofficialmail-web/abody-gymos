"use client";

import {
  ACTIVITY_OPTIONS,
  PRIMARY_GOAL_OPTIONS,
  SEX_OPTIONS,
  WEIGHT_DIRECTION_OPTIONS,
  type GoalHearingFormPayload,
} from "@/lib/goalHearing";
import {
  estimateGoalHearingNutrition,
  formatMonthlyChangeLabel,
  isWeightPace,
  WEIGHT_PACE_OPTIONS,
  type WeightPace,
} from "@/lib/goalHearingNutrition";
import { formatIntakeLabel, type MemberNutritionTargetView } from "@/lib/memberNutritionTargets";
import { ChevronLeft } from "lucide-react";
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
  weight_pace?: string | null;
};

type Method = "pick" | "form" | "quiz";
type QuizStep = "primary" | "direction" | "sex" | "body" | "target" | "activity" | "pace" | "confirm";

const QUIZ_STEPS: QuizStep[] = ["primary", "direction", "sex", "body", "target", "activity", "pace", "confirm"];

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

function needsPace(direction: string, weight: string, targetWeight: string): boolean {
  if (direction === "lose" || direction === "gain") return true;
  if (direction !== "looks") return false;
  const current = Number(weight);
  const target = Number(targetWeight);
  if (!Number.isFinite(current) || !Number.isFinite(target)) return false;
  return Math.abs(target - current) > 0.5;
}

function paceTitle(direction: string): string {
  return direction === "gain" ? "増量スピード" : "減量スピード";
}

function ChoiceButtons({
  options,
  value,
  onChange,
}: {
  options: Array<{ id: string; label: string; hint?: string }>;
  value: string;
  onChange: (id: string) => void;
}) {
  return (
    <div className="space-y-2">
      {options.map((opt) => {
        const active = value === opt.id;
        return (
          <button
            key={opt.id}
            type="button"
            onClick={() => onChange(opt.id)}
            className={[
              "w-full rounded-2xl border px-4 py-3 text-left",
              active ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-800",
            ].join(" ")}
          >
            <div className="text-sm font-semibold">{opt.label}</div>
            {opt.hint ? (
              <div className={["mt-0.5 text-xs", active ? "text-white/80" : "text-slate-500"].join(" ")}>{opt.hint}</div>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

function ResultCard({
  shown,
}: {
  shown: {
    daily_expenditure_kcal: number;
    intake_kcal: number;
    intake_kcal_min: number | null;
    intake_kcal_max: number | null;
    protein_g: number;
    fat_g: number;
    carb_g: number;
    note?: string | null;
    monthly?: string | null;
  };
}) {
  const pct = pfcPercents(shown);
  return (
    <div className="space-y-3">
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
          <div className="text-[11px] text-slate-500">{pct.p}%</div>
        </div>
        <div>
          <div className="text-[11px] font-semibold text-amber-700">F 脂質</div>
          <div className="text-base font-bold text-slate-900">{shown.fat_g}g</div>
          <div className="text-[11px] text-slate-500">{pct.f}%</div>
        </div>
        <div>
          <div className="text-[11px] font-semibold text-sky-700">C 炭水化物</div>
          <div className="text-base font-bold text-slate-900">{shown.carb_g}g</div>
          <div className="text-[11px] text-slate-500">{pct.c}%</div>
        </div>
      </div>
      {shown.monthly ? <div className="text-xs text-slate-600">1ヶ月の体重目安: {shown.monthly}</div> : null}
      {shown.note ? <div className="text-xs text-slate-600">※{shown.note}</div> : null}
    </div>
  );
}

export function MealPersonalGoalSettings({
  current,
  onSaved,
  onBack,
}: {
  current?: MemberNutritionTargetView | null;
  onSaved?: (target: MemberNutritionTargetView) => void;
  onBack?: () => void;
}) {
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [target, setTarget] = useState<MemberNutritionTargetView | null>(current ?? null);
  const [method, setMethod] = useState<Method>("pick");
  const [quizStep, setQuizStep] = useState<QuizStep>("primary");
  const [sex, setSex] = useState("female");
  const [age, setAge] = useState("");
  const [height, setHeight] = useState("");
  const [weight, setWeight] = useState("");
  const [targetWeight, setTargetWeight] = useState("");
  const [activity, setActivity] = useState("light");
  const [direction, setDirection] = useState("lose");
  const [primaryGoal, setPrimaryGoal] = useState("diet");
  const [pace, setPace] = useState<WeightPace>("normal");

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
        if (isWeightPace(p.weight_pace)) setPace(p.weight_pace);
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

  const form = useMemo(
    () => toForm({ sex, age, height, weight, targetWeight, activity, direction, primaryGoal }),
    [sex, age, height, weight, targetWeight, activity, direction, primaryGoal]
  );
  const showPace = needsPace(direction, weight, targetWeight);
  const preview = useMemo(
    () => estimateGoalHearingNutrition(form ?? ({ current_weight_kg: null } as GoalHearingFormPayload), { pace: showPace ? pace : null }),
    [form, pace, showPace]
  );

  async function save() {
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
          weight_pace: showPace ? pace : null,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as { target?: MemberNutritionTargetView; error?: string };
      if (!res.ok) throw new Error(json.error || "保存に失敗しました");
      if (!json.target) throw new Error("カロリーとPFCを出せませんでした。体重・身長・年齢を確認してください");
      setTarget(json.target);
      setSaved("いまの設定と目標から、カロリーとPFCを出しました");
      setMethod("pick");
      setQuizStep("primary");
      onSaved?.(json.target);
    } catch (e) {
      setErr(String((e as Error)?.message ?? "保存に失敗しました"));
    } finally {
      setBusy(false);
    }
  }

  function visibleQuizSteps(): QuizStep[] {
    return QUIZ_STEPS.filter((s) => s !== "pace" || showPace);
  }

  function goQuiz(next: 1 | -1) {
    const steps = visibleQuizSteps();
    const i = steps.indexOf(quizStep);
    const n = steps[i + next];
    if (n) {
      setErr(null);
      setQuizStep(n);
    }
  }

  function canProceedQuiz(): boolean {
    if (quizStep === "body") return Boolean(toForm({ sex, age, height, weight, targetWeight, activity, direction, primaryGoal }));
    if (quizStep === "confirm") return Boolean(form);
    return true;
  }

  const inputClass = "mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-normal";

  const formFields = (
    <div className="space-y-3">
      <label className="block text-xs font-semibold text-slate-700">
        性別
        <select value={sex} onChange={(e) => setSex(e.target.value)} className={inputClass}>
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
          <input value={age} onChange={(e) => setAge(e.target.value)} inputMode="numeric" placeholder="30" className={inputClass} />
        </label>
        <label className="text-xs font-semibold text-slate-700">
          身長 cm
          <input value={height} onChange={(e) => setHeight(e.target.value)} inputMode="decimal" placeholder="165" className={inputClass} />
        </label>
        <label className="text-xs font-semibold text-slate-700">
          いまの体重 kg
          <input value={weight} onChange={(e) => setWeight(e.target.value)} inputMode="decimal" placeholder="60" className={inputClass} />
        </label>
      </div>
      <label className="block text-xs font-semibold text-slate-700">
        目標体重 kg（任意）
        <input value={targetWeight} onChange={(e) => setTargetWeight(e.target.value)} inputMode="decimal" placeholder="空欄でも可" className={inputClass} />
      </label>
      <label className="block text-xs font-semibold text-slate-700">
        いちばんの目標
        <select value={primaryGoal} onChange={(e) => setPrimaryGoal(e.target.value)} className={inputClass}>
          {PRIMARY_GOAL_OPTIONS.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
      <label className="block text-xs font-semibold text-slate-700">
        体重の方向
        <select value={direction} onChange={(e) => setDirection(e.target.value)} className={inputClass}>
          {WEIGHT_DIRECTION_OPTIONS.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
      <label className="block text-xs font-semibold text-slate-700">
        普段の活動量
        <select value={activity} onChange={(e) => setActivity(e.target.value)} className={inputClass}>
          {ACTIVITY_OPTIONS.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
      {showPace ? (
        <div className="space-y-2">
          <div className="text-xs font-semibold text-slate-700">{paceTitle(direction)}</div>
          <ChoiceButtons
            options={WEIGHT_PACE_OPTIONS.map((o) => ({ id: o.id, label: o.label, hint: o.hint }))}
            value={pace}
            onChange={(id) => setPace(id as WeightPace)}
          />
        </div>
      ) : null}
    </div>
  );

  const quizBody = (() => {
    if (quizStep === "primary") {
      return (
        <>
          <div className="text-sm font-bold text-slate-900">いちばんの目標は？</div>
          <ChoiceButtons options={[...PRIMARY_GOAL_OPTIONS]} value={primaryGoal} onChange={setPrimaryGoal} />
        </>
      );
    }
    if (quizStep === "direction") {
      return (
        <>
          <div className="text-sm font-bold text-slate-900">体重はどうしたい？</div>
          <ChoiceButtons options={[...WEIGHT_DIRECTION_OPTIONS]} value={direction} onChange={setDirection} />
        </>
      );
    }
    if (quizStep === "sex") {
      return (
        <>
          <div className="text-sm font-bold text-slate-900">性別は？</div>
          <ChoiceButtons options={[...SEX_OPTIONS]} value={sex} onChange={setSex} />
        </>
      );
    }
    if (quizStep === "body") {
      return (
        <>
          <div className="text-sm font-bold text-slate-900">いまの体を教えてください</div>
          <div className="grid grid-cols-3 gap-2">
            <label className="text-xs font-semibold text-slate-700">
              年齢
              <input value={age} onChange={(e) => setAge(e.target.value)} inputMode="numeric" placeholder="30" className={inputClass} />
            </label>
            <label className="text-xs font-semibold text-slate-700">
              身長 cm
              <input value={height} onChange={(e) => setHeight(e.target.value)} inputMode="decimal" placeholder="165" className={inputClass} />
            </label>
            <label className="text-xs font-semibold text-slate-700">
              体重 kg
              <input value={weight} onChange={(e) => setWeight(e.target.value)} inputMode="decimal" placeholder="60" className={inputClass} />
            </label>
          </div>
        </>
      );
    }
    if (quizStep === "target") {
      return (
        <>
          <div className="text-sm font-bold text-slate-900">目標体重はありますか？</div>
          <p className="text-xs text-slate-500">わからなければ空欄のまま次へ進めます。</p>
          <input value={targetWeight} onChange={(e) => setTargetWeight(e.target.value)} inputMode="decimal" placeholder="例: 58" className={inputClass} />
        </>
      );
    }
    if (quizStep === "activity") {
      return (
        <>
          <div className="text-sm font-bold text-slate-900">普段の活動量は？</div>
          <ChoiceButtons options={[...ACTIVITY_OPTIONS]} value={activity} onChange={setActivity} />
        </>
      );
    }
    if (quizStep === "pace") {
      return (
        <>
          <div className="text-sm font-bold text-slate-900">{paceTitle(direction)}は？</div>
          <p className="text-xs text-slate-500">ペースに合わせてカロリーとPFCを出します。</p>
          <ChoiceButtons
            options={WEIGHT_PACE_OPTIONS.map((o) => ({ id: o.id, label: o.label, hint: o.hint }))}
            value={pace}
            onChange={(id) => setPace(id as WeightPace)}
          />
        </>
      );
    }
    return (
      <>
        <div className="text-sm font-bold text-slate-900">この内容でカロリーとPFCを出します</div>
        {preview ? (
          <ResultCard
            shown={{
              ...preview,
              daily_expenditure_kcal: preview.tdee,
              intake_kcal: preview.intake_mid,
              intake_kcal_min: preview.intake_min,
              intake_kcal_max: preview.intake_max,
              monthly: formatMonthlyChangeLabel(preview),
            }}
          />
        ) : (
          <p className="text-sm text-slate-600">年齢・身長・いまの体重を確認してください。</p>
        )}
      </>
    );
  })();

  return (
    <div className="space-y-4">
      <button type="button" onClick={onBack} className="inline-flex items-center gap-1 text-xs font-semibold text-slate-600">
        <ChevronLeft className="h-4 w-4" />
        設定に戻る
      </button>

      {method === "pick" ? (
        <>
          <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="text-sm font-bold text-slate-900">いまのカロリー・PFC</div>
            {loading ? (
              <div className="text-sm text-slate-600">読み込み中…</div>
            ) : target ? (
              <ResultCard shown={target} />
            ) : (
              <p className="text-sm text-slate-600">まだ出せていません。下から目標設定してください。</p>
            )}
          </section>
          <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="space-y-1">
              <div className="text-sm font-bold text-slate-900">目標の決め方</div>
              <p className="text-xs text-slate-500">どちらかを選んで、カロリーとPFCを出します。</p>
            </div>
            <button
              type="button"
              onClick={() => {
                setErr(null);
                setSaved(null);
                setMethod("form");
              }}
              className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-left"
            >
              <div className="text-sm font-bold text-slate-900">まとめて入力する</div>
              <div className="mt-0.5 text-xs text-slate-500">いまの体と目標を一度に入れて設定します。</div>
            </button>
            <button
              type="button"
              onClick={() => {
                setErr(null);
                setSaved(null);
                setQuizStep("primary");
                setMethod("quiz");
              }}
              className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-left"
            >
              <div className="text-sm font-bold text-slate-900">質問に答えて決める</div>
              <div className="mt-0.5 text-xs text-slate-500">1問ずつ答えて、減量スピードも含めて設定します。</div>
            </button>
          </section>
        </>
      ) : null}

      {method === "form" ? (
        <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="space-y-1">
            <div className="text-sm font-bold text-slate-900">まとめて入力する</div>
            <p className="text-xs text-slate-500">いまの体と目標、減量スピードからカロリーとPFCを出します。</p>
          </div>
          {formFields}
          {preview ? (
            <ResultCard
              shown={{
                ...preview,
                daily_expenditure_kcal: preview.tdee,
                intake_kcal: preview.intake_mid,
                intake_kcal_min: preview.intake_min,
                intake_kcal_max: preview.intake_max,
                monthly: formatMonthlyChangeLabel(preview),
              }}
            />
          ) : null}
          {err ? <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">{err}</div> : null}
          <div className="grid grid-cols-2 gap-2">
            <button type="button" onClick={() => setMethod("pick")} className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-800">
              戻る
            </button>
            <button type="button" disabled={busy} onClick={() => void save()} className="rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60">
              {busy ? "計算中…" : "カロリーとPFCを出す"}
            </button>
          </div>
        </section>
      ) : null}

      {method === "quiz" ? (
        <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="text-[11px] font-semibold text-slate-500">
            {visibleQuizSteps().indexOf(quizStep) + 1} / {visibleQuizSteps().length}
          </div>
          {quizBody}
          {err ? <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">{err}</div> : null}
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => {
                if (quizStep === "primary") setMethod("pick");
                else goQuiz(-1);
              }}
              className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-800"
            >
              戻る
            </button>
            {quizStep === "confirm" ? (
              <button type="button" disabled={busy || !preview} onClick={() => void save()} className="rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60">
                {busy ? "計算中…" : "カロリーとPFCを出す"}
              </button>
            ) : (
              <button
                type="button"
                disabled={!canProceedQuiz()}
                onClick={() => {
                  if (!canProceedQuiz()) {
                    setErr("年齢・身長・いまの体重を入れてください");
                    return;
                  }
                  goQuiz(1);
                }}
                className="rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
              >
                次へ
              </button>
            )}
          </div>
        </section>
      ) : null}

      {saved && method === "pick" ? (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">{saved}</div>
      ) : null}
    </div>
  );
}
