"use client";

import { DateTime } from "luxon";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const TZ = "Asia/Tokyo";
const PAST_MONTHS = 5;

type ReservationRow = {
  id: string;
  store_id: string;
  store_name?: string;
  trainer_id: string | null;
  trainer_name?: string;
  start_at: string;
  end_at: string;
};

function monthTitle(dt: DateTime, now: DateTime) {
  if (dt.hasSame(now, "month")) return "予約履歴（当月）";
  if (dt.year === now.year) return `予約履歴（${dt.toFormat("M月")}）`;
  return `予約履歴（${dt.toFormat("yyyy年M月")}）`;
}

function ReservationMonthList({ rows }: { rows: ReservationRow[] | null }) {
  if (rows === null) return <div className="text-sm text-slate-600">読み込み中…</div>;
  if (rows.length === 0) return <div className="text-sm text-slate-600">予約がありません。</div>;
  return (
    <div className="grid gap-2">
      {rows.map((r) => (
        <div key={r.id} className="rounded-xl border border-slate-200 px-3 py-2 text-sm">
          <div className="font-semibold">
            {DateTime.fromISO(r.start_at).setZone(TZ).toFormat("M/d HH:mm")}〜
            {DateTime.fromISO(r.end_at).setZone(TZ).toFormat("HH:mm")}
          </div>
          <div className="text-xs text-slate-500">
            トレーナー: {r.trainer_name || (r.trainer_id ?? "-")} / 店舗: {r.store_name || r.store_id}
          </div>
        </div>
      ))}
    </div>
  );
}

export function MemberReservationHistory({
  memberId,
  currentMonth,
  currentMonthRows,
}: {
  memberId: string;
  currentMonth: string;
  currentMonthRows: ReservationRow[] | null;
}) {
  const now = useMemo(() => DateTime.now().setZone(TZ).startOf("month"), []);
  const anchor = useMemo(() => {
    const parsed = DateTime.fromISO(`${currentMonth}-01`, { zone: TZ });
    return parsed.isValid ? parsed.startOf("month") : now;
  }, [currentMonth, now]);
  const months = useMemo(
    () => Array.from({ length: PAST_MONTHS + 1 }, (_, i) => anchor.minus({ months: i })),
    [anchor]
  );
  const [page, setPage] = useState(0);
  const [byMonth, setByMonth] = useState<Record<string, ReservationRow[]>>({});
  const fetching = useRef<Set<string>>(new Set());
  const scrollerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setPage(0);
    const el = scrollerRef.current;
    if (el) el.scrollLeft = 0;
  }, [currentMonth]);

  useEffect(() => {
    if (!currentMonthRows) return;
    setByMonth((prev) => (prev[currentMonth] ? prev : { ...prev, [currentMonth]: currentMonthRows }));
  }, [currentMonth, currentMonthRows]);

  const loadMonth = useCallback(
    async (key: string) => {
      if (fetching.current.has(key)) return;
      fetching.current.add(key);
      try {
        const res = await fetch(
          `/api/booking-v2/reservations?member_id=${encodeURIComponent(memberId)}&month=${encodeURIComponent(key)}`,
          { cache: "no-store" }
        );
        const json = (await res.json().catch(() => ({}))) as { reservations?: ReservationRow[]; error?: string };
        if (!res.ok) throw new Error(json.error ?? "取得に失敗しました");
        setByMonth((prev) => ({ ...prev, [key]: json.reservations ?? [] }));
      } catch {
        setByMonth((prev) => ({ ...prev, [key]: prev[key] ?? [] }));
      } finally {
        fetching.current.delete(key);
      }
    },
    [memberId]
  );

  useEffect(() => {
    for (const m of months) {
      const key = m.toFormat("yyyy-MM");
      if (key === currentMonth && currentMonthRows) continue;
      if (byMonth[key] || fetching.current.has(key)) continue;
      void loadMonth(key);
    }
  }, [months, byMonth, currentMonth, currentMonthRows, loadMonth]);

  function rowsFor(dt: DateTime): ReservationRow[] | null {
    const key = dt.toFormat("yyyy-MM");
    if (byMonth[key]) return byMonth[key];
    if (key === currentMonth) return currentMonthRows;
    return null;
  }

  function goTo(i: number) {
    const el = scrollerRef.current;
    const next = Math.max(0, Math.min(months.length - 1, i));
    setPage(next);
    if (el) el.scrollTo({ left: next * el.clientWidth, behavior: "smooth" });
  }

  const visible = months[page] ?? anchor;

  return (
    <section className="min-w-0 space-y-2 overflow-hidden rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          aria-label="新しい月"
          disabled={page <= 0}
          onClick={() => goTo(page - 1)}
          className="rounded-lg px-2 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-100 disabled:opacity-30"
        >
          {page > 0 ? `‹ ${months[page - 1].toFormat("M月")}` : "‹"}
        </button>
        <div className="text-center">
          <div className="text-sm font-bold text-slate-900">{monthTitle(visible, now)}</div>
          {months.length > 1 ? <div className="text-[11px] font-semibold text-slate-400">左にスライドで先月</div> : null}
        </div>
        <button
          type="button"
          aria-label="先月の予約履歴"
          disabled={page >= months.length - 1}
          onClick={() => goTo(page + 1)}
          className="rounded-lg px-2 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-100 disabled:opacity-30"
        >
          {page < months.length - 1 ? `${months[page + 1].toFormat("M月")} ›` : "›"}
        </button>
      </div>
      <div
        ref={scrollerRef}
        onScroll={() => {
          const el = scrollerRef.current;
          if (!el || el.clientWidth <= 0) return;
          setPage(Math.max(0, Math.min(months.length - 1, Math.round(el.scrollLeft / el.clientWidth))));
        }}
        className="flex w-full min-w-0 snap-x snap-mandatory overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {months.map((m) => (
          <div key={m.toFormat("yyyy-MM")} className="min-w-0 shrink-0 snap-start overflow-hidden" style={{ flex: "0 0 100%" }}>
            <ReservationMonthList rows={rowsFor(m)} />
          </div>
        ))}
      </div>
    </section>
  );
}
