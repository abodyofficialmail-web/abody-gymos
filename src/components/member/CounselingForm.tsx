"use client";

import { useMemo } from "react";
import {
  BODY_MAKE_CHALLENGE_OPTIONS,
  BODY_MAKE_PRIORITY_OPTIONS,
  createBodyFatPctOptions,
  createCounselingWeightKgOptions,
  createHeightCmOptions,
  MEMBER_DAY_OFF_OPTIONS,
  MEMBER_HOBBY_OPTIONS,
  MEMBER_OCCUPATION_OPTIONS,
  type CounselingFormState,
} from "@/lib/memberCounseling";

function toggleInList(list: string[], value: string): string[] {
  return list.includes(value) ? list.filter((x) => x !== value) : [...list, value];
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <div className="text-sm font-semibold text-slate-800">{children}</div>;
}

function SelectField({
  label,
  value,
  options,
  placeholder,
  onChange,
}: {
  label: string;
  value: string;
  options: string[];
  placeholder: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="block space-y-2">
      <FieldLabel>{label}</FieldLabel>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-[16px] outline-none focus:border-slate-400"
      >
        <option value="">{placeholder}</option>
        {options.map((opt) => (
          <option key={opt} value={opt}>
            {opt}
          </option>
        ))}
      </select>
    </label>
  );
}

function RadioGroup({
  name,
  value,
  options,
  onChange,
}: {
  name: string;
  value: string;
  options: readonly string[];
  onChange: (v: string) => void;
}) {
  return (
    <div className="space-y-2">
      <label
        className={[
          "flex cursor-pointer items-center gap-3 rounded-2xl border px-4 py-3 text-sm",
          value === "" ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50",
        ].join(" ")}
      >
        <input type="radio" name={name} checked={value === ""} onChange={() => onChange("")} className="h-4 w-4" />
        <span>未選択</span>
      </label>
      {options.map((opt) => {
        const active = value === opt;
        return (
          <label
            key={`${name}-${opt}`}
            className={[
              "flex cursor-pointer items-center gap-3 rounded-2xl border px-4 py-3 text-sm",
              active ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-800 hover:bg-slate-50",
            ].join(" ")}
          >
            <input type="radio" name={name} checked={active} onChange={() => onChange(opt)} className="h-4 w-4" />
            <span>{opt}</span>
          </label>
        );
      })}
    </div>
  );
}

function CheckboxGroup({
  values,
  options,
  onChange,
}: {
  values: string[];
  options: readonly string[];
  onChange: (next: string[]) => void;
}) {
  return (
    <div className="space-y-2">
      {options.map((opt) => {
        const active = values.includes(opt);
        return (
          <label
            key={opt}
            className={[
              "flex cursor-pointer items-center gap-3 rounded-2xl border px-4 py-3 text-sm",
              active ? "border-emerald-700 bg-emerald-50 text-emerald-950" : "border-slate-200 bg-white text-slate-800 hover:bg-slate-50",
            ].join(" ")}
          >
            <input
              type="checkbox"
              checked={active}
              onChange={() => onChange(toggleInList(values, opt))}
              className="h-4 w-4 rounded"
            />
            <span>{opt}</span>
          </label>
        );
      })}
    </div>
  );
}

export function CounselingForm({
  value,
  onChange,
}: {
  value: CounselingFormState;
  onChange: (next: CounselingFormState) => void;
}) {
  const set = <K extends keyof CounselingFormState>(key: K, next: CounselingFormState[K]) => {
    onChange({ ...value, [key]: next });
  };

  const heightOptions = useMemo(() => createHeightCmOptions(), []);
  const weightOptions = useMemo(() => createCounselingWeightKgOptions(), []);
  const bodyFatOptions = useMemo(() => createBodyFatPctOptions(), []);

  return (
    <section className="space-y-5 rounded-2xl border border-slate-200 bg-[#f7f3ea] p-4 shadow-sm">
      <div className="text-base font-bold text-slate-900">カウンセリング内容</div>
      <div className="text-xs text-slate-600">すべて任意です。入力できた項目だけカルテに保存されます。</div>

      <label className="block space-y-2">
        <FieldLabel>2026年トレーニング目標をおしえてください！</FieldLabel>
        <textarea
          value={value.trainingGoals2026}
          onChange={(e) => set("trainingGoals2026", e.target.value)}
          placeholder="例：腹筋を割る！健康診断オールA！など"
          rows={4}
          className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-[16px] outline-none focus:border-slate-400"
        />
      </label>

      <div className="space-y-2">
        <FieldLabel>【1番】ボディメイクの優先順位は？</FieldLabel>
        <RadioGroup name="priority1" value={value.bodyMakePriority1} options={BODY_MAKE_PRIORITY_OPTIONS} onChange={(v) => set("bodyMakePriority1", v)} />
      </div>

      <div className="space-y-2">
        <FieldLabel>【2番】ボディメイクの優先順位は？</FieldLabel>
        <RadioGroup name="priority2" value={value.bodyMakePriority2} options={BODY_MAKE_PRIORITY_OPTIONS} onChange={(v) => set("bodyMakePriority2", v)} />
      </div>

      <div className="space-y-2">
        <FieldLabel>【3番】ボディメイクの優先順位は？</FieldLabel>
        <RadioGroup name="priority3" value={value.bodyMakePriority3} options={BODY_MAKE_PRIORITY_OPTIONS} onChange={(v) => set("bodyMakePriority3", v)} />
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <SelectField
          label="身長（cm）"
          value={value.heightCm}
          options={heightOptions}
          placeholder="選択してください"
          onChange={(v) => set("heightCm", v)}
        />
        <SelectField
          label="体重（kg）"
          value={value.weightKg}
          options={weightOptions}
          placeholder="選択してください"
          onChange={(v) => set("weightKg", v)}
        />
        <SelectField
          label="体脂肪率（%）"
          value={value.bodyFatPct}
          options={bodyFatOptions}
          placeholder="選択してください"
          onChange={(v) => set("bodyFatPct", v)}
        />
      </div>

      <label className="block space-y-2">
        <FieldLabel>数値目標</FieldLabel>
        <input
          value={value.numericGoals}
          onChange={(e) => set("numericGoals", e.target.value)}
          placeholder="例：体重-5kg、体脂肪-3%、ウエスト-5cm など"
          className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-[16px]"
        />
      </label>

      <label className="block space-y-2">
        <FieldLabel>痛み・不安・禁止動作</FieldLabel>
        <textarea
          value={value.painAndRestrictions}
          onChange={(e) => set("painAndRestrictions", e.target.value)}
          rows={3}
          className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-[16px]"
        />
      </label>

      <div className="space-y-2">
        <FieldLabel>ボディメイクする上で大変なのは？</FieldLabel>
        <CheckboxGroup
          values={value.bodyMakeChallenges}
          options={BODY_MAKE_CHALLENGE_OPTIONS}
          onChange={(next) => set("bodyMakeChallenges", next)}
        />
      </div>

      <label className="block space-y-2">
        <FieldLabel>2026年のイベント・期限目標</FieldLabel>
        <textarea
          value={value.futureEvents2026}
          onChange={(e) => set("futureEvents2026", e.target.value)}
          placeholder="例：3月卒業式、6月旅行、9月健康診断 など"
          rows={3}
          className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-[16px]"
        />
      </label>

      <div className="space-y-2">
        <FieldLabel>趣味</FieldLabel>
        <CheckboxGroup values={value.hobbies} options={MEMBER_HOBBY_OPTIONS} onChange={(next) => set("hobbies", next)} />
      </div>

      <div className="space-y-2">
        <FieldLabel>職業</FieldLabel>
        <CheckboxGroup values={value.occupations} options={MEMBER_OCCUPATION_OPTIONS} onChange={(next) => set("occupations", next)} />
      </div>

      <div className="space-y-2">
        <FieldLabel>休みの日</FieldLabel>
        <CheckboxGroup values={value.daysOff} options={MEMBER_DAY_OFF_OPTIONS} onChange={(next) => set("daysOff", next)} />
      </div>

      <label className="block space-y-2">
        <FieldLabel>トレーナー記入欄</FieldLabel>
        <textarea
          value={value.trainerNotes}
          onChange={(e) => set("trainerNotes", e.target.value)}
          placeholder="例：右肩が上がりやすい、スクワット時は膝の内旋に注意。他トレーナーへの引き継ぎ事項など"
          rows={5}
          className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-[16px] outline-none focus:border-slate-400"
        />
      </label>
    </section>
  );
}

export function validateCounselingForm(_state: CounselingFormState): string | null {
  return null;
}
