"use client";

import { useCallback, useEffect, useState } from "react";

type Slot = {
  start_at: string;
  end_at: string;
  date_label: string;
  time_label: string;
};

type Payload = {
  invite: {
    s: string;
    sig: string;
    store_name: string;
    trainer_name: string | null;
    slot_minutes: number;
    date_label: string | null;
  };
  slots: Slot[];
};

function slotFromQuery(startAt: string, endAt: string): Slot {
  const start = new Date(startAt);
  const end = new Date(endAt);
  const dateLabel = Number.isNaN(start.getTime())
    ? startAt
    : start.toLocaleDateString("ja-JP", { month: "long", day: "numeric", weekday: "short" });
  const time = (d: Date) =>
    Number.isNaN(d.getTime()) ? "" : d.toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit", hour12: false });
  return {
    start_at: startAt,
    end_at: endAt,
    date_label: dateLabel,
    time_label: `${time(start)}〜${time(end)}`.replace(/^〜|〜$/g, "") || startAt,
  };
}

export default function InviteBookPage() {
  const [payload, setPayload] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [pending, setPending] = useState<Slot | null>(null);
  const [booking, setBooking] = useState(false);
  const [bookingErr, setBookingErr] = useState<string | null>(null);
  const [bookedLabel, setBookedLabel] = useState<string | null>(null);
  const [slots, setSlots] = useState<Slot[]>([]);

  const load = useCallback(async () => {
    const params = new URLSearchParams(window.location.search);
    const s = params.get("s");
    const sig = params.get("sig");
    if (!s || !sig) {
      setErr("リンクが不正です。LINEのメッセージから再度お開きください。");
      setLoading(false);
      return;
    }
    const res = await fetch(`/api/invite-book?s=${encodeURIComponent(s)}&sig=${encodeURIComponent(sig)}`, { cache: "no-store" });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error((json as { error?: string }).error ?? "読み込みに失敗しました");
    const data = json as Payload;
    setPayload(data);
    setSlots(data.slots);
    const startAt = params.get("start_at");
    const endAt = params.get("end_at");
    if (startAt && endAt) {
      const found = data.slots.find((s) => s.start_at === startAt && s.end_at === endAt);
      setPending(found ?? slotFromQuery(startAt, endAt));
    }
  }, []);

  useEffect(() => {
    load()
      .catch((e) => setErr(e instanceof Error ? e.message : "読み込みに失敗しました"))
      .finally(() => setLoading(false));
  }, [load]);

  const confirm = async () => {
    if (!pending || !payload) return;
    setBooking(true);
    setBookingErr(null);
    try {
      const res = await fetch("/api/invite-book", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          s: payload.invite.s,
          sig: payload.invite.sig,
          start_at: pending.start_at,
          end_at: pending.end_at,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((json as { error?: string }).error ?? "予約に失敗しました");
      setBookedLabel(`${pending.date_label} ${pending.time_label}`);
      setPending(null);
      if (Array.isArray((json as { slots?: Slot[] }).slots)) setSlots((json as { slots: Slot[] }).slots);
    } catch (e: unknown) {
      setBookingErr(e instanceof Error ? e.message : "予約に失敗しました");
    } finally {
      setBooking(false);
    }
  };

  if (loading) {
    return (
      <main className="mx-auto min-h-screen max-w-lg bg-slate-50 px-4 py-10">
        <p className="text-center text-slate-600">空き枠を探しています…</p>
      </main>
    );
  }

  if (err || !payload) {
    return (
      <main className="mx-auto min-h-screen max-w-lg bg-slate-50 px-4 py-10">
        <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-red-800">{err ?? "案内を表示できません"}</div>
      </main>
    );
  }

  return (
    <main className="mx-auto min-h-screen max-w-lg bg-slate-50 px-4 py-8 pb-16">
      <header className="mb-6">
        <p className="text-xs font-semibold tracking-wide text-emerald-700">ご案内枠のみ</p>
        <h1 className="mt-1 text-xl font-bold text-slate-900">{payload.invite.store_name}の空き</h1>
        <p className="mt-2 text-sm leading-relaxed text-slate-600">
          {payload.invite.date_label ? `${payload.invite.date_label} · ` : ""}
          {payload.invite.slot_minutes}分
        </p>
        <p className="mt-1 text-xs text-slate-500">予約サイトには出ていない、ご案内した方だけの枠です。先着順です。</p>
      </header>

      {bookedLabel ? (
        <p className="mb-4 rounded-xl border border-emerald-200 bg-white px-3 py-2 text-sm font-medium text-emerald-900">
          {bookedLabel} を確定しました
        </p>
      ) : null}

      {bookingErr ? (
        <p className="mb-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{bookingErr}</p>
      ) : null}

      {pending ? (
        <section className="rounded-2xl border border-slate-200 bg-white p-5">
          <p className="text-sm font-bold text-slate-900">この時間で確定しますか？</p>
          <p className="mt-1 text-sm text-slate-700">
            {payload.invite.store_name} {pending.date_label} {pending.time_label}
          </p>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <button
              type="button"
              disabled={booking}
              onClick={() => {
                setPending(null);
                setBookingErr(null);
              }}
              className="rounded-xl border border-slate-200 bg-white py-2.5 text-sm font-semibold text-slate-700"
            >
              もどる
            </button>
            <button
              type="button"
              disabled={booking}
              onClick={() => void confirm()}
              className="rounded-xl bg-emerald-600 py-2.5 text-sm font-bold text-white disabled:opacity-60"
            >
              {booking ? "確定中…" : "予約を確定する"}
            </button>
          </div>
        </section>
      ) : slots.length > 0 ? (
        <div className="space-y-2">
          {slots.map((slot) => (
            <button
              key={`${slot.start_at}-${slot.end_at}`}
              type="button"
              disabled={booking}
              onClick={() => {
                setPending(slot);
                setBookingErr(null);
              }}
              className="flex w-full items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-3 py-3 text-left"
            >
              <span>
                <span className="block text-sm font-bold text-slate-900">
                  {slot.date_label} {slot.time_label}
                </span>
                <span className="mt-0.5 block text-[11px] text-slate-500">{payload.invite.slot_minutes}分</span>
              </span>
              <span className="shrink-0 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white">予約する</span>
            </button>
          ))}
        </div>
      ) : (
        <p className="rounded-2xl border border-slate-200 bg-white p-5 text-sm text-slate-600">
          いま空きがありません。別の時間はLINEでご相談ください。
        </p>
      )}
    </main>
  );
}
