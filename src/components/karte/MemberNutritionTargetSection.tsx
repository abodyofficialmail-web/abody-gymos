"use client";

import { formatIntakeLabel, type MemberNutritionTargetView } from "@/lib/memberNutritionTargets";
import { DateTime } from "luxon";
import { useCallback, useEffect, useState } from "react";

const TZ = "Asia/Tokyo";

type Draft = {
  daily_expenditure_kcal: string;
  intake_kcal: string;
  protein_g: string;
  fat_g: string;
  carb_g: string;
  note: string;
};

type HearingMeta = { has_response: boolean; weight_missing: boolean };

async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(path, { cache: "no-store" });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((json as { error?: string })?.error ?? "取得に失敗しました");
  return json as T;
}

async function apiPatch<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((json as { error?: string })?.error ?? "保存に失敗しました");
  return json as T;
}

function toDraft(t: MemberNutritionTargetView): Draft {
  return {
    daily_expenditure_kcal: String(t.daily_expenditure_kcal),
    intake_kcal: String(t.intake_kcal),
    protein_g: String(t.protein_g),
    fat_g: String(t.fat_g),
    carb_g: String(t.carb_g),
    note: t.note ?? "",
  };
}

function formatUpdatedAt(iso: string) {
  const dt = DateTime.fromISO(iso, { zone: TZ });
  if (!dt.isValid) return iso;
  return dt.toFormat("yyyy/M/d HH:mm");
}

function sourceLabel(source: MemberNutritionTargetView["source"]) {
  return source === "manual" ? "トレーナー編集" : "目標ヒアリング";
}

function emptyMessage(hearing: HearingMeta | null): string {
  if (hearing?.weight_missing) {
    return "目標ヒアリングで体重が未入力のため自動計算できません。「手動で登録」から入力してください。";
  }
  if (hearing?.has_response) {
    return "目標ヒアリングは回答済みですが、栄養目標を算出できませんでした。「手動で登録」から入力してください。";
  }
  return "まだ栄養目標がありません。目標ヒアリング回答後に自動表示されます。";
}

/** 会員カルテ：栄養目標（消費・摂取・PFC）表示＋編集 */
export function MemberNutritionTargetSection({ memberId }: { memberId: string }) {
  const [target, setTarget] = useState<MemberNutritionTargetView | null | undefined>(undefined);
  const [hearing, setHearing] = useState<HearingMeta | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    setErr(null);
    try {
      const data = await apiGet<{ target: MemberNutritionTargetView | null; hearing?: HearingMeta }>(
        `/api/admin/members/${encodeURIComponent(memberId)}/nutrition-targets`
      );
      setTarget(data.target);
      setHearing(data.hearing ?? null);
    } catch (e) {
      setTarget(null);
      setHearing(null);
      setErr(String((e as Error)?.message ?? "取得に失敗しました"));
    }
  }, [memberId]);

  useEffect(() => {
    void load();
  }, [load]);

  const startEdit = () => {
    if (!target) {
      setDraft({
        daily_expenditure_kcal: "",
        intake_kcal: "",
        protein_g: "",
        fat_g: "",
        carb_g: "",
        note: "",
      });
    } else {
      setDraft(toDraft(target));
    }
    setMsg(null);
    setEditing(true);
  };

  const save = async () => {
    if (!draft) return;
    const daily = Number(draft.daily_expenditure_kcal);
    const intake = Number(draft.intake_kcal);
    const protein = Number(draft.protein_g);
    const fat = Number(draft.fat_g);
    const carb = Number(draft.carb_g);
    if (![daily, intake, protein, fat, carb].every((n) => Number.isFinite(n) && n >= 0)) {
      setMsg("数値を正しく入力してください");
      return;
    }
    setSaving(true);
    setMsg(null);
    try {
      const res = await apiPatch<{ target: MemberNutritionTargetView }>(
        `/api/admin/members/${encodeURIComponent(memberId)}/nutrition-targets`,
        {
          daily_expenditure_kcal: Math.round(daily),
          intake_kcal: Math.round(intake),
          protein_g: Math.round(protein),
          fat_g: Math.round(fat),
          carb_g: Math.round(carb),
          note: draft.note.trim() || null,
        }
      );
      setTarget(res.target);
      setEditing(false);
      setDraft(null);
      setMsg("保存しました（マイページにも反映されます）");
    } catch (e) {
      setMsg(String((e as Error)?.message ?? "保存に失敗しました"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm font-bold text-slate-900">栄養目標（カロリー・PFC）</div>
        {!editing ? (
          <button
            type="button"
            onClick={startEdit}
            className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
          >
            {target ? "編集" : "手動で登録"}
          </button>
        ) : null}
      </div>
      <p className="text-xs text-slate-600">
        目標ヒアリングの目安です。トレーナーが調整すると会員マイページにも同じ数字が表示されます。
      </p>

      {target === undefined ? <div className="text-sm text-slate-600">読み込み中…</div> : null}
      {err ? <div className="text-sm text-red-700">{err}</div> : null}

      {!editing && target === null && !err ? (
        <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-3 py-4 text-sm text-slate-600">
          {emptyMessage(hearing)}
        </div>
      ) : null}

      {!editing && target ? (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
              <div className="text-[11px] font-semibold text-slate-500">1日の消費カロリー</div>
              <div className="mt-0.5 text-base font-bold text-slate-900">
                {target.daily_expenditure_kcal}
                <span className="ml-1 text-xs font-semibold text-slate-500">kcal</span>
              </div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
              <div className="text-[11px] font-semibold text-slate-500">目標摂取カロリー</div>
              <div className="mt-0.5 text-base font-bold text-slate-900">
                {formatIntakeLabel(target)}
                <span className="ml-1 text-xs font-semibold text-slate-500">kcal</span>
              </div>
            </div>
            <div className="col-span-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 sm:col-span-1">
              <div className="text-[11px] font-semibold text-slate-500">PFCバランス</div>
              <div className="mt-0.5 text-sm font-bold text-slate-900">
                P {target.protein_g}g / F {target.fat_g}g / C {target.carb_g}g
              </div>
            </div>
          </div>
          {target.note ? <div className="text-xs text-slate-600">※{target.note}</div> : null}
          <div className="text-[11px] text-slate-500">
            {sourceLabel(target.source)} · 更新 {formatUpdatedAt(target.updated_at)}
          </div>
        </div>
      ) : null}

      {editing && draft ? (
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-xs font-semibold text-slate-700">
              1日の消費カロリー（kcal）
              <input
                type="number"
                inputMode="numeric"
                min={0}
                value={draft.daily_expenditure_kcal}
                onChange={(e) => setDraft({ ...draft, daily_expenditure_kcal: e.target.value })}
                className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-[16px] font-normal text-slate-900"
              />
            </label>
            <label className="block text-xs font-semibold text-slate-700">
              目標摂取カロリー（kcal）
              <input
                type="number"
                inputMode="numeric"
                min={0}
                value={draft.intake_kcal}
                onChange={(e) => setDraft({ ...draft, intake_kcal: e.target.value })}
                className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-[16px] font-normal text-slate-900"
              />
            </label>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <label className="block text-xs font-semibold text-slate-700">
              P（g）
              <input
                type="number"
                inputMode="numeric"
                min={0}
                value={draft.protein_g}
                onChange={(e) => setDraft({ ...draft, protein_g: e.target.value })}
                className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-[16px] font-normal text-slate-900"
              />
            </label>
            <label className="block text-xs font-semibold text-slate-700">
              F（g）
              <input
                type="number"
                inputMode="numeric"
                min={0}
                value={draft.fat_g}
                onChange={(e) => setDraft({ ...draft, fat_g: e.target.value })}
                className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-[16px] font-normal text-slate-900"
              />
            </label>
            <label className="block text-xs font-semibold text-slate-700">
              C（g）
              <input
                type="number"
                inputMode="numeric"
                min={0}
                value={draft.carb_g}
                onChange={(e) => setDraft({ ...draft, carb_g: e.target.value })}
                className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-[16px] font-normal text-slate-900"
              />
            </label>
          </div>
          <label className="block text-xs font-semibold text-slate-700">
            メモ（任意）
            <input
              type="text"
              value={draft.note}
              onChange={(e) => setDraft({ ...draft, note: e.target.value })}
              placeholder="例: 無理のない減量ペースの目安です。"
              className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-[16px] font-normal text-slate-900"
            />
          </label>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={save}
              disabled={saving}
              className="flex-1 rounded-xl bg-rose-600 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
            >
              {saving ? "保存中…" : "保存する"}
            </button>
            <button
              type="button"
              onClick={() => {
                setEditing(false);
                setDraft(null);
                setMsg(null);
              }}
              disabled={saving}
              className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700"
            >
              キャンセル
            </button>
          </div>
        </div>
      ) : null}

      {msg ? <div className="text-xs text-slate-600">{msg}</div> : null}
    </section>
  );
}

/** マイページ用：読み取り専用 */
export function MemberNutritionTargetReadOnly({
  target,
  loading,
}: {
  target: MemberNutritionTargetView | null;
  loading?: boolean;
}) {
  if (loading) {
    return (
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="text-sm font-bold text-slate-900">栄養目標</div>
        <div className="mt-2 text-sm text-slate-600">読み込み中…</div>
      </section>
    );
  }
  if (!target) return null;

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm space-y-3">
      <div className="text-sm font-bold text-slate-900">栄養目標（カロリー・PFC）</div>
      <p className="text-xs text-slate-500">目標達成のための1日の目安です。トレーナーが調整する場合があります。</p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
          <div className="text-[11px] font-semibold text-slate-500">1日の消費カロリー</div>
          <div className="mt-0.5 text-base font-bold text-slate-900">
            {target.daily_expenditure_kcal}
            <span className="ml-1 text-xs font-semibold text-slate-500">kcal</span>
          </div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
          <div className="text-[11px] font-semibold text-slate-500">目標摂取カロリー</div>
          <div className="mt-0.5 text-base font-bold text-slate-900">
            {formatIntakeLabel(target)}
            <span className="ml-1 text-xs font-semibold text-slate-500">kcal</span>
          </div>
        </div>
        <div className="col-span-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 sm:col-span-1">
          <div className="text-[11px] font-semibold text-slate-500">PFCバランス</div>
          <div className="mt-0.5 text-sm font-bold text-slate-900">
            P {target.protein_g}g / F {target.fat_g}g / C {target.carb_g}g
          </div>
        </div>
      </div>
      {target.note ? <div className="text-xs text-slate-600">※{target.note}</div> : null}
    </section>
  );
}
