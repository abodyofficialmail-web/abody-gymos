"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type Store = { id: string; name: string };
type Trainer = { id: string; display_name: string; store_id: string };
type ApiTrainer = { id: string; name: string; store_id: string; store_name: string };

type ShiftRow = {
  id: string;
  trainer_id: string;
  store_id: string;
  shift_date: string;
  start_local: string;
  end_local: string;
  break_minutes?: number | null;
  status: string;
  is_break?: boolean | null;
};
type TrainerEventRow = {
  id: string;
  trainer_id: string;
  store_id: string;
  event_date: string;
  start_local: string;
  end_local: string;
  title: string;
  notes?: string | null;
  block_booking: boolean;
};

async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(path, { cache: "no-store" });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = (json as any)?.error?.fieldErrors
      ? JSON.stringify((json as any).error.fieldErrors)
      : (json as any)?.error ?? "取得に失敗しました";
    throw new Error(msg);
  }
  return json as T;
}

async function apiJson<T>(path: string, method: "POST" | "PATCH", body: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = (json as any)?.error?.fieldErrors
      ? JSON.stringify((json as any).error.fieldErrors)
      : (json as any)?.error ?? "送信に失敗しました";
    throw new Error(msg);
  }
  return json as T;
}

async function apiDelete<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = (json as any)?.error?.fieldErrors
      ? JSON.stringify((json as any).error.fieldErrors)
      : (json as any)?.error ?? "削除に失敗しました";
    throw new Error(msg);
  }
  return json as T;
}

async function apiAny<T>(path: string, method: "POST" | "PATCH" | "DELETE", body: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = (json as any)?.error?.fieldErrors
      ? JSON.stringify((json as any).error.fieldErrors)
      : (json as any)?.error ?? "送信に失敗しました";
    throw new Error(msg);
  }
  return json as T;
}

function formatJstDateLabel(ymd: string) {
  const [y, m, d] = ymd.split("-").map((x) => Number(x));
  const dt = new Date(Date.UTC(y, m - 1, d));
  const dow = new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", weekday: "long" }).format(dt);
  return `${m}月${d}日 ${dow}`;
}

function trainerColor(name: string): string {
  const map: Record<string, string> = {
    ともき: "#16A34A",
    ひろむ: "#111827",
    だいき: "#F59E0B",
    せいや: "#2563EB",
    しょうどう: "#DC2626",
    ゆうと: "#7C3AED",
    りょう: "#F97316",
  };
  return map[name] ?? "#64748B";
}

function parseMinutes(hhmmOrHhmmss: string): number {
  const s = hhmmOrHhmmss.trim();
  const hh = Number(s.slice(0, 2));
  const mm = Number(s.slice(3, 5));
  return hh * 60 + mm;
}

function toTimeInputValue(hhmmOrHhmmss: string) {
  const s = hhmmOrHhmmss.trim();
  if (/^\d{2}:\d{2}:\d{2}$/u.test(s)) return s.slice(0, 5);
  if (/^\d{1,2}:\d{2}$/u.test(s)) {
    const [h, m] = s.split(":");
    return `${String(Number(h)).padStart(2, "0")}:${m}`;
  }
  return "00:00";
}

function addDaysYmd(ymd: string, deltaDays: number) {
  const [y, m, d] = ymd.split("-").map((x) => Number(x));
  const base = new Date(Date.UTC(y, m - 1, d));
  base.setUTCDate(base.getUTCDate() + deltaDays);
  const yy = base.getUTCFullYear();
  const mm = String(base.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(base.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

export function ShiftDayClient({ date, stores, trainers }: { date: string; stores: Store[]; trainers: Trainer[] }) {
  const router = useRouter();
  const [rows, setRows] = useState<ShiftRow[] | null>(null);
  const [events, setEvents] = useState<TrainerEventRow[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const [createOpen, setCreateOpen] = useState(false);
  const [storeId, setStoreId] = useState(stores[0]?.id ?? "");
  const [trainerId, setTrainerId] = useState("");
  const [startAt, setStartAt] = useState("09:00");
  const [endAt, setEndAt] = useState("09:30");
  const [breakMinutes, setBreakMinutes] = useState(0);

  const [trainersLive, setTrainersLive] = useState<Trainer[] | null>(null);

  const [editOpen, setEditOpen] = useState(false);
  const [editShiftId, setEditShiftId] = useState<string | null>(null);
  const [editDate, setEditDate] = useState(date);
  const [editStart, setEditStart] = useState("09:00");
  const [editEnd, setEditEnd] = useState("09:30");
  const [editErr, setEditErr] = useState<string | null>(null);

  const [eventOpen, setEventOpen] = useState(false);
  const [eventEditId, setEventEditId] = useState<string | null>(null);
  const [eventTitle, setEventTitle] = useState("MTG");
  const [eventNotes, setEventNotes] = useState("");
  const [eventBlock, setEventBlock] = useState(true);
  const [eventTrainerId, setEventTrainerId] = useState("");
  const [eventStoreId, setEventStoreId] = useState(stores[0]?.id ?? "");
  const [eventStart, setEventStart] = useState("12:00");
  const [eventEnd, setEventEnd] = useState("13:00");
  const [eventErr, setEventErr] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/trainers", { cache: "no-store" })
      .then((res) => res.json())
      .then((data: { trainers?: ApiTrainer[] }) => {
        const list = (data.trainers ?? []).map(
          (t): Trainer => ({ id: t.id, display_name: t.name, store_id: t.store_id })
        );
        list.sort((a, b) => a.display_name.localeCompare(b.display_name, "ja"));
        setTrainersLive(list);
      })
      .catch(() => setTrainersLive(null));
  }, []);

  const effectiveTrainers = useMemo(() => {
    const list = (trainersLive ?? trainers).slice();
    list.sort((a, b) => a.display_name.localeCompare(b.display_name, "ja"));
    return list;
  }, [trainersLive, trainers]);

  useEffect(() => {
    if (!trainerId || !effectiveTrainers.some((t) => t.id === trainerId)) {
      setTrainerId(effectiveTrainers[0]?.id ?? "");
    }
  }, [trainerId, effectiveTrainers]);

  const trainerById = useMemo(() => {
    const m = new Map<string, Trainer>();
    for (const t of trainers) m.set(t.id, t);
    for (const t of effectiveTrainers) m.set(t.id, t);
    return m;
  }, [trainers, effectiveTrainers]);

  async function refresh() {
    setErr(null);
    setOk(null);
    try {
      const qs = new URLSearchParams({ date });
      const j = await apiGet<{ shifts: ShiftRow[] }>(`/api/shifts?${qs.toString()}`);
      setRows(j.shifts ?? []);
      const e = await apiGet<{ events: TrainerEventRow[] }>(`/api/trainer-events?${qs.toString()}`);
      setEvents(e.events ?? []);
      console.log("[admin/trainers/day] shifts", j.shifts ?? []);
    } catch (e: any) {
      setErr(String(e?.message ?? "取得に失敗しました"));
      setRows((prev) => prev ?? []);
      setEvents((prev) => prev ?? []);
    }
  }

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date]);

  const storeById = useMemo(() => new Map(stores.map((s) => [s.id, s])), [stores]);

  const sorted = useMemo(() => {
    const list = (rows ?? []).slice();
    list.sort((a, b) => a.start_local.localeCompare(b.start_local));
    return list;
  }, [rows]);

  const sortedEvents = useMemo(() => {
    const list = (events ?? []).slice();
    list.sort((a, b) => a.start_local.localeCompare(b.start_local));
    return list;
  }, [events]);

  function openEdit(s: ShiftRow) {
    setEditErr(null);
    setEditShiftId(s.id);
    setEditDate((s.shift_date ?? date).slice(0, 10));
    setEditStart(toTimeInputValue(s.start_local));
    setEditEnd(toTimeInputValue(s.end_local));
    setEditOpen(true);
  }

  async function onSaveEdit() {
    if (!editShiftId) return;
    const sm = parseMinutes(editStart);
    const em = parseMinutes(editEnd);
    if (!(em > sm)) {
      setEditErr("終了時間は開始時間より後にしてください。");
      return;
    }
    setBusy(true);
    setErr(null);
    setOk(null);
    setEditErr(null);
    try {
      await apiJson<{ shift: ShiftRow }>("/api/shifts", "PATCH", {
        id: editShiftId,
        date: editDate,
        start_at: editStart,
        end_at: editEnd,
      });
      setEditOpen(false);
      setEditShiftId(null);
      setOk("更新しました。");
      await refresh();
    } catch (e: any) {
      setErr(String(e?.message ?? "更新に失敗しました"));
    } finally {
      setBusy(false);
    }
  }

  async function onDeleteEdit() {
    if (!editShiftId) return;
    const okConfirm = window.confirm("このシフトを削除しますか？");
    if (!okConfirm) return;
    setBusy(true);
    setErr(null);
    setOk(null);
    setEditErr(null);
    try {
      await apiDelete<{ ok: true }>("/api/shifts", { id: editShiftId });
      setEditOpen(false);
      setEditShiftId(null);
      setOk("削除しました。");
      await refresh();
    } catch (e: any) {
      setErr(String(e?.message ?? "削除に失敗しました"));
    } finally {
      setBusy(false);
    }
  }

  function openCreateEvent() {
    setEventErr(null);
    setEventEditId(null);
    setEventTitle("MTG");
    setEventNotes("");
    setEventBlock(true);
    setEventTrainerId(effectiveTrainers[0]?.id ?? "");
    setEventStoreId("all");
    setEventStart("12:00");
    setEventEnd("13:00");
    setEventOpen(true);
  }

  function openEditEvent(ev: TrainerEventRow) {
    setEventErr(null);
    setEventEditId(ev.id);
    setEventTitle(ev.title ?? "");
    setEventNotes(String(ev.notes ?? ""));
    setEventBlock(Boolean(ev.block_booking));
    setEventTrainerId(ev.trainer_id);
    setEventStoreId(ev.store_id);
    setEventStart(toTimeInputValue(ev.start_local));
    setEventEnd(toTimeInputValue(ev.end_local));
    setEventOpen(true);
  }

  async function onSaveEvent() {
    const sm = parseMinutes(eventStart);
    const em = parseMinutes(eventEnd);
    if (!(em > sm)) {
      setEventErr("終了時間は開始時間より後にしてください。");
      return;
    }
    if (!eventTitle.trim()) {
      setEventErr("タイトルを入力してください。");
      return;
    }
    if (!eventTrainerId || !eventStoreId) {
      setEventErr("店舗・トレーナーを選択してください。");
      return;
    }
    setBusy(true);
    setErr(null);
    setOk(null);
    setEventErr(null);
    try {
      if (eventEditId) {
        await apiAny<{ event: TrainerEventRow }>("/api/trainer-events", "PATCH", {
          id: eventEditId,
          date,
          start_at: eventStart,
          end_at: eventEnd,
          title: eventTitle,
          notes: eventNotes || null,
          block_booking: eventBlock,
        });
      } else {
        if (eventStoreId === "all") {
          await Promise.all(
            stores.map((s) =>
              apiAny<{ event: TrainerEventRow }>("/api/trainer-events", "POST", {
                store_id: s.id,
                trainer_id: eventTrainerId,
                date,
                start_at: eventStart,
                end_at: eventEnd,
                title: eventTitle,
                notes: eventNotes || null,
                block_booking: eventBlock,
              })
            )
          );
        } else {
          await apiAny<{ event: TrainerEventRow }>("/api/trainer-events", "POST", {
            store_id: eventStoreId,
            trainer_id: eventTrainerId,
            date,
            start_at: eventStart,
            end_at: eventEnd,
            title: eventTitle,
            notes: eventNotes || null,
            block_booking: eventBlock,
          });
        }
      }
      setEventOpen(false);
      setOk(eventEditId ? "予定を更新しました。" : "予定を追加しました。");
      await refresh();
    } catch (e: any) {
      setErr(String(e?.message ?? "保存に失敗しました"));
    } finally {
      setBusy(false);
    }
  }

  async function onDeleteEvent() {
    if (!eventEditId) return;
    const okConfirm = window.confirm("この予定を削除しますか？");
    if (!okConfirm) return;
    setBusy(true);
    setErr(null);
    setOk(null);
    setEventErr(null);
    try {
      await apiAny<{ ok: true }>("/api/trainer-events", "DELETE", { id: eventEditId });
      setEventOpen(false);
      setOk("予定を削除しました。");
      await refresh();
    } catch (e: any) {
      setErr(String(e?.message ?? "削除に失敗しました"));
    } finally {
      setBusy(false);
    }
  }

  async function onCreate() {
    if (!storeId || !trainerId) return;
    setBusy(true);
    setErr(null);
    setOk(null);
    try {
      await apiJson<{ shift: ShiftRow }>("/api/shifts", "POST", {
        trainer_id: trainerId,
        store_id: storeId,
        date,
        start_at: startAt,
        end_at: endAt,
        break_minutes: Math.max(0, Math.round(Number(breakMinutes) || 0)),
      });
      setCreateOpen(false);
      setOk("追加しました。");
      await refresh();
    } catch (e: any) {
      setErr(String(e?.message ?? "追加に失敗しました"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs text-slate-500">選択日</div>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="min-h-[44px] min-w-[44px] rounded-xl border border-slate-200 bg-white px-3 text-lg font-bold text-slate-900 hover:bg-slate-50 disabled:opacity-60"
              disabled={busy}
              onClick={() => router.push(`/admin/trainers/${addDaysYmd(date, -1)}`)}
              aria-label="前日"
            >
              ←
            </button>
            <h1 className="min-w-0 truncate text-xl font-bold text-slate-900">{formatJstDateLabel(date)}</h1>
            <button
              type="button"
              className="min-h-[44px] min-w-[44px] rounded-xl border border-slate-200 bg-white px-3 text-lg font-bold text-slate-900 hover:bg-slate-50 disabled:opacity-60"
              disabled={busy}
              onClick={() => router.push(`/admin/trainers/${addDaysYmd(date, 1)}`)}
              aria-label="翌日"
            >
              →
            </button>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setCreateOpen(true)}
          className="min-h-[44px] rounded-xl bg-slate-900 px-4 text-sm font-bold text-white disabled:opacity-60"
          disabled={busy}
        >
          ＋
        </button>
      </div>

      {err ? <div className="rounded-xl border border-slate-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{err}</div> : null}
      {ok ? <div className="rounded-xl border border-slate-200 bg-teal-50 px-4 py-3 text-sm font-semibold text-teal-800">{ok}</div> : null}

      <section className="space-y-3">
        {rows === null ? <div className="text-sm text-slate-600">読み込み中…</div> : null}
        {rows !== null && sorted.length === 0 ? <div className="text-sm text-slate-600">この日のシフトはありません。</div> : null}

        {sorted.map((s) => {
          const t = trainerById.get(s.trainer_id);
          const st = storeById.get(s.store_id);
          const color = trainerColor(t?.display_name ?? "");
          const start = s.start_local.slice(0, 5);
          const end = s.end_local.slice(0, 5);
          return (
            <div key={s.id} className="relative rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
              <div className="absolute left-0 top-0 bottom-0 w-1" style={{ background: color }} />
              <div className="p-4 pl-5">
                <div className="flex items-start justify-between gap-2">
                  <div className="space-y-1">
                    <div className="text-base font-bold text-slate-900">
                      {start}〜{end}
                    </div>
                    <div className="text-sm text-slate-700">{t?.display_name ?? s.trainer_id}</div>
                    <div className="text-xs text-slate-500">{st?.name ?? s.store_id}</div>
                    {!s.is_break ? (
                      <div className="flex items-center gap-2 text-xs text-slate-600">
                        <span>休憩</span>
                        <input
                          type="number"
                          min={0}
                          step={1}
                          defaultValue={Number(s.break_minutes ?? 0)}
                          className="w-20 rounded border border-slate-200 px-2 py-1 text-xs"
                          disabled={busy}
                          onBlur={async (ev) => {
                            const v = Math.max(
                              0,
                              Math.round(Number((ev.target as HTMLInputElement).value) || 0)
                            );
                            setBusy(true);
                            setErr(null);
                            setOk(null);
                            try {
                              await apiJson<{ shift: ShiftRow }>("/api/shifts", "PATCH", {
                                id: s.id,
                                break_minutes: v,
                              });
                              setOk("更新しました。");
                              await refresh();
                            } catch (e: any) {
                              setErr(String(e?.message ?? "更新に失敗しました"));
                            } finally {
                              setBusy(false);
                            }
                          }}
                        />
                        <span>分</span>
                      </div>
                    ) : null}
                    {s.is_break ? <div className="text-xs font-semibold text-amber-800">休憩ブロック</div> : null}
                  </div>
                  <button
                    type="button"
                    className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                    onClick={() => openEdit(s)}
                    disabled={busy}
                  >
                    編集
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm space-y-3">
        <div className="flex items-center justify-between">
          <div className="text-sm font-bold text-slate-900">予定</div>
          <button
            type="button"
            onClick={openCreateEvent}
            className="min-h-[36px] rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold hover:bg-slate-50 disabled:opacity-60"
            disabled={busy}
          >
            予定追加
          </button>
        </div>
        {events === null ? <div className="text-sm text-slate-600">読み込み中…</div> : null}
        {events !== null && sortedEvents.length === 0 ? <div className="text-sm text-slate-600">予定なし</div> : null}
        <div className="grid gap-2">
          {(sortedEvents ?? []).map((ev) => {
            const t = trainerById.get(ev.trainer_id);
            const st = storeById.get(ev.store_id);
            const start = String(ev.start_local).slice(0, 5);
            const end = String(ev.end_local).slice(0, 5);
            return (
              <button
                key={ev.id}
                type="button"
                onClick={() => openEditEvent(ev)}
                className="text-left rounded-xl border border-slate-200 px-3 py-2 text-sm hover:bg-slate-50"
                disabled={busy}
              >
                <div className="font-semibold text-slate-900">
                  {start}〜{end} / {ev.title}
                </div>
                <div className="text-xs text-slate-500">
                  {t?.display_name ?? ev.trainer_id} / {st?.name ?? ev.store_id} / {ev.block_booking ? "予約を潰す" : "予約は潰さない"}
                </div>
              </button>
            );
          })}
        </div>
      </section>

      {createOpen ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center">
          <div className="w-full max-w-lg rounded-2xl bg-white p-4 shadow-xl space-y-3">
            <div className="flex items-center justify-between">
              <div className="text-sm font-bold text-slate-900">シフト追加</div>
              <button
                type="button"
                className="min-h-[36px] rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold hover:bg-slate-50"
                onClick={() => setCreateOpen(false)}
              >
                閉じる
              </button>
            </div>

            <div className="text-xs text-slate-500">{formatJstDateLabel(date)}</div>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-sm font-medium text-slate-700">
                店舗
                <select
                  value={storeId}
                  onChange={(e) => setStoreId(e.target.value)}
                  className="mt-1 w-full min-h-[44px] rounded-xl border border-slate-200 bg-white px-3 text-sm"
                  disabled={busy}
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
                  className="mt-1 w-full min-h-[44px] rounded-xl border border-slate-200 bg-white px-3 text-sm"
                  disabled={busy || effectiveTrainers.length === 0}
                >
                  {effectiveTrainers.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.display_name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-sm font-medium text-slate-700">
                開始
                <input
                  value={startAt}
                  onChange={(e) => setStartAt(e.target.value)}
                  className="mt-1 w-full min-h-[44px] rounded-xl border border-slate-200 bg-white px-3 text-sm"
                  placeholder="09:00"
                  disabled={busy}
                />
              </label>
              <label className="block text-sm font-medium text-slate-700">
                終了
                <input
                  value={endAt}
                  onChange={(e) => setEndAt(e.target.value)}
                  className="mt-1 w-full min-h-[44px] rounded-xl border border-slate-200 bg-white px-3 text-sm"
                  placeholder="09:30"
                  disabled={busy}
                />
              </label>
              <label className="block text-sm font-medium text-slate-700">
                休憩（分）
                <input
                  type="number"
                  min={0}
                  step={1}
                  value={breakMinutes}
                  onChange={(e) => setBreakMinutes(Number(e.target.value))}
                  className="mt-1 w-full min-h-[44px] rounded-xl border border-slate-200 bg-white px-3 text-sm"
                  disabled={busy}
                />
                <div className="mt-1 text-xs text-slate-500">※給与からは差し引きません</div>
              </label>
            </div>

            <button
              type="button"
              onClick={() => void onCreate()}
              className="min-h-[44px] w-full rounded-xl bg-slate-900 px-4 text-sm font-bold text-white disabled:opacity-60"
              disabled={busy || !storeId || !trainerId}
            >
              保存
            </button>
          </div>
        </div>
      ) : null}

      {editOpen ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center">
          <div className="w-full max-w-lg rounded-2xl bg-white p-4 shadow-xl space-y-3">
            <div className="flex items-center justify-between">
              <div className="text-sm font-bold text-slate-900">シフト編集</div>
              <button
                type="button"
                className="min-h-[36px] rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold hover:bg-slate-50"
                onClick={() => {
                  setEditOpen(false);
                  setEditShiftId(null);
                  setEditErr(null);
                }}
              >
                閉じる
              </button>
            </div>

            {editErr ? <div className="rounded-xl border border-slate-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700">{editErr}</div> : null}

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-sm font-medium text-slate-700 sm:col-span-2">
                日付
                <input
                  type="date"
                  value={editDate}
                  onChange={(e) => setEditDate(e.target.value)}
                  className="mt-1 w-full min-h-[44px] rounded-xl border border-slate-200 bg-white px-3 text-sm"
                  disabled={busy}
                />
              </label>
              <label className="block text-sm font-medium text-slate-700">
                開始
                <input
                  type="time"
                  value={editStart}
                  onChange={(e) => setEditStart(e.target.value)}
                  className="mt-1 w-full min-h-[44px] rounded-xl border border-slate-200 bg-white px-3 text-sm"
                  disabled={busy}
                />
              </label>
              <label className="block text-sm font-medium text-slate-700">
                終了
                <input
                  type="time"
                  value={editEnd}
                  onChange={(e) => setEditEnd(e.target.value)}
                  className="mt-1 w-full min-h-[44px] rounded-xl border border-slate-200 bg-white px-3 text-sm"
                  disabled={busy}
                />
              </label>
            </div>

            <button
              type="button"
              onClick={() => void onSaveEdit()}
              className="min-h-[44px] w-full rounded-xl bg-slate-900 px-4 text-sm font-bold text-white disabled:opacity-60"
              disabled={busy || !editShiftId}
            >
              保存
            </button>

            <button
              type="button"
              onClick={() => void onDeleteEdit()}
              className="min-h-[44px] w-full rounded-xl border border-red-200 bg-white px-4 text-sm font-bold text-red-700 hover:bg-red-50 disabled:opacity-60"
              disabled={busy || !editShiftId}
            >
              削除
            </button>
          </div>
        </div>
      ) : null}

      {eventOpen ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center">
          <div className="w-full max-w-lg rounded-2xl bg-white p-4 shadow-xl space-y-3">
            <div className="flex items-center justify-between">
              <div className="text-sm font-bold text-slate-900">{eventEditId ? "予定編集" : "予定追加"}</div>
              <button
                type="button"
                className="min-h-[36px] rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold hover:bg-slate-50"
                onClick={() => {
                  setEventOpen(false);
                  setEventEditId(null);
                  setEventErr(null);
                }}
              >
                閉じる
              </button>
            </div>

            {eventErr ? (
              <div className="rounded-xl border border-slate-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700">
                {eventErr}
              </div>
            ) : null}

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-sm font-medium text-slate-700 sm:col-span-2">
                タイトル
                <input
                  value={eventTitle}
                  onChange={(e) => setEventTitle(e.target.value)}
                  className="mt-1 w-full min-h-[44px] rounded-xl border border-slate-200 bg-white px-3 text-sm"
                  disabled={busy}
                />
              </label>
              <label className="block text-sm font-medium text-slate-700">
                店舗
                <select
                  value={eventStoreId}
                  onChange={(e) => setEventStoreId(e.target.value)}
                  className="mt-1 w-full min-h-[44px] rounded-xl border border-slate-200 bg-white px-3 text-sm"
                  disabled={busy}
                >
                  {!eventEditId ? <option value="all">全店舗</option> : null}
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
                  value={eventTrainerId}
                  onChange={(e) => setEventTrainerId(e.target.value)}
                  className="mt-1 w-full min-h-[44px] rounded-xl border border-slate-200 bg-white px-3 text-sm"
                  disabled={busy || effectiveTrainers.length === 0}
                >
                  {effectiveTrainers.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.display_name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-sm font-medium text-slate-700">
                開始
                <input
                  type="time"
                  value={eventStart}
                  onChange={(e) => setEventStart(e.target.value)}
                  className="mt-1 w-full min-h-[44px] rounded-xl border border-slate-200 bg-white px-3 text-sm"
                  disabled={busy}
                />
              </label>
              <label className="block text-sm font-medium text-slate-700">
                終了
                <input
                  type="time"
                  value={eventEnd}
                  onChange={(e) => setEventEnd(e.target.value)}
                  className="mt-1 w-full min-h-[44px] rounded-xl border border-slate-200 bg-white px-3 text-sm"
                  disabled={busy}
                />
              </label>
              <label className="block text-sm font-medium text-slate-700 sm:col-span-2">
                メモ（任意）
                <input
                  value={eventNotes}
                  onChange={(e) => setEventNotes(e.target.value)}
                  className="mt-1 w-full min-h-[44px] rounded-xl border border-slate-200 bg-white px-3 text-sm"
                  disabled={busy}
                />
              </label>
              <label className="flex items-center gap-2 text-sm font-semibold text-slate-700 sm:col-span-2">
                <input
                  type="checkbox"
                  checked={eventBlock}
                  onChange={(e) => setEventBlock(e.target.checked)}
                  disabled={busy}
                />
                予約カレンダーの枠を潰す
              </label>
            </div>

            <button
              type="button"
              onClick={() => void onSaveEvent()}
              className="min-h-[44px] w-full rounded-xl bg-slate-900 px-4 text-sm font-bold text-white disabled:opacity-60"
              disabled={busy}
            >
              保存
            </button>

            {eventEditId ? (
              <button
                type="button"
                onClick={() => void onDeleteEvent()}
                className="min-h-[44px] w-full rounded-xl border border-red-200 bg-white px-4 text-sm font-bold text-red-700 hover:bg-red-50 disabled:opacity-60"
                disabled={busy}
              >
                削除
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
