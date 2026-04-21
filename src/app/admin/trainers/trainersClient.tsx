"use client";

import { useEffect, useMemo, useState } from "react";

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

type ShiftRow = {
  id: string;
  trainer_id: string;
  store_id: string;
  shift_date: string; // YYYY-MM-DD
  start_local: string; // HH:MM:SS
  end_local: string; // HH:MM:SS
  status: string;
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
  function jstTodayYmd() {
    return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo" }).format(new Date());
  }

  function ymdFromParts(y: number, m1: number, d: number) {
    return `${String(y).padStart(4, "0")}-${String(m1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  }

  function monthKeyFromDate(date: Date) {
    const parts = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit" })
      .formatToParts(date)
      .reduce((acc, p) => {
        if (p.type === "year" || p.type === "month") (acc as any)[p.type] = p.value;
        return acc;
      }, {} as { year: string; month: string });
    return `${parts.year}-${parts.month}`;
  }

  function getMonthYmdRange(month: string) {
    const y = Number(month.slice(0, 4));
    const m = Number(month.slice(5, 7));
    const last = new Date(Date.UTC(y, m, 0));
    const lastYmd = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo" }).format(last);
    const daysInMonth = Number(lastYmd.slice(8, 10));
    return { year: y, month1: m, daysInMonth };
  }

  function dowIndex(ymd: string): number {
    const [y, m, d] = ymd.split("-").map((x) => Number(x));
    const date = new Date(Date.UTC(y, m - 1, d));
    const jstDay = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Tokyo", weekday: "short" }).format(date);
    const map: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    return map[jstDay] ?? 0;
  }

  function hhmmFromSlotMinutes(totalMin: number) {
    const hh = Math.floor(totalMin / 60);
    const mm = totalMin % 60;
    return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
  }

  const [storeId, setStoreId] = useState(stores[0]?.id ?? "");
  const [trainerId, setTrainerId] = useState("");
  const [month, setMonth] = useState(() => monthKeyFromDate(new Date()));
  const [selectedDate, setSelectedDate] = useState<string>(() => jstTodayYmd());
  const [selectedTime, setSelectedTime] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [shifts, setShifts] = useState<ShiftRow[] | null>(null);

  const trainersForStore = useMemo(() => {
    return trainers.filter((t) => t.is_active && t.store_id === storeId);
  }, [trainers, storeId]);

  useEffect(() => {
    if (!trainerId) {
      const first = trainersForStore[0]?.id ?? "";
      if (first) setTrainerId(first);
    } else if (!trainersForStore.some((t) => t.id === trainerId)) {
      setTrainerId(trainersForStore[0]?.id ?? "");
    }
  }, [trainerId, trainersForStore]);

  const shiftsByDate = useMemo(() => {
    const m = new Map<string, ShiftRow[]>();
    for (const s of shifts ?? []) {
      const arr = m.get(s.shift_date) ?? [];
      arr.push(s);
      m.set(s.shift_date, arr);
    }
    return m;
  }, [shifts]);

  async function loadShifts() {
    if (!storeId) return;
    setErr(null);
    setShifts(null);
    try {
      const qs = new URLSearchParams({ store_id: storeId, month });
      if (trainerId) qs.set("trainer_id", trainerId);
      const j = await apiGet<{ shifts: ShiftRow[] }>(`/api/shifts?${qs.toString()}`);
      setShifts(j.shifts ?? []);
    } catch (e: any) {
      setErr(String(e?.message ?? "シフトの取得に失敗しました"));
      setShifts([]);
    }
  }

  useEffect(() => {
    void loadShifts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storeId, trainerId, month]);

  const { year, month1, daysInMonth } = useMemo(() => getMonthYmdRange(month), [month]);
  const firstYmd = useMemo(() => `${month}-01`, [month]);
  const startDow = useMemo(() => dowIndex(firstYmd), [firstYmd]);
  const cells = 42;

  const slots = useMemo(() => {
    const start = 9 * 60;
    const end = 21 * 60;
    const list: { start: string; end: string }[] = [];
    for (let m = start; m + 30 <= end; m += 30) {
      const s = hhmmFromSlotMinutes(m);
      const e = hhmmFromSlotMinutes(m + 30);
      list.push({ start: s, end: e });
    }
    return list;
  }, []);

  async function onRegisterShift() {
    if (!storeId || !trainerId || !selectedDate || !selectedTime) return;
    const slot = slots.find((s) => s.start === selectedTime);
    if (!slot) return;
    setBusy(true);
    setErr(null);
    setOk(null);
    try {
      await apiPost<{ shift: ShiftRow }>("/api/shifts", {
        trainer_id: trainerId,
        store_id: storeId,
        date: selectedDate,
        start_at: slot.start,
        end_at: slot.end,
      });
      setOk("登録しました。");
      setSelectedTime("");
      await loadShifts();
    } catch (e: any) {
      setErr(String(e?.message ?? "登録に失敗しました"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm space-y-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="grid gap-3 sm:grid-cols-2">
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
              トレーナー
              <select
                value={trainerId}
                onChange={(e) => setTrainerId(e.target.value)}
                disabled={busy || trainersForStore.length === 0}
                className="mt-1 w-full min-h-[44px] rounded-xl border border-slate-200 bg-white px-3 text-sm"
              >
                {trainersForStore.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.display_name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                const y = year;
                const mPrev = month1 - 1;
                const d = new Date(Date.UTC(mPrev <= 0 ? y - 1 : y, (mPrev <= 0 ? 12 : mPrev) - 1, 1));
                setMonth(monthKeyFromDate(d));
              }}
              className="min-h-[44px] rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold hover:bg-slate-50"
            >
              ←
            </button>
            <div className="text-sm font-semibold text-slate-900">
              {year}年{month1}月
            </div>
            <button
              type="button"
              onClick={() => {
                const d = new Date(Date.UTC(year, month1, 1));
                setMonth(monthKeyFromDate(d));
              }}
              className="min-h-[44px] rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold hover:bg-slate-50"
            >
              →
            </button>
          </div>
        </div>

        {err ? <p className="text-sm font-semibold text-red-700">{err}</p> : null}
        {ok ? <p className="text-sm font-semibold text-teal-700">{ok}</p> : null}

        <div className="grid grid-cols-7 gap-2 text-center text-xs text-slate-500">
          {["日", "月", "火", "水", "木", "金", "土"].map((w) => (
            <div key={w} className="py-1">
              {w}
            </div>
          ))}
        </div>

        <div className="grid grid-cols-7 gap-2">
          {Array.from({ length: cells }, (_, idx) => {
            const dayNum = idx - startDow + 1;
            const inMonth = dayNum >= 1 && dayNum <= daysInMonth;
            const ymd = inMonth ? ymdFromParts(year, month1, dayNum) : "";
            const isSelected = ymd && ymd === selectedDate;
            const dayShifts = ymd ? shiftsByDate.get(ymd) ?? [] : [];
            return (
              <button
                key={idx}
                type="button"
                disabled={!inMonth}
                onClick={() => {
                  if (!ymd) return;
                  setSelectedDate(ymd);
                  setSelectedTime("");
                }}
                className={[
                  "aspect-square rounded-xl border p-2 text-left",
                  inMonth ? "border-slate-200 bg-white hover:bg-slate-50" : "border-transparent bg-transparent",
                  isSelected ? "ring-2 ring-slate-900/20" : "",
                ].join(" ")}
              >
                {inMonth ? (
                  <div className="flex h-full flex-col justify-between">
                    <div className="text-sm font-semibold text-slate-900">{dayNum}</div>
                    <div className="text-[11px] text-slate-600">{dayShifts.length > 0 ? `${dayShifts.length}件` : ""}</div>
                  </div>
                ) : (
                  <div />
                )}
              </button>
            );
          })}
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm space-y-3">
        <div className="flex items-center justify-between">
          <div className="text-sm font-bold text-slate-900">時間スロット</div>
          <div className="text-xs text-slate-500">{selectedDate}</div>
        </div>

        <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
          {slots.map((s) => {
            const selected = selectedTime === s.start;
            return (
              <button
                key={s.start}
                type="button"
                onClick={() => setSelectedTime(s.start)}
                className={[
                  "min-h-[44px] rounded-xl border px-2 text-sm font-semibold",
                  selected ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white hover:bg-slate-50",
                ].join(" ")}
              >
                {s.start}
              </button>
            );
          })}
        </div>

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-sm text-slate-700">
            選択:{" "}
            {selectedTime
              ? (() => {
                  const slot = slots.find((s) => s.start === selectedTime);
                  return slot ? `${slot.start}〜${slot.end}` : "-";
                })()
              : "-"}
          </div>
          <button
            type="button"
            onClick={() => void onRegisterShift()}
            disabled={busy || !storeId || !trainerId || !selectedDate || !selectedTime}
            className="min-h-[44px] rounded-xl bg-slate-900 px-4 text-sm font-bold text-white disabled:opacity-60"
          >
            シフト登録
          </button>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm space-y-2">
        <div className="text-sm font-bold text-slate-900">登録済みシフト（選択日）</div>
        {selectedDate ? (
          (shiftsByDate.get(selectedDate) ?? []).length > 0 ? (
            <div className="grid gap-2">
              {(shiftsByDate.get(selectedDate) ?? []).map((s) => (
                <div key={s.id} className="rounded-xl border border-slate-200 px-3 py-2 text-sm">
                  {s.start_local.slice(0, 5)}〜{s.end_local.slice(0, 5)}
                </div>
              ))}
            </div>
          ) : (
            <div className="text-sm text-slate-600">この日はまだありません。</div>
          )
        ) : (
          <div className="text-sm text-slate-600">日付を選択してください。</div>
        )}
      </section>
    </div>
  );
}

