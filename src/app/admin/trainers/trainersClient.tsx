"use client";

import { useMemo, useState } from "react";

type Store = { id: string; name: string };
type TrainerRow = {
  id: string;
  display_name: string;
  store_id: string;
  store_name: string;
  hourly_rate_yen: number | null;
  is_active: boolean;
  user_id: string | null;
  email: string | null;
};

async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = (json as any)?.error?.fieldErrors ? JSON.stringify((json as any).error.fieldErrors) : (json as any)?.error ?? "送信に失敗しました";
    throw new Error(msg);
  }
  return json as T;
}

async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(path, { cache: "no-store" });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = (json as any)?.error?.fieldErrors ? JSON.stringify((json as any).error.fieldErrors) : (json as any)?.error ?? "取得に失敗しました";
    throw new Error(msg);
  }
  return json as T;
}

export function AdminTrainersClient({ stores, trainers }: { stores: Store[]; trainers: TrainerRow[] }) {
  const [displayName, setDisplayName] = useState("");
  const [storeId, setStoreId] = useState(stores[0]?.id ?? "");
  const [hourlyRate, setHourlyRate] = useState<string>("");
  const [isActive, setIsActive] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const [listState, setListState] = useState<TrainerRow[]>(() => trainers.slice());
  const list = useMemo(() => listState.slice(), [listState]);

  async function refresh() {
    const j = await apiGet<{ trainers: TrainerRow[] }>("/api/gym/admin/trainers");
    setListState(j.trainers ?? []);
  }

  async function onSubmit() {
    setErr(null);
    setOk(null);
    const name = displayName.trim();
    if (!name) {
      setErr("display_name は必須です");
      return;
    }
    if (!storeId) {
      setErr("store を選択してください");
      return;
    }

    const hourly =
      hourlyRate.trim() === "" ? null : Number.isFinite(Number(hourlyRate)) ? Math.max(0, Math.floor(Number(hourlyRate))) : NaN;
    if (hourlyRate.trim() !== "" && !Number.isFinite(hourly as any)) {
      setErr("時給は数値で入力してください");
      return;
    }

    setBusy(true);
    try {
      await apiPost<{ trainer: any }>("/api/gym/admin/trainers", {
        display_name: name,
        store_id: storeId,
        hourly_rate_yen: hourly,
        is_active: isActive,
      });
      await refresh();
      setOk("追加しました。");
      setDisplayName("");
      setHourlyRate("");
      setIsActive(true);
    } catch (e: any) {
      setErr(String(e?.message ?? "追加に失敗しました"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="text-sm font-bold text-slate-900">トレーナー追加</h2>
        {err ? <p className="mt-2 text-sm font-semibold text-red-700">{err}</p> : null}
        {ok ? <p className="mt-2 text-sm font-semibold text-teal-700">{ok}</p> : null}

        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="block text-sm font-medium text-slate-700">
            display_name（必須）
            <input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              disabled={busy}
              className="mt-1 w-full min-h-[44px] rounded-xl border border-slate-200 bg-white px-3 text-sm"
              placeholder="例）ともき"
            />
          </label>

          <label className="block text-sm font-medium text-slate-700">
            店舗
            <select
              value={storeId}
              onChange={(e) => setStoreId(e.target.value)}
              disabled={busy}
              className="mt-1 w-full min-h-[44px] rounded-xl border border-slate-200 bg-white px-3 text-sm"
            >
              {stores.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>

          <label className="block text-sm font-medium text-slate-700">
            時給（任意）
            <input
              inputMode="numeric"
              value={hourlyRate}
              onChange={(e) => setHourlyRate(e.target.value)}
              disabled={busy}
              className="mt-1 w-full min-h-[44px] rounded-xl border border-slate-200 bg-white px-3 text-sm"
              placeholder="例）2500"
            />
          </label>

          <label className="flex min-h-[44px] items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700">
            <input
              type="checkbox"
              checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)}
              disabled={busy}
              className="h-4 w-4"
            />
            有効（is_active）
          </label>
        </div>

        <div className="mt-3">
          <button
            type="button"
            onClick={() => void onSubmit()}
            disabled={busy}
            className="min-h-[44px] w-full rounded-xl bg-slate-900 px-4 text-sm font-bold text-white disabled:opacity-60 sm:w-auto"
          >
            追加
          </button>
        </div>
      </section>

      <section className="space-y-2">
        {list.map((t) => (
          <div key={t.id} className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm shadow-sm">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="font-semibold text-slate-900">{t.display_name}</p>
                <p className="text-xs text-slate-500">{t.store_name}</p>
              </div>
              <span className="text-xs text-slate-500">{t.is_active ? "有効" : "無効"}</span>
            </div>
            <p className="mt-1 text-xs text-slate-600">{t.email}</p>
            <p className="text-xs text-slate-500">
              時給 {t.hourly_rate_yen ?? "—"} / user_id {t.user_id ? "紐づけ済" : "未紐づけ"}
            </p>
          </div>
        ))}
      </section>
    </div>
  );
}

