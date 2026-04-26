"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

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

type ApiTrainer = { id: string; name: string; store_id: string; store_name: string };

type ShiftRow = {
  id: string;
  trainer_id: string;
  store_id: string;
  shift_date: string; // YYYY-MM-DD
  start_local: string; // HH:MM:SS
  end_local: string; // HH:MM:SS
  status: string;
  is_break?: boolean | null;
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

export function AdminTrainersClient({
  stores,
  trainers,
  hideTrainerSelect = false,
  allowAllStores = false,
}: {
  stores: Store[];
  trainers: TrainerRow[];
  hideTrainerSelect?: boolean;
  allowAllStores?: boolean;
}) {
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

  const [storeId, setStoreId] = useState<string>(() => (allowAllStores ? "all" : stores[0]?.id ?? ""));
  const [trainerId, setTrainerId] = useState<string>("");
  const [month, setMonth] = useState(() => monthKeyFromDate(new Date()));
  const [selectedDate, setSelectedDate] = useState<string>(() => jstTodayYmd());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [shifts, setShifts] = useState<ShiftRow[] | null>(null);

  const [trainersLive, setTrainersLive] = useState<TrainerRow[] | null>(null);

  useEffect(() => {
    fetch("/api/trainers", { cache: "no-store" })
      .then((res) => res.json())
      .then((data: { trainers?: ApiTrainer[] }) => {
        const list = (data.trainers ?? []).map(
          (t): TrainerRow => ({
            id: t.id,
            display_name: t.name,
            store_id: t.store_id,
            store_name: t.store_name,
            hourly_rate_yen: null,
            is_active: true,
            user_id: null,
            email: null,
          })
        );
        setTrainersLive(list);
      })
      .catch(() => {
        setTrainersLive(null);
      });
  }, []);

  const effectiveTrainers = trainersLive ?? trainers;

  const trainersForStore = useMemo(() => {
    const list =
      storeId === "all"
        ? effectiveTrainers.filter((t) => t.is_active)
        : effectiveTrainers.filter((t) => t.is_active && t.store_id === storeId);
    return list
      .slice()
      .sort((a, b) => a.display_name.localeCompare(b.display_name, "ja"));
  }, [effectiveTrainers, storeId]);

  useEffect(() => {
    if (hideTrainerSelect) {
      if (trainerId) setTrainerId("");
      return;
    }
    if (!trainerId) {
      const first = trainersForStore[0]?.id ?? "";
      if (first) setTrainerId(first);
    } else if (!trainersForStore.some((t) => t.id === trainerId)) {
      setTrainerId(trainersForStore[0]?.id ?? "");
    }
  }, [trainerId, trainersForStore, hideTrainerSelect]);

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
      const qs = new URLSearchParams({ month });
      if (storeId !== "all") qs.set("store_id", storeId);
      if (trainerId) qs.set("trainer_id", trainerId);
      const j = await apiGet<{ shifts: ShiftRow[] }>(`/api/shifts?${qs.toString()}`);
      setShifts(j.shifts ?? []);
      console.log("[admin/trainers] shifts", j.shifts ?? []);
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
                {allowAllStores ? <option value="all">全店舗</option> : null}
                {stores.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
            {hideTrainerSelect ? (
              <div />
            ) : (
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
            )}
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
            if (!inMonth || !ymd) {
              return <div key={idx} className="aspect-square" />;
            }
            return (
              <Link
                key={ymd}
                href={`/admin/trainers/${ymd}`}
                onClick={() => {
                  setSelectedDate(ymd);
                }}
                className={[
                  "aspect-square rounded-xl border p-2 text-left block",
                  "border-slate-200 bg-white hover:bg-slate-50",
                  isSelected ? "ring-2 ring-slate-900/20" : "",
                ].join(" ")}
              >
                <div className="flex h-full flex-col justify-between">
                  <div className="text-sm font-semibold text-slate-900">{dayNum}</div>
                  <div className="text-[11px] text-slate-600">{dayShifts.length > 0 ? `${dayShifts.length}件` : ""}</div>
                </div>
              </Link>
            );
          })}
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

