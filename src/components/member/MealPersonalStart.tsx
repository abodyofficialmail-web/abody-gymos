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
  WEIGHT_PACE_OPTIONS,
  type WeightPace,
} from "@/lib/goalHearingNutrition";
import { formatIntakeLabel, type MemberNutritionTargetView } from "@/lib/memberNutritionTargets";
import { loginWithMemberIdentifier } from "@/components/member/memberIdentifierLogin";
import { useMemo, useState } from "react";

type Step = "primary" | "direction" | "sex" | "body" | "activity" | "pace" | "confirm" | "link";

export const MEAL_START_SKIP_KEY = "meal-personal-start-skipped";

const GOAL_IMAGES: Record<string, string> = {
  diet: "/meal-personal/goal-diet.jpg",
  muscle: "/meal-personal/goal-muscle.jpg",
  habit: "/meal-personal/goal-habit.jpg",
};

const LATER_NOTE =
  "体重や体脂肪がいまわからなくても大丈夫です。空欄のまま進められます。だいたいの数字でもよく、わかったあとや測り直したあとは、設定からいつでも変更できます。";

function parseOptional(raw: string, min: number, max: number): number | null | "bad" {
  const text = raw.trim();
  if (!text) return null;
  const n = Number(text);
  if (!Number.isFinite(n) || n < min || n > max) return "bad";
  return n;
}

function needsPace(direction: string, weight: string, targetWeight: string): boolean {
  if (direction === "lose" || direction === "gain") return true;
  if (direction !== "looks") return false;
  const current = Number(weight);
  const target = Number(targetWeight);
  if (!Number.isFinite(current) || !Number.isFinite(target)) return false;
  return Math.abs(target - current) > 0.5;
}

export function MealPersonalStart({
  onFinished,
  onExit,
}: {
  onFinished: (target: MemberNutritionTargetView | null) => void;
  onExit?: () => void;
}) {
  const [step, setStep] = useState<Step>("primary");
  const [motion, setMotion] = useState<"forward" | "back">("forward");
  const [identifier, setIdentifier] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [primaryGoal, setPrimaryGoal] = useState("diet");
  const [direction, setDirection] = useState("lose");
  const [sex, setSex] = useState("female");
  const [age, setAge] = useState("");
  const [height, setHeight] = useState("");
  const [weight, setWeight] = useState("");
  const [bodyFat, setBodyFat] = useState("");
  const [targetWeight, setTargetWeight] = useState("");
  const [activity, setActivity] = useState("light");
  const [pace, setPace] = useState<WeightPace>("normal");

  const showPace = needsPace(direction, weight, targetWeight);
  const steps = useMemo(() => {
    const list: Step[] = ["primary", "direction", "sex", "body", "activity"];
    if (showPace) list.push("pace");
    list.push("confirm");
    return list;
  }, [showPace]);

  const form = useMemo((): GoalHearingFormPayload | null => {
    const sexValue = sex === "male" || sex === "female" ? sex : null;
    const ageN = Number(age);
    const heightN = Number(height);
    const weightN = Number(weight);
    if (!sexValue || !Number.isFinite(ageN) || !Number.isFinite(heightN) || !Number.isFinite(weightN)) return null;
    const targetN = targetWeight.trim() === "" ? null : Number(targetWeight);
    return {
      primary_goal: primaryGoal || "habit",
      focus_areas: [],
      weight_direction: direction || "maintain",
      current_weight_kg: weightN,
      target_weight_kg: targetN != null && Number.isFinite(targetN) ? targetN : null,
      deadline_type: "none",
      sex: sexValue,
      age_years: Math.round(ageN),
      height_cm: heightN,
      activity_level: activity || "light",
      ideal_frequency: "week_2",
      sleep_hours: "7_8",
      challenges: [],
      pain_areas: [],
      goal_photo_paths: ["placeholder"],
    };
  }, [sex, age, height, weight, targetWeight, activity, direction, primaryGoal]);

  const preview = useMemo(
    () => (form ? estimateGoalHearingNutrition(form, { pace: showPace ? pace : null }) : null),
    [form, pace, showPace]
  );

  function go(next: 1 | -1) {
    const i = steps.indexOf(step);
    if (next < 0 && i <= 0) {
      onExit?.();
      return;
    }
    const dest = steps[i + next];
    if (!dest) return;
    setErr(null);
    setMotion(next > 0 ? "forward" : "back");
    setStep(dest);
  }

  function validateBody(): string | null {
    const fat = parseOptional(bodyFat, 3, 60);
    if (fat === "bad") return "体脂肪は 3〜60% で入れるか、空欄にしてください";
    const target = parseOptional(targetWeight, 20, 300);
    if (target === "bad") return "目標体重は 20〜300kg で入れるか、空欄にしてください";
    if (!weight.trim()) return null;
    const w = parseOptional(weight, 20, 300);
    if (w === "bad") return "体重は 20〜300kg で入れるか、空欄にしてください";
    const ageN = Number(age);
    const heightN = Number(height);
    if (!Number.isFinite(ageN) || ageN < 10 || ageN > 100) return "体重を入れるときは、年齢も入れてください";
    if (!Number.isFinite(heightN) || heightN < 100 || heightN > 250) return "体重を入れるときは、身長も入れてください";
    return null;
  }

  async function finish() {
    const bodyErr = validateBody();
    if (bodyErr) {
      setErr(bodyErr);
      return;
    }
    if (!form || !preview) {
      const me = await fetch("/api/member/me", { cache: "no-store" });
      if (me.status === 401) {
        setStep("link");
        return;
      }
      onFinished(null);
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const fat = parseOptional(bodyFat, 3, 60);
      if (weight.trim()) {
        const weightRes = await fetch("/api/member/weight-logs", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            weight_kg: Number(weight),
            body_fat_pct: typeof fat === "number" ? fat : null,
          }),
        });
        if (weightRes.status === 401) {
          setStep("link");
          return;
        }
        if (!weightRes.ok && weightRes.status !== 403) {
          const json = (await weightRes.json().catch(() => ({}))) as { error?: string };
          throw new Error(json.error || "体重の保存に失敗しました");
        }
      }
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
      if (res.status === 401) {
        setStep("link");
        return;
      }
      if (!res.ok || !json.target) throw new Error(json.error || "カロリーとPFCを出せませんでした");
      onFinished(json.target);
    } catch (e) {
      setErr(String((e as Error)?.message ?? "保存に失敗しました"));
    } finally {
      setBusy(false);
    }
  }

  async function loginAndSave() {
    setBusy(true);
    setErr(null);
    try {
      await loginWithMemberIdentifier(identifier);
      await finish();
    } catch (e) {
      setErr(String((e as Error)?.message ?? "ログインに失敗しました"));
      setBusy(false);
    }
  }

  if (step === "link") {
    return (
      <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
        <img src="/meal-personal/start-hero.jpg" alt="" className="h-40 w-full object-cover" />
        <div className="space-y-3 p-5">
          <h2 className="text-xl font-bold text-slate-900">回答を会員データにつなぎます</h2>
          <p className="text-sm leading-relaxed text-slate-600">
            会員番号かメールアドレスのどちらかでログインすると、いまの回答が食事パーソナルに保存されます。
          </p>
          <label className="block text-xs font-semibold text-slate-700">
            会員番号 または メールアドレス
            <input
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              placeholder="EBI001 または example@gmail.com"
              className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-normal"
            />
          </label>
          {err ? <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">{err}</div> : null}
          <button
            type="button"
            disabled={busy}
            onClick={() => void loginAndSave()}
            className="w-full rounded-2xl bg-teal-800 px-4 py-3.5 text-sm font-bold text-white disabled:opacity-60"
          >
            {busy ? "ログイン中…" : "ログインして保存"}
          </button>
          <button
            type="button"
            onClick={() => {
              setErr(null);
              setStep("confirm");
            }}
            className="w-full rounded-2xl px-4 py-2 text-sm font-semibold text-slate-500"
          >
            質問に戻る
          </button>
        </div>
      </section>
    );
  }

  const index = steps.indexOf(step);
  const progress = `${Math.round(((index + 1) / steps.length) * 100)}%`;

  return (
    <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
      <div className="h-1.5 bg-slate-100">
        <div className="h-full bg-teal-800 transition-[width] duration-500 ease-out" style={{ width: progress }} />
      </div>
      <div
        key={step}
        className={[
          "space-y-4 p-5",
          motion === "back" ? "meal-q-back" : "meal-q-in",
        ].join(" ")}
      >
        <div className="text-[11px] font-semibold text-slate-400">
          {index + 1} / {steps.length}
        </div>
        {step === "primary" ? (
          <>
            <h2 className="text-xl font-bold text-slate-900">いちばん近い目標は？</h2>
            <div className="grid grid-cols-1 gap-2">
              {PRIMARY_GOAL_OPTIONS.filter((o) => GOAL_IMAGES[o.id]).map((opt, i) => {
                const active = primaryGoal === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => setPrimaryGoal(opt.id)}
                    style={{ animationDelay: `${80 + i * 70}ms` }}
                    className={[
                      "meal-choice-in overflow-hidden rounded-2xl border text-left",
                      active ? "border-teal-800 ring-2 ring-teal-800" : "border-slate-200",
                    ].join(" ")}
                  >
                    <img src={GOAL_IMAGES[opt.id]} alt="" className="h-28 w-full object-cover" />
                    <div className={["px-3 py-2.5 text-sm font-bold", active ? "text-teal-900" : "text-slate-800"].join(" ")}>
                      {opt.label}
                    </div>
                  </button>
                );
              })}
            </div>
            <div className="flex flex-wrap gap-2">
              {PRIMARY_GOAL_OPTIONS.filter((o) => !GOAL_IMAGES[o.id]).map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setPrimaryGoal(opt.id)}
                  className={[
                    "rounded-full border px-3 py-1.5 text-xs font-semibold",
                    primaryGoal === opt.id ? "border-teal-800 bg-teal-800 text-white" : "border-slate-200 bg-white text-slate-700",
                  ].join(" ")}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </>
        ) : null}

        {step === "direction" ? (
          <>
            <h2 className="text-xl font-bold text-slate-900">体重はどうしたい？</h2>
            <ChoiceList options={[...WEIGHT_DIRECTION_OPTIONS]} value={direction} onChange={setDirection} />
          </>
        ) : null}

        {step === "sex" ? (
          <>
            <h2 className="text-xl font-bold text-slate-900">性別を教えてください</h2>
            <p className="text-sm text-slate-500">カロリーの目安を出すために使います。</p>
            <ChoiceList options={[...SEX_OPTIONS]} value={sex} onChange={setSex} />
          </>
        ) : null}

        {step === "body" ? (
          <>
            <img src="/meal-personal/body-check.jpg" alt="体重計" className="h-40 w-full rounded-2xl object-cover" />
            <h2 className="text-xl font-bold text-slate-900">いまの体を教えてください</h2>
            <p className="rounded-2xl bg-amber-50 px-4 py-3 text-sm leading-relaxed text-amber-950">{LATER_NOTE}</p>
            <div className="grid grid-cols-2 gap-2">
              <Field label="年齢" value={age} onChange={setAge} placeholder="30" />
              <Field label="身長 cm" value={height} onChange={setHeight} placeholder="165" />
              <Field label="体重 kg" value={weight} onChange={setWeight} placeholder="わからなければ空欄" />
              <Field label="体脂肪 %" value={bodyFat} onChange={setBodyFat} placeholder="わからなければ空欄" />
            </div>
            <Field label="目標体重 kg（任意）" value={targetWeight} onChange={setTargetWeight} placeholder="空欄でも可" />
          </>
        ) : null}

        {step === "activity" ? (
          <>
            <h2 className="text-xl font-bold text-slate-900">普段どのくらい動きますか？</h2>
            <ChoiceList options={[...ACTIVITY_OPTIONS]} value={activity} onChange={setActivity} />
          </>
        ) : null}

        {step === "pace" ? (
          <>
            <h2 className="text-xl font-bold text-slate-900">{direction === "gain" ? "増やすペースは？" : "減らすペースは？"}</h2>
            <ChoiceList
              options={WEIGHT_PACE_OPTIONS.map((o) => ({ id: o.id, label: o.label, hint: o.hint }))}
              value={pace}
              onChange={(id) => setPace(id as WeightPace)}
            />
          </>
        ) : null}

        {step === "confirm" ? (
          <>
            <img src="/meal-personal/start-hero.jpg" alt="" className="h-36 w-full rounded-2xl object-cover" />
            {preview ? (
              <>
                <h2 className="text-xl font-bold text-slate-900">この数字で始めます</h2>
                <div className="rounded-2xl bg-teal-50 px-4 py-4">
                  <div className="text-xs font-semibold text-teal-800">1日の目標摂取</div>
                  <div className="mt-1 text-3xl font-bold text-teal-950">
                    {formatIntakeLabel({
                      intake_kcal: preview.intake_mid,
                      intake_kcal_min: preview.intake_min,
                      intake_kcal_max: preview.intake_max,
                    })}
                    <span className="ml-1 text-sm font-semibold">kcal</span>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-2 text-center">
                  <Macro label="たんぱく質" value={`${preview.protein_g}g`} tone="text-rose-700" />
                  <Macro label="脂質" value={`${preview.fat_g}g`} tone="text-amber-700" />
                  <Macro label="炭水化物" value={`${preview.carb_g}g`} tone="text-sky-700" />
                </div>
                <p className="text-xs leading-relaxed text-slate-500">
                  {formatMonthlyChangeLabel(preview) ? `1ヶ月の体重目安: ${formatMonthlyChangeLabel(preview)}。` : ""}
                  体重や体脂肪は、あとから設定で変更できます。
                </p>
              </>
            ) : (
              <>
                <h2 className="text-xl font-bold text-slate-900">このまま始められます</h2>
                <p className="text-sm leading-relaxed text-slate-600">
                  体重が空欄なので、目標カロリーはまだ出せません。食事の記録は始められます。体重や体脂肪がわかったら、設定から追加・変更できます。
                  {bodyFat.trim() ? " 体脂肪は体重と一緒に保存するので、体重がわかってからまとめて入れられます。" : ""}
                </p>
              </>
            )}
          </>
        ) : null}

        {err ? <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">{err}</div> : null}

        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => go(-1)}
            className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700"
          >
            戻る
          </button>
          {step === "confirm" ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => void finish()}
              className="rounded-2xl bg-teal-800 px-4 py-3 text-sm font-bold text-white disabled:opacity-60"
            >
              {busy ? "保存中…" : preview ? "この数字で始める" : "このまま始める"}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => {
                if (step === "body") {
                  const bodyErr = validateBody();
                  if (bodyErr) {
                    setErr(bodyErr);
                    return;
                  }
                }
                go(1);
              }}
              className="rounded-2xl bg-teal-800 px-4 py-3 text-sm font-bold text-white"
            >
              次へ
            </button>
          )}
        </div>
      </div>
    </section>
  );
}

function ChoiceList({
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
      {options.map((opt, i) => {
        const active = value === opt.id;
        return (
          <button
            key={opt.id}
            type="button"
            onClick={() => onChange(opt.id)}
            style={{ animationDelay: `${90 + i * 55}ms` }}
            className={[
              "meal-choice-in w-full rounded-2xl border px-4 py-3.5 text-left",
              active ? "border-teal-800 bg-teal-800 text-white" : "border-slate-200 bg-white text-slate-800",
            ].join(" ")}
          >
            <div className="text-sm font-bold">{opt.label}</div>
            {opt.hint ? <div className={["mt-0.5 text-xs", active ? "text-white/80" : "text-slate-500"].join(" ")}>{opt.hint}</div> : null}
          </button>
        );
      })}
    </div>
  );
}

function Field({
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
    <label className="block text-xs font-semibold text-slate-700">
      {label}
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        inputMode="decimal"
        placeholder={placeholder}
        className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-normal text-slate-900"
      />
    </label>
  );
}

function Macro({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <div className="rounded-2xl bg-slate-50 px-2 py-3">
      <div className={["text-[11px] font-semibold", tone].join(" ")}>{label}</div>
      <div className="mt-0.5 text-base font-bold text-slate-900">{value}</div>
    </div>
  );
}
