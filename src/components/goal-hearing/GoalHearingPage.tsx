"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { GOAL_HEARING_ACCENT } from "@/lib/goalHearing";
import { captureGoalHearingParamsFromLocation } from "@/lib/goalHearingParams";
import { compressImageFile } from "@/lib/compressImageFile";

type Opt = { id: string; label: string };

type Payload = {
  survey: {
    member_code: string;
    member_name: string;
    store_name: string;
    already_responded: boolean;
    token_key: string;
  };
  options: {
    primary_goals: Opt[];
    focus_areas: string[];
    deadlines: Opt[];
    goal_reasons: Opt[];
    sexes: Opt[];
    activities: Opt[];
    frequencies: Opt[];
    preferred_times: string[];
    sleeps: Opt[];
    challenges: string[];
    meal_changes: Opt[];
    pains: string[];
    training_styles: string[];
    weight_directions: Opt[];
  };
  submit: { s: string; sig: string };
};


function toggle(list: string[], value: string, max?: number): string[] {
  if (list.includes(value)) return list.filter((x) => x !== value);
  if (max != null && list.length >= max) return list;
  return [...list, value];
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <div className="text-sm font-semibold text-slate-800">{label}</div>
      {children}
    </div>
  );
}

function ChoiceButtons({
  options,
  value,
  onChange,
}: {
  options: Opt[] | undefined;
  value: string;
  onChange: (id: string) => void;
}) {
  return (
    <div className="space-y-2">
      {(options ?? []).map((opt) => {
        const active = value === opt.id;
        return (
          <button
            key={opt.id}
            type="button"
            onClick={() => onChange(opt.id)}
            className={[
              "w-full rounded-2xl border px-4 py-3 text-left text-sm",
              active ? "border-teal-800 bg-teal-800 text-white" : "border-slate-200 bg-white text-slate-800",
            ].join(" ")}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

function MultiButtons({
  options,
  values,
  onChange,
  max,
}: {
  options: string[] | undefined;
  values: string[];
  onChange: (next: string[]) => void;
  max?: number;
}) {
  return (
    <div className="space-y-2">
      {(options ?? []).map((opt) => {
        const active = values.includes(opt);
        return (
          <button
            key={opt}
            type="button"
            onClick={() => onChange(toggle(values, opt, max))}
            className={[
              "w-full rounded-2xl border px-4 py-3 text-left text-sm",
              active ? "border-teal-700 bg-teal-50 text-teal-950" : "border-slate-200 bg-white text-slate-800",
            ].join(" ")}
          >
            {opt}
          </button>
        );
      })}
    </div>
  );
}

export default function GoalHearingPage() {
  const [signed, setSigned] = useState<{ s: string; sig: string } | null>(null);
  const [payload, setPayload] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [uploading, setUploading] = useState(false);

  const [primaryGoal, setPrimaryGoal] = useState("");
  const [primaryGoalOther, setPrimaryGoalOther] = useState("");
  const [secondaryGoal, setSecondaryGoal] = useState("");
  const [tertiaryGoal, setTertiaryGoal] = useState("");
  const [focusAreas, setFocusAreas] = useState<string[]>([]);
  const [weightDirection, setWeightDirection] = useState("");
  const [currentWeight, setCurrentWeight] = useState("");
  const [targetWeight, setTargetWeight] = useState("");
  const [currentBf, setCurrentBf] = useState("");
  const [targetBf, setTargetBf] = useState("");
  const [currentWaist, setCurrentWaist] = useState("");
  const [targetWaist, setTargetWaist] = useState("");
  const [weightUnknown, setWeightUnknown] = useState(false);
  const [deadlineType, setDeadlineType] = useState("");
  const [deadlineDate, setDeadlineDate] = useState("");
  const [goalReason, setGoalReason] = useState("");
  const [goalReasonOther, setGoalReasonOther] = useState("");
  const [sex, setSex] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const [ageYears, setAgeYears] = useState("");
  const [heightCm, setHeightCm] = useState("");
  const [activity, setActivity] = useState("");
  const [frequency, setFrequency] = useState("");
  const [preferredTimes, setPreferredTimes] = useState<string[]>([]);
  const [sleep, setSleep] = useState("");
  const [challenges, setChallenges] = useState<string[]>([]);
  const [mealChange, setMealChange] = useState("");
  const [pains, setPains] = useState<string[]>([]);
  const [trainingStyles, setTrainingStyles] = useState<string[]>([]);
  const [medical, setMedical] = useState("");
  const [freeComment, setFreeComment] = useState("");
  const [photoPaths, setPhotoPaths] = useState<string[]>([]);

  const title = useMemo(() => "目標ヒアリング", []);

  const load = useCallback(async (s: string, sig: string) => {
    setLoading(true);
    setErr(null);
    const res = await fetch(`/api/member/goal-hearing?s=${encodeURIComponent(s)}&sig=${encodeURIComponent(sig)}`, {
      cache: "no-store",
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error((json as { error?: string })?.error ?? "読み込みに失敗しました");
    const data = json as Payload;
    if (!data?.survey || !data.options?.primary_goals?.length) {
      throw new Error("フォームの読み込みに失敗しました");
    }
    setPayload(data);
    if (data.survey.already_responded) setDone(true);
  }, []);

  useEffect(() => {
    const params = captureGoalHearingParamsFromLocation();
    if (!params) {
      setErr("リンクが不正です。LINEのメッセージから再度お開きください。");
      setLoading(false);
      return;
    }
    setSigned(params);
    load(params.s, params.sig)
      .catch((e: unknown) => setErr(e instanceof Error ? e.message : "読み込みに失敗しました"))
      .finally(() => setLoading(false));
  }, [load]);

  const onPickPhotos = async (files: FileList | null) => {
    if (!files?.length || !signed) return;
    const remain = 3 - photoPaths.length;
    if (remain <= 0) {
      setErr("写真は最大3枚までです");
      return;
    }
    setUploading(true);
    setErr(null);
    try {
      const next = [...photoPaths];
      const list = Array.from(files).slice(0, remain);
      for (let i = 0; i < list.length; i++) {
        const fd = new FormData();
        fd.set("s", signed.s);
        fd.set("sig", signed.sig);
        fd.set("index", String(next.length));
        const file = await compressImageFile(list[i]).catch(() => list[i]);
        fd.set("file", file);
        const res = await fetch("/api/member/goal-hearing/photos", { method: "POST", body: fd });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error((json as { error?: string })?.error ?? "画像アップロードに失敗しました");
        next.push(String((json as { path: string }).path));
      }
      setPhotoPaths(next);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "画像アップロードに失敗しました");
    } finally {
      setUploading(false);
    }
  };

  const submit = async () => {
    if (!signed) return;
    if (
      !primaryGoal ||
      !secondaryGoal ||
      !tertiaryGoal ||
      !focusAreas.length ||
      !weightDirection ||
      !deadlineType ||
      !sex ||
      !heightCm ||
      !activity ||
      !frequency ||
      !preferredTimes.length ||
      !sleep
    ) {
      setErr("必須項目を入力してください");
      return;
    }
    if (!birthDate && !ageYears) {
      setErr("生年月日または年齢を入力してください");
      return;
    }
    if (!weightUnknown && !currentWeight) {
      setErr("体重を入力するか「わからない」を選んでください");
      return;
    }
    if (!challenges.length) {
      setErr("大変なことを1つ以上選んでください");
      return;
    }
    if (!pains.length) {
      setErr("痛み・不安を選んでください（なければ「ない」）");
      return;
    }
    if (!trainingStyles.length) {
      setErr("トレーニングの進め方希望を1つ以上選んでください");
      return;
    }
    if (!photoPaths.length) {
      setErr("なりたい体型の写真を1枚以上アップロードしてください");
      return;
    }

    setSubmitting(true);
    setErr(null);
    try {
      const res = await fetch("/api/member/goal-hearing", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          s: signed.s,
          sig: signed.sig,
          primary_goal: primaryGoal,
          primary_goal_other: primaryGoalOther.trim() || undefined,
          secondary_goal: secondaryGoal,
          tertiary_goal: tertiaryGoal,
          focus_areas: focusAreas,
          weight_direction: weightDirection,
          current_weight_kg: weightUnknown ? null : currentWeight ? Number(currentWeight) : null,
          target_weight_kg: targetWeight ? Number(targetWeight) : null,
          current_body_fat_pct: currentBf ? Number(currentBf) : null,
          target_body_fat_pct: targetBf ? Number(targetBf) : null,
          current_waist_cm: currentWaist ? Number(currentWaist) : null,
          target_waist_cm: targetWaist ? Number(targetWaist) : null,
          deadline_type: deadlineType,
          deadline_date: deadlineType === "date" ? deadlineDate || null : null,
          goal_reason: goalReason || null,
          goal_reason_other: goalReasonOther.trim() || null,
          sex,
          birth_date: birthDate || null,
          age_years: ageYears ? Number(ageYears) : null,
          height_cm: Number(heightCm),
          weight_unknown: weightUnknown,
          activity_level: activity,
          ideal_frequency: frequency,
          preferred_slots: preferredTimes,
          sleep_hours: sleep,
          challenges,
          meal_change: mealChange || null,
          pain_areas: pains,
          training_styles: trainingStyles,
          medical_restrictions: medical.trim() || null,
          free_comment: freeComment.trim() || null,
          goal_photo_paths: photoPaths,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((json as { error?: string })?.error ?? "送信に失敗しました");
      setDone(true);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "送信に失敗しました");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return <div className="mx-auto max-w-lg p-6 text-sm text-slate-600">読み込み中…</div>;
  }

  if (done) {
    return (
      <div className="mx-auto max-w-lg space-y-3 p-6">
        <h1 className="text-xl font-bold text-slate-900">回答ありがとうございます</h1>
        <p className="text-sm text-slate-600">
          目標ヒアリングを受け付けました。今後の進め方づくりに活用します。
        </p>
      </div>
    );
  }

  if (!payload) {
    return (
      <div className="mx-auto max-w-lg space-y-3 p-6">
        <h1 className="text-xl font-bold text-slate-900">{title}</h1>
        <p className="text-sm text-red-600">{err ?? "読み込みに失敗しました"}</p>
      </div>
    );
  }

  const o = payload.options;

  return (
    <div className="mx-auto max-w-lg space-y-8 p-6 pb-24">
      <div className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: GOAL_HEARING_ACCENT }}>
          Goal Hearing
        </p>
        <h1 className="text-2xl font-bold text-slate-900">{title}</h1>
        <p className="text-sm text-slate-600">
          {payload.survey.member_name || payload.survey.member_code}
          {payload.survey.store_name ? `（${payload.survey.store_name}）` : ""}
        </p>
        <p className="text-sm text-slate-600">所要5〜8分。なりたい体型の写真は必須です。</p>
      </div>

      {err ? <div className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-700">{err}</div> : null}

      <Field label="1番目の目標は？（必須）">
        <ChoiceButtons options={o.primary_goals} value={primaryGoal} onChange={setPrimaryGoal} />
        {primaryGoal === "other" ? (
          <input
            value={primaryGoalOther}
            onChange={(e) => setPrimaryGoalOther(e.target.value)}
            placeholder="具体的に"
            className="mt-2 w-full rounded-2xl border border-slate-200 px-4 py-3 text-[16px]"
          />
        ) : null}
      </Field>

      <Field label="2番目の目標は？（必須）">
        <ChoiceButtons options={o.primary_goals} value={secondaryGoal} onChange={setSecondaryGoal} />
      </Field>

      <Field label="3番目の目標は？（必須）">
        <ChoiceButtons options={o.primary_goals} value={tertiaryGoal} onChange={setTertiaryGoal} />
      </Field>

      <Field label="特に変えたいところは？（必須・複数可）">
        <MultiButtons options={o.focus_areas} values={focusAreas} onChange={setFocusAreas} />
      </Field>

      <Field label="体重の方向性は？（必須）">
        <ChoiceButtons options={o.weight_directions} value={weightDirection} onChange={setWeightDirection} />
      </Field>

      <Field label="数値目標（任意）">
        <div className="grid grid-cols-2 gap-3">
          <input value={currentWeight} onChange={(e) => setCurrentWeight(e.target.value)} inputMode="decimal" placeholder="今の体重kg" className="rounded-2xl border border-slate-200 px-4 py-3 text-[16px]" disabled={weightUnknown} />
          <input value={targetWeight} onChange={(e) => setTargetWeight(e.target.value)} inputMode="decimal" placeholder="目標体重kg" className="rounded-2xl border border-slate-200 px-4 py-3 text-[16px]" />
          <input value={currentBf} onChange={(e) => setCurrentBf(e.target.value)} inputMode="decimal" placeholder="今の体脂肪%" className="rounded-2xl border border-slate-200 px-4 py-3 text-[16px]" />
          <input value={targetBf} onChange={(e) => setTargetBf(e.target.value)} inputMode="decimal" placeholder="目標体脂肪%" className="rounded-2xl border border-slate-200 px-4 py-3 text-[16px]" />
          <input value={currentWaist} onChange={(e) => setCurrentWaist(e.target.value)} inputMode="decimal" placeholder="今のウエストcm" className="rounded-2xl border border-slate-200 px-4 py-3 text-[16px]" />
          <input value={targetWaist} onChange={(e) => setTargetWaist(e.target.value)} inputMode="decimal" placeholder="目標ウエストcm" className="rounded-2xl border border-slate-200 px-4 py-3 text-[16px]" />
        </div>
      </Field>

      <Field label="いつまでに？（必須）">
        <ChoiceButtons options={o.deadlines} value={deadlineType} onChange={setDeadlineType} />
        {deadlineType === "date" ? (
          <input type="date" value={deadlineDate} onChange={(e) => setDeadlineDate(e.target.value)} className="mt-2 w-full rounded-2xl border border-slate-200 px-4 py-3 text-[16px]" />
        ) : null}
      </Field>

      <Field label="達成したい理由（任意）">
        <ChoiceButtons options={o.goal_reasons} value={goalReason} onChange={setGoalReason} />
        {goalReason === "other" ? (
          <input value={goalReasonOther} onChange={(e) => setGoalReasonOther(e.target.value)} placeholder="具体的に" className="mt-2 w-full rounded-2xl border border-slate-200 px-4 py-3 text-[16px]" />
        ) : null}
      </Field>

      <Field label="性別（必須）">
        <ChoiceButtons options={o.sexes} value={sex} onChange={setSex} />
      </Field>

      <Field label="生年月日 または 年齢（必須）">
        <input type="date" value={birthDate} onChange={(e) => setBirthDate(e.target.value)} className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-[16px]" />
        <input value={ageYears} onChange={(e) => setAgeYears(e.target.value)} inputMode="numeric" placeholder="または年齢（歳）" className="mt-2 w-full rounded-2xl border border-slate-200 px-4 py-3 text-[16px]" />
      </Field>

      <Field label="身長（必須）">
        <input value={heightCm} onChange={(e) => setHeightCm(e.target.value)} inputMode="decimal" placeholder="例: 165" className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-[16px]" />
      </Field>

      <Field label="今の体重（必須）">
        <label className="mb-2 flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={weightUnknown}
            onChange={(e) => {
              setWeightUnknown(e.target.checked);
              if (e.target.checked) setCurrentWeight("");
            }}
          />
          正確にはわからない
        </label>
        {!weightUnknown ? (
          <input value={currentWeight} onChange={(e) => setCurrentWeight(e.target.value)} inputMode="decimal" placeholder="例: 60" className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-[16px]" />
        ) : null}
      </Field>

      <Field label="普段の活動量は？（必須）">
        <ChoiceButtons options={o.activities} value={activity} onChange={setActivity} />
      </Field>

      <Field label="理想の通う頻度は？（必須）">
        <ChoiceButtons options={o.frequencies} value={frequency} onChange={setFrequency} />
      </Field>

      <Field label="通いやすい時間（必須・複数可）">
        <MultiButtons options={o.preferred_times} values={preferredTimes} onChange={setPreferredTimes} />
      </Field>

      <Field label="平均の睡眠時間は？（必須）">
        <ChoiceButtons options={o.sleeps} value={sleep} onChange={setSleep} />
      </Field>

      <Field label="今いちばん大変なことは？（必須・最大3つ）">
        <MultiButtons options={o.challenges} values={challenges} onChange={setChallenges} max={3} />
      </Field>

      <Field label="食事で変えられそうなこと（任意）">
        <ChoiceButtons options={o.meal_changes} value={mealChange} onChange={setMealChange} />
      </Field>

      <Field label="痛み・不安・気になる部位は？（必須）">
        <MultiButtons options={o.pains} values={pains} onChange={setPains} />
      </Field>

      <Field label="トレーニングの進め方希望（必須・複数可）">
        <MultiButtons options={o.training_styles} values={trainingStyles} onChange={setTrainingStyles} />
      </Field>

      <Field label="止められている運動・持病（任意・なければ空欄）">
        <textarea
          value={medical}
          onChange={(e) => setMedical(e.target.value)}
          rows={3}
          placeholder="なければ空欄でOK"
          className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-[16px]"
        />
      </Field>

      <Field label={`なりたい体型の写真（必須・1〜3枚）${photoPaths.length ? `：${photoPaths.length}枚` : ""}`}>
        <input
          type="file"
          accept="image/*"
          multiple
          disabled={uploading || photoPaths.length >= 3}
          onChange={(e) => onPickPhotos(e.target.files)}
          className="w-full text-sm"
        />
        <p className="text-xs text-slate-500">他人の参考写真でもOK。全身がわかるものが望ましいです。</p>
        {uploading ? <p className="text-xs text-teal-700">アップロード中…</p> : null}
        {photoPaths.length ? (
          <button type="button" className="text-xs text-slate-500 underline" onClick={() => setPhotoPaths([])}>
            写真をクリアして選び直す
          </button>
        ) : null}
      </Field>

      <Field label="トレーナーに伝えておきたいこと（任意）">
        <textarea
          value={freeComment}
          onChange={(e) => setFreeComment(e.target.value)}
          rows={3}
          className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-[16px]"
        />
      </Field>

      <button
        type="button"
        disabled={submitting || uploading}
        onClick={submit}
        className="w-full rounded-2xl px-4 py-4 text-sm font-semibold text-white disabled:opacity-60"
        style={{ backgroundColor: GOAL_HEARING_ACCENT }}
      >
        {submitting ? "送信中…" : "回答を送信する"}
      </button>
    </div>
  );
}
