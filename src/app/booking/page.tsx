"use client";

import { DateTime } from "luxon";
import { useEffect, useMemo, useState } from "react";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import timezone from "dayjs/plugin/timezone";

dayjs.extend(utc);
dayjs.extend(timezone);

type Store = { id: string; name: string };
type Slot = { startAt: string; endAt: string };
type BookingV2Slot = { start_at: string; end_at: string };
type SessionType = "store" | "online";
type DateView = "calendar" | "list";
type AvailableDay = { date: string; slotCount: number; status: "available" | "limited" | "full" };

const TZ = "Asia/Tokyo";
const DATE_VIEW_KEY = "booking-date-view";
const SLOT_FETCH_CONCURRENCY = 4;

function readDateView(): DateView {
  if (typeof window === "undefined") return "calendar";
  try {
    return sessionStorage.getItem(DATE_VIEW_KEY) === "list" ? "list" : "calendar";
  } catch {
    return "calendar";
  }
}

async function mapPool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx]!);
    }
  });
  await Promise.all(workers);
  return out;
}

function formatJstDateLabel(ymd: string) {
  const dt = DateTime.fromISO(ymd, { zone: TZ });
  const dow = ["日", "月", "火", "水", "木", "金", "土"][dt.weekday % 7];
  return `${dt.toFormat("M/d")}（${dow}）`;
}

function formatJstTimeRange(startAtUtc: string, endAtUtc: string) {
  const s = DateTime.fromISO(startAtUtc).setZone(TZ);
  const e = DateTime.fromISO(endAtUtc).setZone(TZ);
  return `${s.toFormat("HH:mm")}〜${e.toFormat("HH:mm")}`;
}

function formatJstTime(startAtUtc: string) {
  return DateTime.fromISO(startAtUtc).setZone(TZ).toFormat("HH:mm");
}

type AccentTheme = {
  name: "ueno" | "ebisu" | "sakuragicho" | "fukuoka" | "unknown";
  label: string;
  accent: string; // hex
  accentSoft: string; // hex
  accentBorder: string; // hex
  ok: string; // hex
  warn: string; // hex
  muted: string; // hex
};

function themeForStoreName(storeName: string): AccentTheme {
  if (storeName === "上野") {
    return {
      name: "ueno",
      label: "上野",
      accent: "#16A34A",
      accentSoft: "#ECFDF5",
      accentBorder: "#86EFAC",
      ok: "#16A34A",
      warn: "#D97706",
      muted: "#6B7280",
    };
  }
  if (storeName === "恵比寿") {
    return {
      name: "ebisu",
      label: "恵比寿",
      accent: "#2563EB",
      accentSoft: "#EFF6FF",
      accentBorder: "#93C5FD",
      ok: "#2563EB",
      warn: "#D97706",
      muted: "#6B7280",
    };
  }
  if (storeName === "桜木町") {
    return {
      name: "sakuragicho",
      label: "桜木町",
      accent: "#CA8A04",
      accentSoft: "#FFFBEB",
      accentBorder: "#FDE68A",
      ok: "#CA8A04",
      warn: "#D97706",
      muted: "#6B7280",
    };
  }
  if (storeName === "福岡") {
    return {
      name: "fukuoka",
      label: "福岡",
      accent: "#DC2626",
      accentSoft: "#FEF2F2",
      accentBorder: "#FECACA",
      ok: "#DC2626",
      warn: "#D97706",
      muted: "#6B7280",
    };
  }
  return {
    name: "unknown",
    label: "",
    accent: "#111827",
    accentSoft: "#F3F4F6",
    accentBorder: "#E5E7EB",
    ok: "#16A34A",
    warn: "#D97706",
    muted: "#6B7280",
  };
}

async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(path, { cache: "no-store" });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((json as any).error ?? "取得に失敗しました");
  return json as T;
}

async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = (json as any).error ?? "送信に失敗しました";
    const detail = (json as any).detail;
    const detailStr =
      detail == null
        ? ""
        : typeof detail === "string"
          ? detail
          : (() => {
              try {
                return JSON.stringify(detail);
              } catch {
                return String(detail);
              }
            })();
    const full = detailStr ? `${msg}（${detailStr}）` : msg;
    throw new Error(`${res.status}|${full}`);
  }
  return json as T;
}

export default function BookingPage() {
  const [stores, setStores] = useState<Store[] | null>(null);
  const [selectedStoreId, setSelectedStoreId] = useState<string>("");

  const [month, setMonth] = useState(() => DateTime.now().setZone(TZ).startOf("month"));
  const [dateView, setDateView] = useState<DateView>("calendar");
  const [days, setDays] = useState<AvailableDay[] | null>(null);
  const [monthSlots, setMonthSlots] = useState<Record<string, Slot[]> | null>(null);
  const [monthSlotsLoading, setMonthSlotsLoading] = useState(false);
  const daysByDate = useMemo(() => {
    const m = new Map<string, { slotCount: number; status: "available" | "limited" | "full" }>();
    for (const d of days ?? []) m.set(d.date, { slotCount: d.slotCount, status: d.status });
    return m;
  }, [days]);

  const [selectedDate, setSelectedDate] = useState<string>("");

  const [sessionType, setSessionType] = useState<SessionType>("store");

  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [selectedSlotKey, setSelectedSlotKey] = useState<string>("");

  const [memberEmailInput, setMemberEmailInput] = useState("");
  const [memberName, setMemberName] = useState<string>("");

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const todayYmd = useMemo(() => DateTime.now().setZone(TZ).toISODate()!, []);
  const listDays = useMemo(
    () => (days ?? []).filter((d) => d.date >= todayYmd && d.slotCount > 0),
    [days, todayYmd]
  );

  const [step, setStep] = useState<1 | 2 | 3 | 4 | 5 | 6>(1);

  const selectedSlot = useMemo(() => {
    if (!slots || !selectedSlotKey) return null;
    const [startAt, endAt] = selectedSlotKey.split("|");
    return slots.find((s) => s.startAt === startAt && s.endAt === endAt) ?? null;
  }, [slots, selectedSlotKey]);

  useEffect(() => {
    setDateView(readDateView());
  }, []);

  useEffect(() => {
    setError(null);
    apiGet<{ stores: Store[] }>("/api/booking-v2/stores")
      .then((d) => setStores(d.stores))
      .catch((e: any) => setError(e?.message ?? "店舗の取得に失敗しました"));
  }, []);

  useEffect(() => {
    if (stores && !selectedStoreId) {
      const first = stores[0]?.id;
      if (first) setSelectedStoreId(first);
    }
  }, [stores, selectedStoreId]);

  useEffect(() => {
    if (!selectedStoreId) return;
    setMemberName("");
    setError(null);
    setSessionType("store");
    setDays(null);
    setMonthSlots(null);
    setSelectedDate("");
    setSlots(null);
    setSelectedSlotKey("");
    const monthParam = month.toFormat("yyyy-MM");
    apiGet<{ dates: { date: string; count: number }[] }>(
      `/api/booking-v2/available-dates?store_id=${encodeURIComponent(selectedStoreId)}&month=${encodeURIComponent(
        monthParam
      )}`
    )
      .then((d) =>
        setDays(
          (d.dates ?? []).map((x) => {
            const slotCount = x.count;
            const status = slotCount >= 3 ? "available" : slotCount >= 1 ? "limited" : "full";
            return { date: x.date, slotCount, status };
          })
        )
      )
      .catch((e: any) => setError(e?.message ?? "カレンダーの取得に失敗しました"));
  }, [selectedStoreId, month]);

  useEffect(() => {
    if (!selectedStoreId || !selectedDate) return;
    let cancelled = false;
    setMemberName("");
    setError(null);
    apiGet<BookingV2Slot[]>(
      `/api/booking-v2/available-slots?store_id=${encodeURIComponent(selectedStoreId)}&date=${encodeURIComponent(
        selectedDate
      )}`
    )
      .then((rows) => {
        if (cancelled) return;
        const mapped = (rows ?? []).map((r) => ({
          startAt: r.start_at,
          endAt: r.end_at,
        }));
        setSlots(mapped);
        setSelectedSlotKey((prev) =>
          prev && mapped.some((s) => `${s.startAt}|${s.endAt}` === prev) ? prev : ""
        );
      })
      .catch((e: any) => {
        if (cancelled) return;
        setError(e?.message ?? "空き枠の取得に失敗しました");
      });
    return () => {
      cancelled = true;
    };
  }, [selectedStoreId, selectedDate]);

  useEffect(() => {
    if (dateView !== "list") return;
    if (!selectedStoreId || !days) return;
    const dates = days.filter((d) => d.date >= todayYmd && d.slotCount > 0).map((d) => d.date);
    let cancelled = false;
    setMonthSlotsLoading(true);
    if (dates.length === 0) {
      setMonthSlots({});
      setMonthSlotsLoading(false);
      return;
    }
    void mapPool(dates, SLOT_FETCH_CONCURRENCY, async (date) => {
      try {
        const rows = await apiGet<BookingV2Slot[]>(
          `/api/booking-v2/available-slots?store_id=${encodeURIComponent(selectedStoreId)}&date=${encodeURIComponent(date)}`
        );
        return [date, (rows ?? []).map((r) => ({ startAt: r.start_at, endAt: r.end_at }))] as const;
      } catch {
        return [date, [] as Slot[]] as const;
      }
    }).then((pairs) => {
      if (cancelled) return;
      const next: Record<string, Slot[]> = {};
      for (const [date, slotsForDate] of pairs) next[date] = slotsForDate;
      setMonthSlots(next);
      setMonthSlotsLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [dateView, selectedStoreId, days, todayYmd]);

  const selectedStoreName = useMemo(
    () => (stores ?? []).find((s) => s.id === selectedStoreId)?.name ?? "",
    [stores, selectedStoreId]
  );

  const theme = useMemo(() => themeForStoreName(selectedStoreName), [selectedStoreName]);

  function validateMemberEmail(emailRaw: string): { ok: true; email: string } | { ok: false; message: string } {
    const email = String(emailRaw ?? "").trim();
    if (!email) return { ok: false, message: "メールアドレスを入力してください" };
    // 厳密にしすぎない（バックエンドでも検証する）
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email)) {
      return { ok: false, message: "メールアドレスの形式が不正です" };
    }
    return { ok: true, email };
  }

  async function lookupMemberAndGoToConfirm() {
    const v = validateMemberEmail(memberEmailInput);
    if (!v.ok) {
      setError(v.message);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const qs = new URLSearchParams({ email: v.email });
      if (selectedStoreId) qs.set("store_id", selectedStoreId);
      const info = await apiGet<{ member: { id: string; member_code: string; name: string } }>(
        `/api/booking-v2/member?${qs.toString()}`
      );
      setMemberEmailInput(v.email.trim());
      setMemberName(info.member.name ?? "");
      setStep(6);
    } catch (e: any) {
      setMemberName("");
      setError(e?.message ?? "会員情報の取得に失敗しました。もう一度お試しください。");
    } finally {
      setBusy(false);
    }
  }

  async function handleCreateReservation() {
    if (!selectedSlot || !selectedDate) return;
    setBusy(true);
    setError(null);
    try {
      const v = validateMemberEmail(memberEmailInput);
      if (!v.ok) {
        setError(v.message);
        return;
      }
      const email = v.email;
      const d = await apiPost<{
        reservation: {
          id: string;
          store_id: string;
          start_at: string;
          end_at: string;
        };
        member_email?: string;
      }>("/api/booking-v2/reservations", {
        store_id: selectedStoreId,
        email,
        session_type: sessionType,
        // UTC(Z)ではなくJST(+09:00)で送る（サーバー側のシフト判定と揃える）
        start_at: dayjs(selectedSlot.startAt).tz(TZ).format(),
        end_at: dayjs(selectedSlot.endAt).tz(TZ).format(),
      });
      const qs = new URLSearchParams({
        storeName: selectedStoreName,
        date: selectedDate,
        startAt: d.reservation.start_at,
        endAt: d.reservation.end_at,
        memberName: memberName || "",
        memberId: d.member_email ?? email,
        reservationId: d.reservation.id,
        sessionType,
      });
      window.location.href = "/booking/complete?" + qs.toString();
    } catch (e: any) {
      const msg = String(e?.message ?? "");
      const m = msg.includes("|") ? msg.split("|").slice(1).join("|") : msg;
      const statusStr = msg.includes("|") ? msg.split("|")[0] : "";
      const status = Number(statusStr);
      if (status === 404) {
        setError("会員が見つかりません（メールアドレスをご確認ください）");
      } else {
        setError(m || "予約の作成に失敗しました");
      }
    } finally {
      setBusy(false);
    }
  }

  const progressPct = useMemo(() => {
    const steps = 6;
    return Math.round(((step - 1) / (steps - 1)) * 100);
  }, [step]);

  const sessionTypeLabel = useMemo(() => (sessionType === "online" ? "オンライン" : "店舗"), [sessionType]);

  function resetToStart() {
    setError(null);
    setBusy(false);
    setStep(1);
    setMonth(DateTime.now().setZone(TZ).startOf("month"));
    setDays(null);
    setMonthSlots(null);
    setSelectedDate("");
    setSessionType("store");
    setSlots(null);
    setSelectedSlotKey("");
    setMemberEmailInput("");
    setMemberName("");
  }

  function changeDateView(next: DateView) {
    setDateView(next);
    try {
      sessionStorage.setItem(DATE_VIEW_KEY, next);
    } catch {
      // ignore
    }
  }

  function goToDate(ymd: string, slot?: Slot | null) {
    setSelectedDate(ymd);
    setMemberEmailInput("");
    setSessionType("store");
    if (slot) {
      const daySlots = monthSlots?.[ymd];
      setSlots(daySlots && daySlots.length > 0 ? daySlots : [slot]);
      setSelectedSlotKey(`${slot.startAt}|${slot.endAt}`);
    } else {
      setSelectedSlotKey("");
      setSlots(null);
    }
    setStep(3);
  }

  function goToTimeOrMember() {
    setStep(selectedSlotKey ? 5 : 4);
  }

  function dayStatusMeta(status: AvailableDay["status"]) {
    const symbol = status === "available" ? "○" : status === "limited" ? "△" : "×";
    const color =
      status === "available" ? "var(--ok)" : status === "limited" ? "var(--warn)" : "var(--muted)";
    return { symbol, color };
  }

  return (
    <main
      className="mx-auto w-full max-w-[520px] px-5 py-6 space-y-5"
      style={
        {
          ["--accent" as any]: theme.accent,
          ["--accentSoft" as any]: theme.accentSoft,
          ["--accentBorder" as any]: theme.accentBorder,
          ["--ok" as any]: theme.ok,
          ["--warn" as any]: theme.warn,
          ["--muted" as any]: theme.muted,
        } as React.CSSProperties
      }
    >
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={resetToStart}
          className="text-sm text-ink-500 hover:text-ink-900"
        >
          ↺ 最初から予約する
        </button>
        <div className="text-sm font-medium">予約</div>
        <div className="w-10" />
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between text-xs text-ink-500">
          <div>Step {step} / 6</div>
          <div>{progressPct}%</div>
        </div>
        <div className="h-2 rounded-full bg-[#F3F4F6] overflow-hidden">
          <div className="h-2" style={{ width: `${progressPct}%`, background: "var(--accent)" }} />
        </div>
      </div>

      {error ? (
        <div className="rounded-xl border border-line bg-[#FEF2F2] text-[#991B1B] px-4 py-3 text-sm">
          {error}
        </div>
      ) : null}

      {/* Step 1: store */}
      {step === 1 ? (
        <section className="rounded-2xl border border-line shadow-card p-5 space-y-4">
          <div className="space-y-1">
            <div className="text-base font-semibold">店舗を選択</div>
            <div className="text-sm text-ink-500">上部タブではなく、まず店舗を選びます。</div>
          </div>
          <div className="grid gap-2">
            {(stores ?? []).map((s) => {
              const t = themeForStoreName(s.name);
              const selected = selectedStoreId === s.id;
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => {
                    setSelectedStoreId(s.id);
                    setMonth(DateTime.now().setZone(TZ).startOf("month"));
                    setSessionType("store");
                    setStep(2);
                  }}
                  className={[
                    "w-full rounded-xl border px-4 py-4 text-left transition-colors",
                    selected ? "bg-white" : "bg-white hover:bg-[#F9FAFB]",
                  ].join(" ")}
                  style={
                    selected
                      ? { borderColor: t.accentBorder, background: t.accentSoft }
                      : { borderColor: "#E5E7EB" }
                  }
                >
                  <div className="text-base font-semibold">{s.name}</div>
                  <div className="text-xs text-ink-500 pt-1">この店舗の空き状況を確認します</div>
                </button>
              );
            })}
            {stores === null ? <div className="text-sm text-ink-500">読み込み中…</div> : null}
          </div>
        </section>
      ) : null}

      {/* Step 2: calendar or availability list */}
      {step === 2 ? (
        <section className="rounded-2xl border border-line shadow-card p-5 space-y-4">
          <div className="space-y-1">
            <div className="text-base font-semibold">{dateView === "list" ? "空き状況から選択" : "日付を選択"}</div>
            <div className="text-sm text-ink-500">
              {dateView === "list"
                ? `${selectedStoreName} の空き状況一覧です。`
                : `${selectedStoreName} のカレンダーです。`}
            </div>
          </div>

          <div className="grid grid-cols-2 rounded-xl border border-line p-1">
            <button
              type="button"
              onClick={() => changeDateView("calendar")}
              className="rounded-lg px-3 py-2 text-sm font-medium"
              style={
                dateView === "calendar"
                  ? { background: "var(--accentSoft)", color: "var(--accent)" }
                  : { color: "#6B7280" }
              }
            >
              カレンダー
            </button>
            <button
              type="button"
              onClick={() => changeDateView("list")}
              className="rounded-lg px-3 py-2 text-sm font-medium"
              style={
                dateView === "list"
                  ? { background: "var(--accentSoft)", color: "var(--accent)" }
                  : { color: "#6B7280" }
              }
            >
              空き状況一覧
            </button>
          </div>

          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={() => setMonth((m) => m.minus({ months: 1 }).startOf("month"))}
              className="rounded-lg border border-line px-3 py-2 text-sm"
            >
              ← 前月
            </button>
            <div className="text-sm font-medium">{month.toFormat("yyyy年M月")}</div>
            <button
              type="button"
              onClick={() => setMonth((m) => m.plus({ months: 1 }).startOf("month"))}
              className="rounded-lg border border-line px-3 py-2 text-sm"
            >
              次月 →
            </button>
          </div>

          {dateView === "calendar" ? (
            <>
              <div className="grid grid-cols-7 gap-1 text-center text-xs text-ink-500">
                {["日", "月", "火", "水", "木", "金", "土"].map((w) => (
                  <div key={w} className="py-1">
                    {w}
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-7 gap-1">
                {(() => {
                  const first = month.startOf("month");
                  const startDow = first.weekday % 7; // 0=Sun
                  const daysInMonth = month.daysInMonth ?? 31;
                  const cells = 42;
                  return Array.from({ length: cells }, (_, idx) => {
                    const dayNum = idx - startDow + 1;
                    const inMonth = dayNum >= 1 && dayNum <= daysInMonth;
                    const ymd = inMonth ? month.set({ day: dayNum }).toISODate()! : "";
                    const meta = ymd ? daysByDate.get(ymd) : null;
                    const status = meta?.status ?? "full";
                    const { symbol, color } = dayStatusMeta(status);
                    const isPast = ymd ? ymd < todayYmd : false;
                    const disabled = !inMonth || !ymd || isPast || (meta?.slotCount ?? 0) === 0;
                    const selected = ymd && selectedDate === ymd;

                    return (
                      <button
                        key={idx}
                        type="button"
                        disabled={disabled || !selectedStoreId}
                        onClick={() => goToDate(ymd)}
                        className={[
                          "aspect-square rounded-xl border p-2 text-left transition-colors",
                          !inMonth ? "border-transparent bg-transparent" : "border-line bg-white",
                          disabled && inMonth ? "opacity-50" : "hover:bg-[#F9FAFB]",
                        ].join(" ")}
                        style={
                          selected
                            ? { borderColor: "var(--accentBorder)", background: "var(--accentSoft)" }
                            : undefined
                        }
                      >
                        {inMonth ? (
                          <div className="h-full flex flex-col justify-between">
                            <div className="text-sm font-medium">{dayNum}</div>
                            <div className="text-sm font-semibold" style={{ color }}>
                              {symbol}
                            </div>
                          </div>
                        ) : (
                          <div />
                        )}
                      </button>
                    );
                  });
                })()}
              </div>
            </>
          ) : (
            <div className="space-y-3">
              <div className="text-xs text-ink-500">空きのある日だけ表示しています。時間を直接選ぶこともできます。</div>
              {days !== null && listDays.length === 0 ? (
                <div className="text-sm text-ink-700">この月は空き枠がありません。</div>
              ) : null}
              {listDays.map((d) => {
                const { symbol, color } = dayStatusMeta(d.status);
                const times = monthSlots?.[d.date];
                return (
                  <div key={d.date} className="rounded-xl border border-line bg-white">
                    <button
                      type="button"
                      onClick={() => goToDate(d.date)}
                      className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
                    >
                      <div className="text-sm font-semibold">{formatJstDateLabel(d.date)}</div>
                      <div className="text-xs font-medium" style={{ color }}>
                        {symbol} {d.slotCount}枠
                      </div>
                    </button>
                    <div className="flex flex-wrap gap-2 px-3 pb-3">
                      {times === undefined && monthSlotsLoading ? (
                        <div className="text-xs text-ink-500">時間を読み込み中…</div>
                      ) : null}
                      {(times ?? []).map((s) => (
                        <button
                          key={`${s.startAt}|${s.endAt}`}
                          type="button"
                          onClick={() => goToDate(d.date, s)}
                          className="rounded-xl border px-3 py-2 text-sm font-medium"
                          style={{ borderColor: "#E5E7EB", background: "#fff" }}
                        >
                          {formatJstTime(s.startAt)}
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {dateView === "calendar" ? (
            <div className="flex items-center gap-4 text-xs text-ink-500">
              <div>
                <span className="font-semibold" style={{ color: "var(--ok)" }}>
                  ○
                </span>{" "}
                空きあり（3枠以上）
              </div>
              <div>
                <span className="font-semibold" style={{ color: "var(--warn)" }}>
                  △
                </span>{" "}
                わずか（1〜2枠）
              </div>
              <div>
                <span className="font-semibold">×</span> なし（0枠）
              </div>
            </div>
          ) : null}

          {days === null ? <div className="text-sm text-ink-500">読み込み中…</div> : null}
        </section>
      ) : null}

      {/* Step 3: session type */}
      {step === 3 ? (
        <section className="rounded-2xl border border-line shadow-card p-5 space-y-4">
          <div className="space-y-1">
            <div className="text-base font-semibold">セッション種別を選択</div>
            <div className="text-sm text-ink-500">
              {selectedStoreName} / {selectedDate ? formatJstDateLabel(selectedDate) : "-"}
            </div>
          </div>

          <div className="grid gap-2">
            <button
              type="button"
              onClick={() => {
                setSessionType("store");
                goToTimeOrMember();
              }}
              className={[
                "w-full rounded-xl border px-4 py-4 text-left transition-colors",
                sessionType === "store" ? "" : "bg-white hover:bg-[#F9FAFB]",
              ].join(" ")}
              style={
                sessionType === "store"
                  ? { borderColor: "var(--accentBorder)", background: "var(--accentSoft)" }
                  : { borderColor: "#E5E7EB" }
              }
            >
              <div className="text-base font-semibold">店舗</div>
              <div className="text-xs text-ink-500 pt-1">店舗でのセッション</div>
            </button>

            <button
              type="button"
              onClick={() => {
                setSessionType("online");
                goToTimeOrMember();
              }}
              className={[
                "w-full rounded-xl border px-4 py-4 text-left transition-colors",
                sessionType === "online" ? "" : "bg-white hover:bg-[#F9FAFB]",
              ].join(" ")}
              style={
                sessionType === "online"
                  ? { borderColor: "var(--accentBorder)", background: "var(--accentSoft)" }
                  : { borderColor: "#E5E7EB" }
              }
            >
              <div className="text-base font-semibold">オンライン</div>
              <div className="text-xs text-ink-500 pt-1">オンラインでのセッション</div>
            </button>
          </div>
        </section>
      ) : null}

      {/* Step 4: time */}
      {step === 4 ? (
        <section className="rounded-2xl border border-line shadow-card p-5 space-y-4">
          <div className="space-y-1">
            <div className="text-base font-semibold">空いている時間を選択</div>
            <div className="text-sm text-ink-500">{selectedStoreName} / {selectedDate ? formatJstDateLabel(selectedDate) : "-"}</div>
          </div>

          <div className="grid grid-cols-3 gap-2">
            {(slots ?? []).map((s) => {
              const k = `${s.startAt}|${s.endAt}`;
              const selected = selectedSlotKey === k;
              return (
                <button
                  key={k}
                  type="button"
                  onClick={() => {
                    setSelectedSlotKey(k);
                    setStep(5);
                  }}
                  className="rounded-xl border px-3 py-3 text-center transition-colors"
                  style={
                    selected
                      ? { borderColor: "var(--accentBorder)", background: "var(--accentSoft)" }
                      : { borderColor: "#E5E7EB", background: "#fff" }
                  }
                >
                  <div className="text-sm font-medium">{formatJstTime(s.startAt)}</div>
                </button>
              );
            })}
          </div>
          {slots === null ? <div className="text-sm text-ink-500">読み込み中…</div> : null}
          {slots && slots.length === 0 ? (
            <div className="text-sm text-ink-700">この日は空き枠がありません。</div>
          ) : null}
        </section>
      ) : null}

      {/* Step 5: member */}
      {step === 5 ? (
        <section className="rounded-2xl border border-line shadow-card p-5 space-y-4">
          <div className="space-y-1">
            <div className="text-base font-semibold">会員情報</div>
            <div className="text-sm text-ink-500">
              {selectedStoreName} / {formatJstDateLabel(selectedDate)} /{" "}
              {selectedSlot ? formatJstTimeRange(selectedSlot.startAt, selectedSlot.endAt) : "-"}
            </div>
          </div>

          <div className="space-y-3">
            <div className="text-base font-semibold">メールアドレス</div>
            <div className="text-sm text-ink-500">会員登録時のメールアドレスを入力してください</div>
            <input
              value={memberEmailInput}
              onChange={(e) => setMemberEmailInput(e.target.value)}
              placeholder="example@example.com"
              inputMode="email"
              autoCapitalize="none"
              className="w-full rounded-xl border border-line px-4 py-3 text-base outline-none"
              style={{ borderColor: "var(--accentBorder)" }}
            />
            <button
              type="button"
              onClick={() => void lookupMemberAndGoToConfirm()}
              disabled={busy}
              className="inline-flex w-full items-center justify-center rounded-xl px-4 py-3 text-white font-semibold disabled:opacity-60"
              style={{ background: "var(--accent)" }}
            >
              次へ
            </button>
          </div>
        </section>
      ) : null}

      {/* Step 6: confirm */}
      {step === 6 ? (
        <section className="rounded-2xl border border-line shadow-card p-5 space-y-4">
          <div className="space-y-1">
            <div className="text-base font-semibold">最終確認</div>
            <div className="text-sm text-ink-500">内容をご確認のうえ、予約を確定してください。</div>
          </div>

          <div className="rounded-xl border border-line bg-white p-4 space-y-3">
            <div className="space-y-1">
              <div className="text-xs text-ink-500">店舗</div>
              <div className="text-base font-medium">{selectedStoreName}</div>
            </div>
            <div className="space-y-1">
              <div className="text-xs text-ink-500">セッション種別</div>
              <div className="text-base font-medium">{sessionTypeLabel}</div>
            </div>
            <div className="space-y-1">
              <div className="text-xs text-ink-500">日付</div>
              <div className="text-base font-medium">{formatJstDateLabel(selectedDate)}</div>
            </div>
            <div className="space-y-1">
              <div className="text-xs text-ink-500">時間</div>
              <div className="text-base font-medium">
                {selectedSlot ? formatJstTimeRange(selectedSlot.startAt, selectedSlot.endAt) : "-"}
              </div>
            </div>
            <div className="space-y-1">
              <div className="text-xs text-ink-500">会員</div>
              <div className="text-base font-medium">
                <div>-（{memberEmailInput.trim() || "-"}）</div>
                {memberName ? <div className="pt-1">{memberName}</div> : null}
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={handleCreateReservation}
            disabled={busy}
            className="inline-flex w-full items-center justify-center rounded-xl px-4 py-3 text-white font-semibold disabled:opacity-60"
            style={{ background: "var(--accent)" }}
          >
            {busy ? "確定中…" : "予約を確定する"}
          </button>
        </section>
      ) : null}

      <div className="flex gap-3">
        <button
          type="button"
          onClick={() => {
            setError(null);
            if (step === 1) return;
            if (step === 2) return setStep(1);
            if (step === 3) return setStep(2);
            if (step === 4) return setStep(3);
            if (step === 5) return setStep(4);
            if (step === 6) return setStep(5);
          }}
          disabled={busy || step === 1}
          className="flex-1 rounded-xl border border-line px-4 py-3 text-sm font-medium disabled:opacity-60"
        >
          戻る
        </button>

        <button
          type="button"
          onClick={() => {
            setError(null);
            if (step === 1 && selectedStoreId) return setStep(2);
            if (step === 2) return;
            if (step === 3) return;
            if (step === 4 && selectedSlot) return setStep(5);
            if (step === 5) {
              void lookupMemberAndGoToConfirm();
              return;
            }
          }}
          disabled={
            busy ||
            (step === 1 && !selectedStoreId) ||
            step === 2 ||
            step === 3 ||
            (step === 4 && !selectedSlot) ||
            (step === 5 && memberEmailInput.trim().length === 0) ||
            step === 6
          }
          className="flex-1 rounded-xl px-4 py-3 text-sm font-semibold text-white disabled:opacity-60"
          style={{ background: "var(--accent)" }}
        >
          次へ
        </button>
      </div>
    </main>
  );
}
