"use client";

import { DateTime } from "luxon";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ShiftBreak } from "@/lib/trainerPayroll";
import { computeTrainerDayPayroll, computeTrainerPayrollV2 } from "@/lib/trainerPayroll";

const TZ = "Asia/Tokyo";

function timeToMinutes(t: string): number {
  const m = String(t).trim().match(/^(\d{1,2}):(\d{2})/);
  if (!m) return NaN;
  return Number(m[1]) * 60 + Number(m[2]);
}

function calcTotalBreakMinutes(breaks: { start_time: string; end_time: string }[] | null | undefined): number {
  let sum = 0;
  for (const b of breaks ?? []) {
    const a = timeToMinutes(b.start_time);
    const c = timeToMinutes(b.end_time);
    if (!Number.isFinite(a) || !Number.isFinite(c) || c <= a) continue;
    sum += c - a;
  }
  return sum;
}

export type TrainerDetail = {
  id: string;
  display_name: string;
  store_id: string;
  store_name: string;
};

type ShiftRow = {
  id: string;
  store_id: string;
  shift_date: string;
  start_local: string;
  end_local: string;
  break_minutes?: number | null;
  breaks?: { id: string; start_time: string; end_time: string }[];
  is_break?: boolean | null;
};

type ResRow = { id: string; start_at: string; end_at: string; status: string };

type TrainerApiRow = {
  id: string;
  display_name: string;
  hourly_rate: number | null;
  monthly_pass_cost: number | null;
};

type StoreRow = { id: string; name: string };
type TransportCostRow = { id: string; trainer_id: string | null; store_id: string | null; cost: number | null };
type ExpenseRow = { id: string; trainer_id: string | null; title: string; amount: number | null; type: "monthly" | "daily" };
type ShiftBreakRow = ShiftBreak & { created_at?: string };

async function apiGet<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: "no-store" });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((j as { error?: string }).error ?? "取得に失敗しました");
  return j as T;
}

async function apiPatch<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((j as { error?: string }).error ?? "送信に失敗しました");
  return j as T;
}

async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((j as { error?: string }).error ?? "送信に失敗しました");
  return j as T;
}

async function apiDelete<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((j as { error?: string }).error ?? "削除に失敗しました");
  return j as T;
}

export function TrainerDetailClient({ trainer }: { trainer: TrainerDetail }) {
  const [month, setMonth] = useState(() => DateTime.now().setZone(TZ).toFormat("yyyy-MM"));
  const [shifts, setShifts] = useState<ShiftRow[] | null>(null);
  const [reservations, setReservations] = useState<ResRow[] | null>(null);
  const [rates, setRates] = useState<TrainerApiRow | null>(null);
  const [stores, setStores] = useState<StoreRow[]>([]);
  const [transportCosts, setTransportCosts] = useState<TransportCostRow[]>([]);
  const [expenses, setExpenses] = useState<ExpenseRow[]>([]);
  const [breaks, setBreaks] = useState<ShiftBreakRow[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [saveErr, setSaveErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saveBusy, setSaveBusy] = useState(false);
  const [breakDate, setBreakDate] = useState(() => DateTime.now().setZone(TZ).toISODate()!);
  const [breakStart, setBreakStart] = useState("12:00");
  const [breakEnd, setBreakEnd] = useState("13:00");
  const [draftHourly, setDraftHourly] = useState(0);
  const [draftPass, setDraftPass] = useState(0);

  const loadRates = useCallback(async () => {
    const { trainer: t } = await apiGet<{ trainer: TrainerApiRow }>(`/api/trainers/${encodeURIComponent(trainer.id)}`);
    setRates(t);
    setDraftHourly(Number(t.hourly_rate ?? 0));
    setDraftPass(Number(t.monthly_pass_cost ?? 0));
  }, [trainer.id]);

  const loadSettingsLists = useCallback(async () => {
    const [storesJ, tcJ, exJ] = await Promise.all([
      apiGet<{ stores: StoreRow[] }>("/api/booking-v2/stores"),
      apiGet<{ transport_costs: TransportCostRow[] }>(`/api/trainers/${encodeURIComponent(trainer.id)}/transport-costs`),
      apiGet<{ expenses: ExpenseRow[] }>(`/api/trainers/${encodeURIComponent(trainer.id)}/expenses`),
    ]);
    setStores(storesJ.stores ?? []);
    setTransportCosts(tcJ.transport_costs ?? []);
    setExpenses(exJ.expenses ?? []);
  }, [trainer.id]);

  const loadBreaks = useCallback(async () => {
    try {
      const j = await apiGet<{ breaks: ShiftBreakRow[] }>(
        `/api/shifts/breaks?trainer_id=${encodeURIComponent(trainer.id)}&month=${encodeURIComponent(month)}`
      );
      setBreaks(j.breaks ?? []);
    } catch (e) {
      console.error("shift breaks fetch error", e);
      setBreaks((prev) => prev ?? []);
    }
  }, [trainer.id, month]);

  const load = useCallback(async () => {
    setErr(null);
    try {
      const [sj, rj] = await Promise.all([
        apiGet<{ shifts: ShiftRow[] }>(
          `/api/shifts?trainer_id=${encodeURIComponent(trainer.id)}&month=${encodeURIComponent(month)}`
        ),
        apiGet<{ reservations: ResRow[] }>(
          `/api/booking-v2/reservations?trainer_id=${encodeURIComponent(trainer.id)}&month=${encodeURIComponent(month)}`
        ),
        loadRates(),
        loadSettingsLists(),
        loadBreaks(),
      ]);
      setShifts(sj.shifts ?? []);
      setReservations(rj.reservations ?? []);
    } catch (e: unknown) {
      setErr(String(e instanceof Error ? e.message : "取得エラー"));
      setShifts((prev) => prev ?? []);
      setReservations((prev) => prev ?? []);
    }
  }, [trainer.id, month, loadRates, loadSettingsLists, loadBreaks]);

  const breaksByShiftId = useMemo(() => {
    const m = new Map<string, ShiftBreakRow[]>();
    for (const b of breaks) {
      const arr = m.get(b.shift_id) ?? [];
      arr.push(b);
      m.set(b.shift_id, arr);
    }
    for (const [k, arr] of m) arr.sort((a, b) => a.start_time.localeCompare(b.start_time));
    return m;
  }, [breaks]);

  useEffect(() => {
    void load();
  }, [load]);

  const monthLabel = useMemo(() => {
    const dt = DateTime.fromFormat(month, "yyyy-MM").setZone(TZ);
    if (!dt.isValid) return month;
    return dt.toFormat("yyyy年M月");
  }, [month]);

  const prevMonth = useCallback(() => {
    const dt = DateTime.fromFormat(month, "yyyy-MM").setZone(TZ);
    setMonth((dt.isValid ? dt.minus({ months: 1 }) : DateTime.now().setZone(TZ)).toFormat("yyyy-MM"));
  }, [month]);

  const nextMonth = useCallback(() => {
    const dt = DateTime.fromFormat(month, "yyyy-MM").setZone(TZ);
    setMonth((dt.isValid ? dt.plus({ months: 1 }) : DateTime.now().setZone(TZ)).toFormat("yyyy-MM"));
  }, [month]);

  const displayPayroll = useMemo(() => {
    return computeTrainerPayrollV2({
      shifts: shifts ?? [],
      hourlyRate: draftHourly,
      monthlyPass: draftPass,
      transportCosts,
      expenses,
      breaksByShiftId,
    });
  }, [shifts, draftHourly, draftPass, transportCosts, expenses, breaksByShiftId]);

  const totalMinutes = displayPayroll.totalMinutes;
  const hoursLabel =
    totalMinutes % 60 === 0
      ? `${Math.floor(totalMinutes / 60)}時間`
      : `${Math.floor(totalMinutes / 60)}時間${totalMinutes % 60}分`;

  async function addBreakBlock() {
    setBusy(true);
    setErr(null);
    try {
      await apiPost<{ shift: unknown }>("/api/shifts", {
        trainer_id: trainer.id,
        store_id: trainer.store_id,
        date: breakDate,
        start_at: breakStart,
        end_at: breakEnd,
        is_break: true,
      });
      await load();
    } catch (e: unknown) {
      setErr(String(e instanceof Error ? e.message : "休憩の登録に失敗しました"));
    } finally {
      setBusy(false);
    }
  }

  async function saveSettings() {
    setSaveBusy(true);
    setSaveErr(null);
    try {
      const { trainer: t } = await apiPatch<{ trainer: TrainerApiRow }>(`/api/trainers/${encodeURIComponent(trainer.id)}`, {
        hourly_rate: Math.max(0, Math.round(Number(draftHourly) || 0)),
        monthly_pass_cost: Math.max(0, Math.round(Number(draftPass) || 0)),
      });
      setRates(t);
      setDraftHourly(Number(t.hourly_rate ?? 0));
      setDraftPass(Number(t.monthly_pass_cost ?? 0));
    } catch (e: unknown) {
      setSaveErr(String(e instanceof Error ? e.message : "保存に失敗しました"));
    } finally {
      setSaveBusy(false);
    }
  }

  const storeById = useMemo(() => new Map(stores.map((s) => [s.id, s])), [stores]);

  const [dayOpen, setDayOpen] = useState(false);
  const [dayYmd, setDayYmd] = useState<string | null>(null);
  const [dayShiftId, setDayShiftId] = useState<string | null>(null);
  const [dayShiftBreaks, setDayShiftBreaks] = useState<ShiftBreakRow[]>([]);
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const dayPayroll = useMemo(() => {
    if (!dayYmd) return null;
    return computeTrainerDayPayroll({
      date: dayYmd,
      shifts: shifts ?? [],
      hourlyRate: draftHourly,
      transportCosts,
      expenses,
      breaksByShiftId,
    });
  }, [dayYmd, shifts, draftHourly, transportCosts, expenses, breaksByShiftId]);

  const dayShiftRanges = useMemo(() => {
    if (!dayYmd) return [];
    return (shifts ?? [])
      .filter((s) => s.shift_date === dayYmd && s.is_break !== true)
      .slice()
      .sort((a, b) => a.start_local.localeCompare(b.start_local))
      .map((s) => ({ id: s.id, start: s.start_local.slice(0, 5), end: s.end_local.slice(0, 5) }));
  }, [dayYmd, shifts]);

  const loadDayBreaks = useCallback(async (shiftId: string) => {
    try {
      const j = await apiGet<{ breaks: ShiftBreakRow[] }>(`/api/shifts/${encodeURIComponent(shiftId)}/breaks`);
      setDayShiftBreaks(j.breaks ?? []);
    } catch (e) {
      console.error("shift breaks fetch error", e);
      setDayShiftBreaks((prev) => prev ?? []);
    }
  }, []);

  async function addBreak() {
    if (!dayShiftId) return;
    if (!startTime || !endTime) return;
    try {
      await apiPost<{ break: ShiftBreakRow }>(`/api/shifts/${encodeURIComponent(dayShiftId)}/breaks`, {
        start_time: startTime,
        end_time: endTime,
      });
      setStartTime("");
      setEndTime("");
      await loadDayBreaks(dayShiftId);
      await loadBreaks();
    } catch (e) {
      console.error("add break error", e);
    }
  }

  async function deleteBreak(id: string) {
    if (!dayShiftId) return;
    try {
      await apiDelete<{ ok: boolean }>(`/api/shifts/breaks/${encodeURIComponent(id)}`, {});
      await loadDayBreaks(dayShiftId);
      await loadBreaks();
    } catch (e) {
      console.error("delete break error", e);
    }
  }

  const [newTcStoreId, setNewTcStoreId] = useState<string>("");
  const [newTcCost, setNewTcCost] = useState<number>(0);
  async function addTransportCost() {
    if (!newTcStoreId) return;
    setSaveErr(null);
    setSaveBusy(true);
    try {
      await apiPost<{ transport_cost: TransportCostRow }>(
        `/api/trainers/${encodeURIComponent(trainer.id)}/transport-costs`,
        { store_id: newTcStoreId, cost: Math.max(0, Math.round(Number(newTcCost) || 0)) }
      );
      await loadSettingsLists();
      setNewTcStoreId("");
      setNewTcCost(0);
    } catch (e: unknown) {
      setSaveErr(String(e instanceof Error ? e.message : "保存に失敗しました"));
    } finally {
      setSaveBusy(false);
    }
  }

  const [newExpenseTitle, setNewExpenseTitle] = useState("");
  const [newExpenseAmount, setNewExpenseAmount] = useState<number>(0);
  const [newExpenseType, setNewExpenseType] = useState<"monthly" | "daily">("monthly");
  async function addExpense() {
    if (!newExpenseTitle.trim()) return;
    setSaveErr(null);
    setSaveBusy(true);
    try {
      await apiPost<{ expense: ExpenseRow }>(`/api/trainers/${encodeURIComponent(trainer.id)}/expenses`, {
        title: newExpenseTitle.trim(),
        amount: Math.max(0, Math.round(Number(newExpenseAmount) || 0)),
        type: newExpenseType,
      });
      await loadSettingsLists();
      setNewExpenseTitle("");
      setNewExpenseAmount(0);
      setNewExpenseType("monthly");
    } catch (e: unknown) {
      setSaveErr(String(e instanceof Error ? e.message : "保存に失敗しました"));
    } finally {
      setSaveBusy(false);
    }
  }

  const displayName = rates?.display_name?.trim() || trainer.display_name;

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <div className="flex flex-wrap items-end gap-3">
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">{displayName}</h1>
          <span className="text-xs text-slate-500">{trainer.store_name}</span>
        </div>
        <p className="text-sm text-slate-500">
          ID: <span className="font-mono">{trainer.id}</span>
        </p>
      </header>

      <div className="flex flex-wrap items-center gap-3">
        <Link href="/admin/trainers/dashboard" className="text-sm text-slate-600 underline">
          ← 一覧
        </Link>
      </div>
      {err ? <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{err}</div> : null}

      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm space-y-4">
        <h2 className="text-sm font-bold text-slate-900">設定</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-xs text-slate-600">
            時給（円）
            <input
              type="number"
              min={0}
              step={1}
              value={draftHourly}
              onChange={(e) => setDraftHourly(Number(e.target.value))}
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            />
          </label>
          <label className="block text-xs text-slate-600">
            定期代（月額・円）
            <input
              type="number"
              min={0}
              step={1}
              value={draftPass}
              onChange={(e) => setDraftPass(Number(e.target.value))}
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            />
          </label>
        </div>
        {saveErr ? <div className="text-sm text-red-700">{saveErr}</div> : null}
        <button
          type="button"
          onClick={() => void saveSettings()}
          disabled={saveBusy}
          className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
        >
          {saveBusy ? "保存中…" : "設定を保存"}
        </button>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm space-y-3">
        <h2 className="text-sm font-bold text-slate-900">交通費（店舗別）</h2>
        {(transportCosts ?? []).length === 0 ? <div className="text-sm text-slate-600">未設定</div> : null}
        <div className="space-y-2">
          {(transportCosts ?? []).map((tc) => (
            <div key={tc.id} className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 px-3 py-2">
              <div className="text-sm font-semibold text-slate-900">
                {tc.store_id ? storeById.get(tc.store_id)?.name ?? tc.store_id : "（店舗未設定）"}
              </div>
              <input
                type="number"
                min={0}
                step={1}
                defaultValue={Number(tc.cost ?? 0)}
                className="w-28 rounded-lg border border-slate-200 px-2 py-1 text-sm"
                disabled={saveBusy}
                onBlur={async (e) => {
                  const v = Math.max(0, Math.round(Number((e.target as HTMLInputElement).value) || 0));
                  setSaveBusy(true);
                  setSaveErr(null);
                  try {
                    await apiPatch<{ transport_cost: TransportCostRow }>(
                      `/api/trainers/${encodeURIComponent(trainer.id)}/transport-costs`,
                      { id: tc.id, cost: v }
                    );
                    await loadSettingsLists();
                  } catch (err) {
                    setSaveErr(String(err instanceof Error ? err.message : "保存に失敗しました"));
                  } finally {
                    setSaveBusy(false);
                  }
                }}
              />
              <span className="text-xs text-slate-500">円/日</span>
              <button
                type="button"
                className="ml-auto rounded-lg border border-slate-200 bg-white px-3 py-1 text-xs font-bold text-slate-700 hover:bg-slate-50"
                disabled={saveBusy}
                onClick={async () => {
                  setSaveBusy(true);
                  setSaveErr(null);
                  try {
                    await apiDelete<{ ok: boolean }>(
                      `/api/trainers/${encodeURIComponent(trainer.id)}/transport-costs`,
                      { id: tc.id }
                    );
                    await loadSettingsLists();
                  } catch (err) {
                    setSaveErr(String(err instanceof Error ? err.message : "削除に失敗しました"));
                  } finally {
                    setSaveBusy(false);
                  }
                }}
              >
                削除
              </button>
            </div>
          ))}
        </div>
        <div className="grid gap-2 sm:grid-cols-3">
          <select
            value={newTcStoreId}
            onChange={(e) => setNewTcStoreId(e.target.value)}
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
            disabled={saveBusy}
          >
            <option value="">店舗を選択</option>
            {stores.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <input
            type="number"
            min={0}
            step={1}
            value={newTcCost}
            onChange={(e) => setNewTcCost(Number(e.target.value))}
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
            disabled={saveBusy}
          />
          <button
            type="button"
            onClick={() => void addTransportCost()}
            disabled={saveBusy || !newTcStoreId}
            className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
          >
            ＋追加
          </button>
        </div>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm space-y-3">
        <h2 className="text-sm font-bold text-slate-900">経費</h2>
        {(expenses ?? []).length === 0 ? <div className="text-sm text-slate-600">未設定</div> : null}
        <div className="space-y-2">
          {(expenses ?? []).map((ex) => (
            <div key={ex.id} className="grid gap-2 rounded-xl border border-slate-200 px-3 py-2 sm:grid-cols-4 sm:items-center">
              <input
                defaultValue={ex.title}
                className="rounded-lg border border-slate-200 px-2 py-1 text-sm"
                disabled={saveBusy}
                onBlur={async (e) => {
                  const v = (e.target as HTMLInputElement).value.trim();
                  if (!v) return;
                  setSaveBusy(true);
                  setSaveErr(null);
                  try {
                    await apiPatch<{ expense: ExpenseRow }>(
                      `/api/trainers/${encodeURIComponent(trainer.id)}/expenses`,
                      { id: ex.id, title: v }
                    );
                    await loadSettingsLists();
                  } catch (err) {
                    setSaveErr(String(err instanceof Error ? err.message : "保存に失敗しました"));
                  } finally {
                    setSaveBusy(false);
                  }
                }}
              />
              <input
                type="number"
                min={0}
                step={1}
                defaultValue={Number(ex.amount ?? 0)}
                className="rounded-lg border border-slate-200 px-2 py-1 text-sm"
                disabled={saveBusy}
                onBlur={async (e) => {
                  const v = Math.max(0, Math.round(Number((e.target as HTMLInputElement).value) || 0));
                  setSaveBusy(true);
                  setSaveErr(null);
                  try {
                    await apiPatch<{ expense: ExpenseRow }>(
                      `/api/trainers/${encodeURIComponent(trainer.id)}/expenses`,
                      { id: ex.id, amount: v }
                    );
                    await loadSettingsLists();
                  } catch (err) {
                    setSaveErr(String(err instanceof Error ? err.message : "保存に失敗しました"));
                  } finally {
                    setSaveBusy(false);
                  }
                }}
              />
              <select
                defaultValue={ex.type}
                className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-sm"
                disabled={saveBusy}
                onChange={async (e) => {
                  const v = e.target.value as "monthly" | "daily";
                  setSaveBusy(true);
                  setSaveErr(null);
                  try {
                    await apiPatch<{ expense: ExpenseRow }>(
                      `/api/trainers/${encodeURIComponent(trainer.id)}/expenses`,
                      { id: ex.id, type: v }
                    );
                    await loadSettingsLists();
                  } catch (err) {
                    setSaveErr(String(err instanceof Error ? err.message : "保存に失敗しました"));
                  } finally {
                    setSaveBusy(false);
                  }
                }}
              >
                <option value="monthly">月額</option>
                <option value="daily">日割り</option>
              </select>
              <button
                type="button"
                className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50"
                disabled={saveBusy}
                onClick={async () => {
                  setSaveBusy(true);
                  setSaveErr(null);
                  try {
                    await apiDelete<{ ok: boolean }>(`/api/trainers/${encodeURIComponent(trainer.id)}/expenses`, { id: ex.id });
                    await loadSettingsLists();
                  } catch (err) {
                    setSaveErr(String(err instanceof Error ? err.message : "削除に失敗しました"));
                  } finally {
                    setSaveBusy(false);
                  }
                }}
              >
                削除
              </button>
            </div>
          ))}
        </div>
        <div className="grid gap-2 sm:grid-cols-4">
          <input
            value={newExpenseTitle}
            onChange={(e) => setNewExpenseTitle(e.target.value)}
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
            placeholder="例：ウェア代"
            disabled={saveBusy}
          />
          <input
            type="number"
            min={0}
            step={1}
            value={newExpenseAmount}
            onChange={(e) => setNewExpenseAmount(Number(e.target.value))}
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
            placeholder="金額"
            disabled={saveBusy}
          />
          <select
            value={newExpenseType}
            onChange={(e) => setNewExpenseType(e.target.value as "monthly" | "daily")}
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
            disabled={saveBusy}
          >
            <option value="monthly">月額</option>
            <option value="daily">日割り</option>
          </select>
          <button
            type="button"
            onClick={() => void addExpense()}
            disabled={saveBusy || !newExpenseTitle.trim()}
            className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
          >
            経費追加
          </button>
        </div>
      </section>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm font-bold text-slate-900">表示月</div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="min-h-[40px] rounded-xl border border-slate-200 bg-white px-3 text-sm font-bold text-slate-900 hover:bg-slate-50 disabled:opacity-60"
            onClick={prevMonth}
            disabled={busy}
            aria-label="前月"
          >
            ←
          </button>
          <div className="min-w-[7.5rem] text-center text-sm font-bold text-slate-900">{monthLabel}</div>
          <button
            type="button"
            className="min-h-[40px] rounded-xl border border-slate-200 bg-white px-3 text-sm font-bold text-slate-900 hover:bg-slate-50 disabled:opacity-60"
            onClick={nextMonth}
            disabled={busy}
            aria-label="翌月"
          >
            →
          </button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="text-xs text-slate-500">勤務時間（合計）</div>
          <div className="mt-2 text-2xl font-bold text-slate-900">
            {Math.floor(totalMinutes / 60)}h {totalMinutes % 60}m
          </div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="text-xs text-slate-500">給与（{month}）</div>
          <div className="mt-2 text-2xl font-bold text-slate-900">¥{displayPayroll.totalYen.toLocaleString("ja-JP")}</div>
          <ul className="mt-3 space-y-1 text-xs text-slate-600">
            <li>
              ・勤務：¥{displayPayroll.workYen.toLocaleString("ja-JP")}（{hoursLabel} × ¥
              {displayPayroll.hourlyRate.toLocaleString("ja-JP")}）
            </li>
            <li>
              ・交通費：¥{displayPayroll.transportYen.toLocaleString("ja-JP")}
            </li>
            <li>・経費：¥{displayPayroll.expensesYen.toLocaleString("ja-JP")}</li>
            <li>・ボーナス：¥{displayPayroll.bonusYen.toLocaleString("ja-JP")}</li>
            <li>・定期：¥{displayPayroll.passYen.toLocaleString("ja-JP")}</li>
          </ul>
        </div>
      </div>

      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm space-y-3">
        <div className="text-sm font-bold text-slate-900">休憩ブロックを追加</div>
        <p className="text-xs text-slate-500">シフトとして登録し、予約枠（空き枠API）から除外されます。</p>
        <div className="grid gap-2 sm:grid-cols-4">
          <input
            type="date"
            value={breakDate}
            onChange={(e) => setBreakDate(e.target.value)}
            className="rounded-lg border border-slate-200 px-2 py-1 text-sm"
          />
          <input
            value={breakStart}
            onChange={(e) => setBreakStart(e.target.value)}
            className="rounded-lg border border-slate-200 px-2 py-1 text-sm"
            placeholder="12:00"
          />
          <input
            value={breakEnd}
            onChange={(e) => setBreakEnd(e.target.value)}
            className="rounded-lg border border-slate-200 px-2 py-1 text-sm"
            placeholder="13:00"
          />
          <button
            type="button"
            onClick={() => void addBreakBlock()}
            disabled={busy}
            className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-bold text-white disabled:opacity-50"
          >
            追加
          </button>
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="mb-2 text-sm font-bold text-slate-900">シフト一覧</div>
          {shifts === null ? <div className="text-sm text-slate-500">読み込み中…</div> : null}
          <ul className="space-y-2">
            {(shifts ?? []).map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() => {
                    setDayYmd(s.shift_date);
                    setDayShiftId(s.id);
                    void loadDayBreaks(s.id);
                    setDayOpen(true);
                  }}
                  className="w-full text-left rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 text-sm hover:bg-slate-100"
                >
                  <div>
                    <span className="font-medium">{s.shift_date}</span> {s.start_local.slice(0, 5)}〜{s.end_local.slice(0, 5)}
                  </div>
                  <div className="mt-0.5 text-xs text-slate-500">
                    {storeById.get(s.store_id)?.name ?? s.store_id} / 休憩: {calcTotalBreakMinutes(s.breaks)}分
                  </div>
                {s.is_break ? (
                  <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-900">休憩</span>
                ) : null}
                </button>
              </li>
            ))}
          </ul>
          {shifts && shifts.length === 0 ? <div className="text-sm text-slate-500">シフトなし</div> : null}
        </section>
        <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="mb-2 text-sm font-bold text-slate-900">予約一覧</div>
          {reservations === null ? <div className="text-sm text-slate-500">読み込み中…</div> : null}
          <ul className="space-y-2">
            {(reservations ?? []).map((r) => (
              <li key={r.id} className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 text-sm">
                {DateTime.fromISO(r.start_at).setZone(TZ).toFormat("M/d HH:mm")}〜
                {DateTime.fromISO(r.end_at).setZone(TZ).toFormat("HH:mm")}{" "}
                <span className="text-slate-500">{r.status}</span>
              </li>
            ))}
          </ul>
          {reservations && reservations.length === 0 ? <div className="text-sm text-slate-500">予約なし</div> : null}
        </section>
      </div>

      {dayOpen && dayYmd && dayPayroll ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center">
          <div className="w-full max-w-lg rounded-2xl bg-white p-4 shadow-xl space-y-3">
            <div className="flex items-center justify-between">
              <div className="text-sm font-bold text-slate-900">日別給与</div>
              <button
                type="button"
                className="min-h-[36px] rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold hover:bg-slate-50"
                onClick={() => setDayOpen(false)}
              >
                閉じる
              </button>
            </div>
            <div className="text-xs text-slate-500">{dayYmd}</div>
            <div className="rounded-xl border border-slate-200 bg-white p-3 space-y-1">
              <div className="text-xs font-semibold text-slate-700">勤務時間帯</div>
              {dayShiftRanges.length === 0 ? (
                <div className="text-sm text-slate-600">なし</div>
              ) : (
                <div className="space-y-1 text-sm text-slate-800">
                  {dayShiftRanges.map((r) => (
                    <div key={r.id} className="font-mono">
                      ・{r.start}〜{r.end}
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <div className="text-xs text-slate-600">勤務</div>
              <div className="text-lg font-bold text-slate-900">
                {Math.floor(dayPayroll.minutes / 60)}h {dayPayroll.minutes % 60}m
              </div>
            </div>
            <div className="space-y-1 text-sm text-slate-700">
              <div>・勤務：¥{dayPayroll.workYen.toLocaleString("ja-JP")}</div>
              <div>・交通費：¥{dayPayroll.transportYen.toLocaleString("ja-JP")}</div>
              <div>・経費：¥{dayPayroll.expenseDailyYen.toLocaleString("ja-JP")}</div>
              <div>・ボーナス：¥{dayPayroll.bonusYen.toLocaleString("ja-JP")}</div>
              <div>・休憩：-{Math.round(dayPayroll.breakMinutes)}分</div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-3 space-y-2">
              <div className="text-sm font-bold text-slate-900">休憩時間</div>
              <div className="space-y-1">
                {(dayShiftBreaks ?? []).length === 0 ? (
                  <div className="text-sm text-slate-600">未設定</div>
                ) : null}
                {(dayShiftBreaks ?? []).map((b) => (
                  <div key={b.id} className="flex items-center justify-between gap-2 text-sm">
                    <div className="font-mono text-slate-800">
                      {String(b.start_time).slice(0, 5)}〜{String(b.end_time).slice(0, 5)}
                    </div>
                    <button
                      type="button"
                      className="rounded-lg border border-slate-200 bg-white px-3 py-1 text-xs font-bold text-slate-700 hover:bg-slate-50"
                      onClick={() => void deleteBreak(b.id)}
                    >
                      削除
                    </button>
                  </div>
                ))}
              </div>
              <div className="flex flex-wrap items-end gap-2">
                <label className="block text-xs text-slate-600">
                  開始
                  <input
                    type="time"
                    value={startTime}
                    onChange={(e) => setStartTime(e.target.value)}
                    className="mt-1 rounded-lg border border-slate-200 px-2 py-1 text-sm"
                  />
                </label>
                <label className="block text-xs text-slate-600">
                  終了
                  <input
                    type="time"
                    value={endTime}
                    onChange={(e) => setEndTime(e.target.value)}
                    className="mt-1 rounded-lg border border-slate-200 px-2 py-1 text-sm"
                  />
                </label>
                <button
                  type="button"
                  className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
                  disabled={!dayShiftId || !startTime || !endTime}
                  onClick={() => void addBreak()}
                >
                  ＋追加
                </button>
              </div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-3">
              <div className="text-xs text-slate-600">合計</div>
              <div className="text-xl font-bold text-slate-900">¥{dayPayroll.totalYen.toLocaleString("ja-JP")}</div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
