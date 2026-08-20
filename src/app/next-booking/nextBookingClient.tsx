"use client";

import { useCallback, useEffect, useState } from "react";

function nextBookingCopy(count: number) {
  return `今月はまだ${count}回です。通いやすい時間の空きから、次回をこの場で確定できます。`;
}

type SuggestedSlot = {
  start_at: string;
  end_at: string;
  date_label: string;
  time_label: string;
  match_label: string;
};

function slotFromQuery(startAt: string, endAt: string): SuggestedSlot {
  const start = new Date(startAt);
  const end = new Date(endAt);
  const dateLabel = Number.isNaN(start.getTime())
    ? startAt
    : start.toLocaleDateString("ja-JP", { month: "long", day: "numeric", weekday: "short" });
  const time = (d: Date) =>
    Number.isNaN(d.getTime())
      ? ""
      : d.toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit", hour12: false });
  return {
    start_at: startAt,
    end_at: endAt,
    date_label: dateLabel,
    time_label: `${time(start)}〜${time(end)}`.replace(/^〜|〜$/g, "") || startAt,
    match_label: "ご指定の枠",
  };
}

type NextBookingOffer = {
  eligible: boolean;
  monthly_average: number;
  this_month_count?: number;
  remaining_holds: number;
  preferred_labels: string[];
  slots: SuggestedSlot[];
  booking_url: string;
};

type Payload = {
  invite: { token: string; store_name: string };
  submit?: { token?: string; s?: string; sig?: string };
  next_booking: NextBookingOffer;
};

export default function NextBookingPage() {
  const [payload, setPayload] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [pending, setPending] = useState<SuggestedSlot | null>(null);
  const [booking, setBooking] = useState(false);
  const [bookingErr, setBookingErr] = useState<string | null>(null);
  const [bookedLabels, setBookedLabels] = useState<string[]>([]);
  const [offer, setOffer] = useState<NextBookingOffer | null>(null);

  const load = useCallback(async () => {
    const q = window.location.search.replace(/^\?/, "");
    if (!q) {
      setErr("リンクが不正です。LINEのメッセージから再度お開きください。");
      setLoading(false);
      return;
    }
    const res = await fetch(`/api/member/next-booking?${q}`, { cache: "no-store" });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error((json as { error?: string }).error ?? "読み込みに失敗しました");
    const data = json as Payload;
    setPayload(data);
    setOffer(data.next_booking);
    const params = new URLSearchParams(window.location.search);
    const startAt = params.get("start_at");
    const endAt = params.get("end_at");
    if (startAt && endAt && data.next_booking.eligible) {
      const found = data.next_booking.slots.find((s) => s.start_at === startAt && s.end_at === endAt);
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
      const res = await fetch("/api/member/session-survey/book", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          token: payload.submit?.token ?? payload.invite.token,
          s: payload.submit?.s,
          sig: payload.submit?.sig,
          start_at: pending.start_at,
          end_at: pending.end_at,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((json as { error?: string }).error ?? "予約に失敗しました");
      setBookedLabels((prev) => [...prev, `${pending.date_label} ${pending.time_label}`]);
      setPending(null);
      const refreshed = (json as { next_booking?: NextBookingOffer | null }).next_booking;
      if (refreshed) setOffer(refreshed);
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

  if (err || !payload || !offer) {
    return (
      <main className="mx-auto min-h-screen max-w-lg bg-slate-50 px-4 py-10">
        <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-red-800">
          {err ?? "案内を表示できません"}
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto min-h-screen max-w-lg bg-gradient-to-b from-emerald-50 to-slate-50 px-4 py-8 pb-16">
      <header className="mb-6">
        <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">次回のご予約</p>
        <h1 className="mt-1 text-xl font-bold text-slate-900">希望時間の空きからすぐ確定</h1>
        <p className="mt-2 text-sm leading-relaxed text-slate-600">
          {nextBookingCopy(offer.this_month_count ?? offer.monthly_average)}
        </p>
        {payload.invite.store_name ? (
          <p className="mt-1 text-xs text-slate-500">店舗：{payload.invite.store_name}</p>
        ) : null}
        {offer.preferred_labels.length ? (
          <p className="mt-1 text-xs text-slate-500">希望：{offer.preferred_labels.join(" / ")}</p>
        ) : null}
      </header>

      {bookedLabels.length ? (
        <ul className="mb-4 space-y-1.5">
          {bookedLabels.map((label) => (
            <li
              key={label}
              className="rounded-xl border border-emerald-200 bg-white px-3 py-2 text-sm font-medium text-emerald-900"
            >
              {label} を確定しました
            </li>
          ))}
        </ul>
      ) : null}

      {pending ? (
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-sm font-bold text-slate-900">この時間で確定しますか？</p>
          <p className="mt-1 text-sm text-slate-700">
            {pending.date_label} {pending.time_label}
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
      ) : offer.eligible && offer.slots.length > 0 ? (
        <div className="space-y-2">
          {offer.slots.map((slot) => (
            <button
              key={slot.start_at}
              type="button"
              disabled={booking}
              onClick={() => setPending(slot)}
              className="flex w-full items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-3 py-3 text-left shadow-sm transition hover:border-emerald-300 hover:bg-emerald-50 disabled:opacity-60"
            >
              <span>
                <span className="block text-sm font-bold text-slate-900">
                  {slot.date_label} {slot.time_label}
                </span>
                <span className="mt-0.5 block text-[11px] text-slate-500">{slot.match_label}</span>
              </span>
              <span className="shrink-0 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white">
                予約する
              </span>
            </button>
          ))}
        </div>
      ) : (
        <p className="rounded-2xl border border-slate-200 bg-white p-5 text-sm text-slate-600">
          いま希望時間の空きが見つかりませんでした。予約サイトから他の時間も選べます。
        </p>
      )}

      {bookingErr ? <p className="mt-3 text-sm text-red-600">{bookingErr}</p> : null}

      <a href={offer.booking_url} className="mt-6 inline-block text-xs font-semibold text-emerald-800 underline">
        別の時間がいい場合は予約サイトへ
      </a>
    </main>
  );
}
