"use client";

import { useMemo, useState } from "react";
import {
  createKarteRepOptions,
  createKarteWeightOptions,
  KARTE_EXERCISE_CATALOG,
  KARTE_TRAINING_PARTS,
  type KarteSessionState,
  type MenuItem,
} from "@/lib/karteSession";

export function KarteSessionForm({
  title = "体験時のセッション内容",
  value,
  onChange,
}: {
  title?: string;
  value: KarteSessionState;
  onChange: (next: KarteSessionState) => void;
}) {
  const set = <K extends keyof KarteSessionState>(key: K, next: KarteSessionState[K]) => {
    onChange({ ...value, [key]: next });
  };

  const repOptions = useMemo(() => createKarteRepOptions(), []);
  const weightOptions = useMemo(() => createKarteWeightOptions(), []);
  const [exercisePickerOpen, setExercisePickerOpen] = useState(false);
  const [exercisePickerQuery, setExercisePickerQuery] = useState("");

  const togglePart = (id: string) => {
    set(
      "trainingParts",
      value.trainingParts.includes(id) ? value.trainingParts.filter((x) => x !== id) : [...value.trainingParts, id]
    );
  };

  const addMenuItem = (exercise: string) => {
    const id = `${Date.now()}_${Math.random().toString(16).slice(2)}`;
    set("menuItems", [...value.menuItems, { id, exercise, sets: [{ reps: "", weight: "" }] }]);
    setExercisePickerOpen(false);
    setExercisePickerQuery("");
  };

  const appendSet = (itemId: string) => {
    set(
      "menuItems",
      value.menuItems.map((x) => (x.id !== itemId ? x : { ...x, sets: [...x.sets, { reps: "", weight: "" }] }))
    );
  };

  const copyLastSet = (itemId: string) => {
    set(
      "menuItems",
      value.menuItems.map((x) => {
        if (x.id !== itemId) return x;
        const last = x.sets[x.sets.length - 1] ?? { reps: "", weight: "" };
        return { ...x, sets: [...x.sets, { reps: last.reps, weight: last.weight }] };
      })
    );
  };

  const removeSetAt = (itemId: string, idx: number) => {
    set(
      "menuItems",
      value.menuItems.map((x) => {
        if (x.id !== itemId) return x;
        if (x.sets.length <= 1) return x;
        const next = x.sets.filter((_, i) => i !== idx);
        return { ...x, sets: next.length ? next : x.sets };
      })
    );
  };

  const updateMenuItem = (itemId: string, updater: (item: MenuItem) => MenuItem) => {
    set(
      "menuItems",
      value.menuItems.map((x) => (x.id === itemId ? updater(x) : x))
    );
  };

  const allExerciseOptions = useMemo(() => {
    const selected = value.trainingParts.length ? value.trainingParts : Object.keys(KARTE_EXERCISE_CATALOG);
    const out: string[] = [];
    for (const p of selected) {
      for (const ex of KARTE_EXERCISE_CATALOG[p] ?? []) out.push(ex);
    }
    return Array.from(new Set(out));
  }, [value.trainingParts]);

  const filteredExerciseOptions = useMemo(() => {
    const q = exercisePickerQuery.trim().toLowerCase();
    if (!q) return allExerciseOptions;
    return allExerciseOptions.filter((x) => x.toLowerCase().includes(q));
  }, [allExerciseOptions, exercisePickerQuery]);

  return (
    <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="text-base font-bold text-slate-900">{title}</div>

      <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
        <div className="text-xs font-semibold text-slate-700">体組成データ（任意）</div>
        <div className="mt-2 grid gap-3 sm:grid-cols-2">
          <div>
            <div className="text-xs text-slate-600">体重（kg）</div>
            <input
              value={value.bodyWeightKg}
              onChange={(e) => set("bodyWeightKg", e.target.value)}
              inputMode="decimal"
              placeholder="例: 70.5"
              className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-[16px]"
            />
          </div>
          <div>
            <div className="text-xs text-slate-600">体脂肪率（%）</div>
            <input
              value={value.bodyFatPct}
              onChange={(e) => set("bodyFatPct", e.target.value)}
              inputMode="decimal"
              placeholder="例: 15.5"
              className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-[16px]"
            />
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
        <div className="text-xs font-semibold text-slate-700">今日の体調</div>
        <select
          value={value.condition}
          onChange={(e) => set("condition", e.target.value)}
          className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-[16px]"
        >
          <option value="">選択してください</option>
          <option value="良い">良い</option>
          <option value="普通">普通</option>
          <option value="やや不調">やや不調</option>
          <option value="不調">不調</option>
        </select>
      </div>

      <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 space-y-3">
        <div className="text-sm font-bold text-slate-900">トレーニング内容</div>
        <div>
          <div className="text-xs font-semibold text-slate-700">トレーニング部位（複数選択可）</div>
          <div className="mt-2 flex flex-wrap gap-2">
            {KARTE_TRAINING_PARTS.map((p) => {
              const active = value.trainingParts.includes(p.id);
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => togglePart(p.id)}
                  className={[
                    "rounded-xl border px-3 py-2 text-sm font-semibold",
                    active ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-900 hover:bg-slate-50",
                  ].join(" ")}
                >
                  {p.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-3 space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <div className="text-xs font-semibold text-slate-700">ストレッチ</div>
              <select
                value={value.stretch}
                onChange={(e) => set("stretch", e.target.value)}
                className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-[16px]"
              >
                <option value="あり">あり</option>
                <option value="なし">なし</option>
              </select>
            </div>
            <div>
              <div className="text-xs font-semibold text-slate-700">痛みや違和感</div>
              <select
                value={value.painLevel}
                onChange={(e) => set("painLevel", e.target.value)}
                className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-[16px]"
              >
                <option value="なし">なし</option>
                <option value="軽い">軽い</option>
                <option value="中">中</option>
                <option value="強い">強い</option>
              </select>
            </div>
          </div>
          <div>
            <div className="text-xs font-semibold text-slate-700">ストレッチ内容</div>
            <input
              value={value.stretchDetail}
              onChange={(e) => set("stretchDetail", e.target.value)}
              placeholder="例: 肩周り/股関節中心に実施"
              className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-[16px]"
            />
          </div>
          <div>
            <div className="text-xs font-semibold text-slate-700">トレーニングコンセプト</div>
            <textarea
              value={value.trainingConcept}
              onChange={(e) => set("trainingConcept", e.target.value)}
              placeholder="例: 大胸筋の上部を意識、フォーム改良に集中"
              className="mt-2 min-h-[80px] w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-[16px]"
            />
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-3 space-y-3">
          <div className="text-xs font-semibold text-slate-700">本日のメニュー</div>
          <div className="space-y-3">
            {value.menuItems.map((item) => (
              <div key={item.id} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-sm font-semibold text-slate-900">{item.exercise}</div>
                  <button
                    type="button"
                    onClick={() => set("menuItems", value.menuItems.filter((x) => x.id !== item.id))}
                    className="rounded-lg border border-red-200 bg-white px-3 py-2 text-xs font-semibold text-red-700"
                  >
                    メニュー削除
                  </button>
                </div>
                <div className="space-y-2">
                  {item.sets.map((s, idx) => (
                    <div key={idx} className="rounded-xl border border-slate-200 bg-white p-3 space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <div className="text-xs font-semibold text-slate-700">セット{idx + 1}</div>
                        <button
                          type="button"
                          onClick={() => removeSetAt(item.id, idx)}
                          disabled={item.sets.length <= 1}
                          className="rounded-lg border border-red-200 bg-white px-3 py-1.5 text-[11px] font-semibold text-red-700 disabled:opacity-50"
                        >
                          セット削除
                        </button>
                      </div>
                      <div className="grid gap-2 sm:grid-cols-2">
                        <div>
                          <div className="text-xs text-slate-600">重量（kg）</div>
                          <select
                            value={s.weight}
                            onChange={(e) =>
                              updateMenuItem(item.id, (x) => ({
                                ...x,
                                sets: x.sets.map((ss, i) => (i === idx ? { ...ss, weight: e.target.value } : ss)),
                              }))
                            }
                            className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-[16px]"
                          >
                            <option value="">選択</option>
                            {weightOptions.map((w) => (
                              <option key={w} value={w}>
                                {w}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <div className="text-xs text-slate-600">回数</div>
                          <select
                            value={s.reps}
                            onChange={(e) =>
                              updateMenuItem(item.id, (x) => ({
                                ...x,
                                sets: x.sets.map((ss, i) => (i === idx ? { ...ss, reps: e.target.value } : ss)),
                              }))
                            }
                            className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-[16px]"
                          >
                            <option value="">選択</option>
                            {repOptions.map((r) => (
                              <option key={r} value={r}>
                                {r}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => appendSet(item.id)}
                    className="flex-1 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-800"
                  >
                    ＋セット追加
                  </button>
                  <button
                    type="button"
                    onClick={() => copyLastSet(item.id)}
                    className="flex-1 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-800"
                  >
                    コピー
                  </button>
                </div>
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={() => {
              setExercisePickerQuery("");
              setExercisePickerOpen(true);
            }}
            className="w-full rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800"
          >
            ＋メニュー追加
          </button>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 space-y-3">
        <div className="text-sm font-bold text-slate-900">セッション記録</div>
        <div>
          <div className="text-xs font-semibold text-slate-700">良かった点</div>
          <textarea
            value={value.goodPoint}
            onChange={(e) => set("goodPoint", e.target.value)}
            className="mt-2 min-h-[70px] w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-[16px]"
          />
        </div>
        <div>
          <div className="text-xs font-semibold text-slate-700">改善点や気付き</div>
          <textarea
            value={value.improvePoint}
            onChange={(e) => set("improvePoint", e.target.value)}
            className="mt-2 min-h-[70px] w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-[16px]"
          />
        </div>
        <div>
          <div className="text-xs font-semibold text-slate-700">会員とのコミュニケーション内容</div>
          <textarea
            value={value.communication}
            onChange={(e) => set("communication", e.target.value)}
            className="mt-2 min-h-[90px] w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-[16px]"
          />
        </div>
      </div>

      {exercisePickerOpen ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-3 sm:items-center">
          <div className="max-h-[80vh] w-full max-w-lg overflow-hidden rounded-2xl bg-white shadow-xl">
            <div className="border-b border-slate-200 px-4 py-3">
              <div className="text-sm font-bold text-slate-900">種目を選択</div>
              <input
                value={exercisePickerQuery}
                onChange={(e) => setExercisePickerQuery(e.target.value)}
                placeholder="検索"
                className="mt-2 w-full rounded-xl border border-slate-200 px-3 py-2 text-[16px]"
              />
            </div>
            <div className="max-h-[55vh] overflow-y-auto p-2">
              {filteredExerciseOptions.map((ex) => (
                <button
                  key={ex}
                  type="button"
                  onClick={() => addMenuItem(ex)}
                  className="block w-full rounded-xl px-3 py-3 text-left text-sm hover:bg-slate-50"
                >
                  {ex}
                </button>
              ))}
            </div>
            <div className="border-t border-slate-200 p-3">
              <button
                type="button"
                onClick={() => setExercisePickerOpen(false)}
                className="w-full rounded-xl border border-slate-200 px-4 py-3 text-sm font-semibold"
              >
                閉じる
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
