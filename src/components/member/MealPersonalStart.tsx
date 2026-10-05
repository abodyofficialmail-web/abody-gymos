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
  WEIGHT_PACE_OPTIONS,
  type WeightPace,
} from "@/lib/goalHearingNutrition";
import { formatIntakeLabel, type MemberNutritionTargetView } from "@/lib/memberNutritionTargets";
import { useMemo, useState } from "react";

type Step =
  | "nickname"
  | "primary"
  | "direction"
  | "sex"
  | "age"
  | "height"
  | "weight"
  | "fat"
  | "target"
  | "activity"
  | "pace"
  | "confirm"
  | "link";

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

function forecastWeights(currentKg: number, monthlyMin: number, monthlyMax: number) {
  return [1, 2, 3].map((months) => {
    const low = Math.round((currentKg + monthlyMin * months) * 10) / 10;
    const high = Math.round((currentKg + monthlyMax * months) * 10) / 10;
    const a = Math.min(low, high);
    const b = Math.max(low, high);
    return {
      months,
      weight: a === b ? `${a}kg` : `${a}〜${b}kg`,
    };
  });
}

function appearanceAt(months: 1 | 2 | 3, monthlyMin: number, monthlyMax: number): string {
  const mid = (monthlyMin + monthlyMax) / 2;
  const gaining = mid >= 0.3;
  const losing = mid <= -0.3;
  if (gaining) {
    if (months === 1) return "力が出やすくなり、体に張りが出始めます。";
    if (months === 2) return "腕や胸、肩に厚みが出て、服のラインが変わり始めます。";
    return "服の上からでも体が大きく見え、筋肉の輪郭がわかりやすくなります。";
  }
  if (losing) {
    if (months === 1) return "顔まわりやお腹の張りが少し落ち着くことがあります。";
    if (months === 2) return "ウエストが細くなり、服のフィットが変わることがあります。";
    return "体のラインが出て、変化がまわりからもわかりやすくなります。";
  }
  if (months === 1) return "体重はほぼそのままです。むくみが落ち着いて見えることがあります。";
  if (months === 2) return "食事がそろうと、お腹まわりが安定して見えます。";
  return "体型をキープしながら、引き締まった印象になっていきます。";
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
  onlyProfile = false,
}: {
  onFinished: (target: MemberNutritionTargetView | null) => void;
  onExit?: () => void;
  onlyProfile?: boolean;
}) {
  const [step, setStep] = useState<Step>("nickname");
  const [nickname, setNickname] = useState("");
  const [email, setEmail] = useState("");
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
    if (onlyProfile) return ["nickname"] as Step[];
    const list: Step[] = ["nickname", "primary", "direction", "sex", "age", "height", "weight", "fat", "target", "activity"];
    if (showPace) list.push("pace");
    list.push("confirm");
    return list;
  }, [showPace, onlyProfile]);

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

  function openLink() {
    setIdentifier((prev) => prev || email.trim());
    setStep("link");
  }

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

  function validateStep(current: Step): string | null {
    if (current === "nickname") {
      const name = nickname.trim();
      if (name.length < 1 || name.length > 20) return "ニックネームを20文字以内で入れてください";
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email.trim())) return "ログインIDにするメールアドレスを入れてください";
    }
    if (current === "age") {
      const n = Number(age);
      if (!age.trim() || !Number.isFinite(n) || n < 10 || n > 100) return "年齢を 10〜100 で入れてください";
    }
    if (current === "height") {
      const n = Number(height);
      if (!height.trim() || !Number.isFinite(n) || n < 100 || n > 250) return "身長を 100〜250cm で入れてください";
    }
    if (current === "weight" && weight.trim() && parseOptional(weight, 20, 300) === "bad") {
      return "体重は 20〜300kg で入れるか、空欄にしてください";
    }
    if (current === "fat" && parseOptional(bodyFat, 3, 60) === "bad") {
      return "体脂肪は 3〜60% で入れるか、空欄にしてください";
    }
    if (current === "target" && parseOptional(targetWeight, 20, 300) === "bad") {
      return "目標体重は 20〜300kg で入れるか、空欄にしてください";
    }
    return null;
  }

  async function saveProfile(options?: { includeEmail?: boolean }) {
    const name = nickname.trim();
    const mail = email.trim().toLowerCase();
    const includeEmail = options?.includeEmail !== false && Boolean(mail);
    if (!name && !includeEmail) return true;
    const res = await fetch("/api/member/me", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...(name ? { display_name: name } : {}),
        ...(includeEmail ? { email: mail } : {}),
      }),
    });
    if (res.status === 401) {
      openLink();
      return false;
    }
    if (!res.ok) {
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(
        res.status === 400 ? "メールアドレスの形を確認してください" : json.error || "ニックネームとログインIDの保存に失敗しました"
      );
    }
    return true;
  }

  async function registerProfile() {
    const stepErr = validateStep("nickname");
    if (stepErr) {
      setErr(stepErr);
      return false;
    }
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/member/meal-personal/signup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ display_name: nickname.trim(), email: email.trim() }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(json.error || "アカウントの作成に失敗しました");
      return true;
    } catch (e) {
      setErr(String((e as Error)?.message ?? "登録に失敗しました"));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function finish() {
    const numberErr = (["nickname", "age", "height", "weight", "fat", "target"] as Step[]).map(validateStep).find(Boolean);
    if (numberErr) {
      setErr(numberErr);
      return;
    }
    if (!form || !preview) {
      const me = await fetch("/api/member/me", { cache: "no-store" });
      if (me.status === 401) {
        openLink();
        return;
      }
      try {
        const savedName = await saveProfile();
        if (!savedName) return;
      } catch (e) {
        setErr(String((e as Error)?.message ?? "ニックネームの保存に失敗しました"));
        return;
      }
      onFinished(null);
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const savedName = await saveProfile();
      if (!savedName) return;
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
          openLink();
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
        openLink();
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
      const mail = (identifier || email).trim();
      const res = await fetch("/api/member/meal-personal/signup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ display_name: nickname.trim() || "ゲスト", email: mail }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(json.error || "ログインに失敗しました");
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
          <h2 className="text-xl font-bold text-slate-900">食事パーソナルのアカウントで保存します</h2>
          <p className="text-sm leading-relaxed text-slate-600">
            このメールアドレスがログインIDです。ジムの会員番号とは別のアカウントに保存します。
          </p>
          <label className="block text-xs font-semibold text-slate-700">
            ログインIDになるメールアドレス
            <input
              type="email"
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              placeholder="例: misaki@example.com"
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
        {step === "nickname" ? (
          <>
            <h2 className="text-xl font-bold text-slate-900">なんて呼びましょうか？</h2>
            <p className="text-sm leading-relaxed text-slate-600">
              食事パーソナルに表示する名前です。本名でなくても大丈夫です。
            </p>
            <input
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              maxLength={20}
              placeholder="例: みさき"
              className="w-full border-0 border-b-2 border-slate-200 bg-transparent px-1 py-2 text-3xl font-bold text-slate-900 outline-none placeholder:text-2xl placeholder:font-semibold placeholder:text-slate-300 focus:border-teal-800"
            />
            <div className="space-y-2 pt-2">
              <h2 className="text-xl font-bold text-slate-900">ログインIDになるメールアドレス</h2>
              <p className="text-sm leading-relaxed text-slate-600">
                このメールアドレスがログインIDになります。ジムの会員番号とは別の、食事パーソナルだけのアカウントです。次からはこのアドレスで入れます。
              </p>
              <input
                type="email"
                inputMode="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="例: misaki@example.com"
                className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 text-base font-semibold outline-none focus:border-teal-800"
              />
            </div>
          </>
        ) : null}

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

        {step === "age" ? (
          <OneNumber title="年齢は？" value={age} onChange={setAge} placeholder="30" unit="歳" />
        ) : null}
        {step === "height" ? (
          <OneNumber title="身長は？" value={height} onChange={setHeight} placeholder="165" unit="cm" />
        ) : null}
        {step === "weight" ? (
          <OneNumber
            title="いまの体重は？"
            value={weight}
            onChange={setWeight}
            placeholder="空欄でも進めます"
            unit="kg"
            note={LATER_NOTE}
            image="/meal-personal/body-check.jpg"
          />
        ) : null}
        {step === "fat" ? (
          <OneNumber
            title="体脂肪率は？"
            value={bodyFat}
            onChange={setBodyFat}
            placeholder="空欄でも進めます"
            unit="%"
            note={LATER_NOTE}
          />
        ) : null}
        {step === "target" ? (
          <OneNumber
            title="目標の体重は？"
            value={targetWeight}
            onChange={setTargetWeight}
            placeholder="空欄でも進めます"
            unit="kg"
            note="決まっていなければ空欄のまま次へ進めます。あとから設定で変更できます。"
          />
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
                <div className="space-y-2">
                  <div className="text-sm font-bold text-slate-900">1〜3カ月後の目安</div>
                  {forecastWeights(
                    Number(weight),
                    preview.monthly_change_min_kg,
                    preview.monthly_change_max_kg
                  ).map((row) => (
                    <div key={row.months} className="rounded-2xl bg-slate-50 px-3 py-3">
                      <div className="flex items-baseline justify-between gap-3">
                        <div className="text-xs font-bold text-slate-500">{row.months}カ月後</div>
                        <div className="text-base font-bold text-slate-900">{row.weight}</div>
                      </div>
                      <p className="mt-1 text-sm leading-relaxed text-slate-700">
                        {appearanceAt(row.months as 1 | 2 | 3, preview.monthly_change_min_kg, preview.monthly_change_max_kg)}
                      </p>
                    </div>
                  ))}
                  <p className="text-xs leading-relaxed text-slate-500">
                    食事とトレーニングを続けたときの目安です。進み方には個人差があります。体重や体脂肪は、あとから設定で変更できます。
                  </p>
                </div>
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
          {onlyProfile ? null : (
            <button
              type="button"
              onClick={() => go(-1)}
              className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700"
            >
              戻る
            </button>
          )}
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
              disabled={busy}
              onClick={() => {
                const stepErr = validateStep(step);
                if (stepErr) {
                  setErr(stepErr);
                  return;
                }
                if (step === "nickname") {
                  void registerProfile().then((ok) => {
                    if (!ok) return;
                    if (onlyProfile) onFinished(null);
                    else go(1);
                  });
                  return;
                }
                go(1);
              }}
              className={[
                "rounded-2xl bg-teal-800 px-4 py-3 text-sm font-bold text-white disabled:opacity-60",
                onlyProfile ? "col-span-2" : "",
              ].join(" ")}
            >
              {busy && step === "nickname" ? "登録中…" : onlyProfile ? "ログインIDを登録" : "次へ"}
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

function OneNumber({
  title,
  value,
  onChange,
  placeholder,
  unit,
  note,
  image,
}: {
  title: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  unit: string;
  note?: string;
  image?: string;
}) {
  return (
    <>
      {image ? <img src={image} alt="" className="h-36 w-full rounded-2xl object-cover" /> : null}
      <h2 className="text-xl font-bold text-slate-900">{title}</h2>
      {note ? <p className="rounded-2xl bg-amber-50 px-4 py-3 text-sm leading-relaxed text-amber-950">{note}</p> : null}
      <label className="block">
        <span className="sr-only">{title}</span>
        <span className="flex items-end gap-2">
          <input
            value={value}
            onChange={(e) => onChange(e.target.value)}
            inputMode="decimal"
            placeholder={placeholder}
            className="min-w-0 flex-1 border-0 border-b-2 border-slate-200 bg-transparent px-1 py-2 text-4xl font-bold text-slate-900 outline-none placeholder:text-2xl placeholder:font-semibold placeholder:text-slate-300 focus:border-teal-800"
          />
          <span className="shrink-0 pb-2 text-lg font-bold text-slate-500">{unit}</span>
        </span>
      </label>
    </>
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
