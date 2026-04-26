"use client";

import { useMemo, useState } from "react";

type StoreRow = { id: string; name: string; booking_cutoff_prev_day_time?: string | null };

async function apiPatch<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((json as any)?.error ?? "保存に失敗しました");
  return json as T;
}

export function BookingSettingsClient({ stores }: { stores: StoreRow[] }) {
  const [selectedStoreId, setSelectedStoreId] = useState<string>(stores[0]?.id ?? "");
  const selected = useMemo(() => stores.find((s) => s.id === selectedStoreId) ?? null, [stores, selectedStoreId]);

  const [cutoff, setCutoff] = useState<string>(selected?.booking_cutoff_prev_day_time ?? "22:00");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  // 店舗切替時に入力値も追従
  useMemo(() => {
    if (!selected) return;
    setCutoff(selected.booking_cutoff_prev_day_time ?? "22:00");
    setMsg(null);
  }, [selected?.id]);

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm space-y-3">
      <div className="text-sm font-bold text-slate-900">予約締切設定</div>
      <div className="text-xs text-slate-600">
        例: <span className="font-mono">22:00</span> を設定すると「前日22:00まで予約可能」になります。
      </div>

      <div className="grid gap-3 sm:grid-cols-3 sm:items-end">
        <div>
          <div className="text-xs font-semibold text-slate-700">店舗</div>
          <select
            value={selectedStoreId}
            onChange={(e) => setSelectedStoreId(e.target.value)}
            className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
          >
            {stores.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <div className="text-xs font-semibold text-slate-700">締切（前日）</div>
          <input
            value={cutoff}
            onChange={(e) => {
              setCutoff(e.target.value);
              setMsg(null);
            }}
            placeholder="22:00"
            inputMode="numeric"
            className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-mono"
          />
        </div>

        <button
          type="button"
          disabled={!selectedStoreId || busy}
          onClick={async () => {
            if (!selectedStoreId) return;
            setBusy(true);
            setMsg(null);
            try {
              await apiPatch(`/api/admin/stores/${encodeURIComponent(selectedStoreId)}/booking-settings`, {
                booking_cutoff_prev_day_time: cutoff,
              });
              setMsg("保存しました");
            } catch (e: any) {
              setMsg(String(e?.message ?? "保存に失敗しました"));
            } finally {
              setBusy(false);
            }
          }}
          className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
        >
          {busy ? "保存中…" : "保存"}
        </button>
      </div>

      {msg ? <div className="text-xs text-slate-600">{msg}</div> : null}
    </section>
  );
}

