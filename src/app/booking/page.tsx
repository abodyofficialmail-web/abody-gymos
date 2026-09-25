"use client";

import { DateTime } from "luxon";
import { useEffect, useMemo, useRef, useState } from "react";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import timezone from "dayjs/plugin/timezone";
import { resolveTrainerVisibilityPassActive } from "@/lib/trainerVisibilityPass";
import { safeMemberNextPath } from "@/lib/memberNextPath";

dayjs.extend(utc);
dayjs.extend(timezone);

type Store = { id: string; name: string };
type SlotTrainer = { id: string; display_name: string };
type Slot = { startAt: string; endAt: string; trainers?: SlotTrainer[] };
type BookingV2Slot = { start_at: string; end_at: string; trainers?: SlotTrainer[] };
type SessionType = "store" | "online";
type DateView = "calendar" | "list";
type AvailableDay = {
  date: string;
  slotCount: number;
  status: "available" | "limited" | "full";
  trainers?: SlotTrainer[];
};

const TZ = "Asia/Tokyo";
const DATE_VIEW_KEY = "booking-date-view";
const PASS_EMAIL_KEY = "booking-trainer-pass-email";
const PASS_CODE_KEY = "booking-trainer-pass-member-code";
const PASS_STORE_KEY = "booking-trainer-pass-store";
const PASS_ACTIVE_KEY = "booking-trainer-pass-active";

function storageGet(key: string): string {
  try {
    return sessionStorage.getItem(key) ?? localStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}

function persistTrainerPass(email: string, memberCode: string, active: boolean) {
  const write = (storage: Storage) => {
    if (email) storage.setItem(PASS_EMAIL_KEY, email);
    if (memberCode) storage.setItem(PASS_CODE_KEY, memberCode);
    if (active) storage.setItem(PASS_ACTIVE_KEY, "1");
    else storage.removeItem(PASS_ACTIVE_KEY);
  };
  try {
    write(sessionStorage);
    write(localStorage);
  } catch {
    // ignore
  }
}
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

function formatTrainerNames(trainers: SlotTrainer[] | undefined): string {
  return (trainers ?? [])
    .map((t) => t.display_name.trim())
    .filter(Boolean)
    .join(" / ");
}

function mapBookingSlots(rows: BookingV2Slot[] | null | undefined): Slot[] {
  return (rows ?? []).map((r) => ({
    startAt: r.start_at,
    endAt: r.end_at,
    trainers: r.trainers,
  }));
}

function availableDatesPath(storeId: string, monthParam: string, email: string) {
  const qs = new URLSearchParams({ store_id: storeId, month: monthParam });
  if (email) qs.set("email", email);
  return `/api/booking-v2/available-dates?${qs.toString()}`;
}

function availableSlotsPath(storeId: string, date: string, email: string) {
  const qs = new URLSearchParams({ store_id: storeId, date });
  if (email) qs.set("email", email);
  return `/api/booking-v2/available-slots?${qs.toString()}`;
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
    const err = new Error(`${res.status}|${full}`) as Error & { status?: number; payload?: unknown };
    err.status = res.status;
    err.payload = json;
    throw err;
  }
  return json as T;
}

export default function BookingPage() {
  const [stores, setStores] = useState<Store[] | null>(null);
  const [selectedStoreId, setSelectedStoreId] = useState<string>("");

  const [month, setMonth] = useState(() => DateTime.now().setZone(TZ).startOf("month"));
  const openedOctoberRef = useRef(false);
  const [dateView, setDateView] = useState<DateView>("calendar");
  const [days, setDays] = useState<AvailableDay[] | null>(null);
  const [monthSlots, setMonthSlots] = useState<Record<string, Slot[]> | null>(null);
  const [monthSlotsLoading, setMonthSlotsLoading] = useState(false);
  const daysByDate = useMemo(() => {
    const m = new Map<string, { slotCount: number; status: "available" | "limited" | "full"; trainers?: SlotTrainer[] }>();
    for (const d of days ?? []) m.set(d.date, { slotCount: d.slotCount, status: d.status, trainers: d.trainers });
    return m;
  }, [days]);

  const [selectedDate, setSelectedDate] = useState<string>("");

  const [sessionType, setSessionType] = useState<SessionType>("store");

  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [selectedSlotKey, setSelectedSlotKey] = useState<string>("");

  const [memberEmailInput, setMemberEmailInput] = useState("");
  const [memberName, setMemberName] = useState<string>("");
  const [memberCode, setMemberCode] = useState("");
  const [ticketKoma, setTicketKoma] = useState(0);
  const [remainingBookableKoma, setRemainingBookableKoma] = useState<number | null>(null);
  const [ticketBusy, setTicketBusy] = useState(false);
  const [ticketMsg, setTicketMsg] = useState<string | null>(null);
  const [ticketCheckoutSessionId, setTicketCheckoutSessionId] = useState("");
  const [logoutBusy, setLogoutBusy] = useState(false);
  const [authReady, setAuthReady] = useState(false);

  const [passEmail, setPassEmail] = useState("");
  const [passEmailInput, setPassEmailInput] = useState("");
  const [passMemberCodeInput, setPassMemberCodeInput] = useState("");
  const [passActive, setPassActive] = useState(false);
  const [passBusy, setPassBusy] = useState(false);
  const [passMsg, setPassMsg] = useState<string | null>(null);
  const [passJustPaid, setPassJustPaid] = useState(false);
  const [passRestoreEmail, setPassRestoreEmail] = useState("");
  const [passCheckoutSessionId, setPassCheckoutSessionId] = useState("");
  const [passMenuOpen, setPassMenuOpen] = useState(false);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [planConvertOffer, setPlanConvertOffer] = useState<"monthly_10" | "monthly_20" | null>(null);

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
    let cancelled = false;
    const q = new URLSearchParams(typeof window === "undefined" ? "" : window.location.search);
    const sessionId = (q.get("session_id") || q.get("checkout_session_id") || "").trim();
    const ticketPurchase = q.get("ticket_purchase") === "success";
    const savedStore = storageGet(PASS_STORE_KEY);
    if (savedStore) setSelectedStoreId(savedStore);
    if (ticketPurchase && sessionId) {
      setTicketCheckoutSessionId(sessionId);
    } else if (q.get("trainer_pass") === "success" || sessionId) {
      setPassJustPaid(true);
      if (savedStore) setStep(2);
      if (sessionId) setPassCheckoutSessionId(sessionId);
    }

    (async () => {
      try {
        const res = await fetch("/api/member/me", { cache: "no-store" });
        if (cancelled) return;
        if (res.status === 401) {
          const next = safeMemberNextPath(`${window.location.pathname}${window.location.search}`, "/booking");
          window.location.replace(`/login?next=${encodeURIComponent(next)}`);
          return;
        }
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error((json as { error?: string }).error ?? "会員情報の取得に失敗しました");
        const member = json.member as {
          email?: string | null;
          name?: string;
          member_code?: string;
          ticket_koma?: number;
          remaining_bookable_koma?: number | null;
        };
        const email = String(member?.email ?? "").trim();
        const code = String(member?.member_code ?? "").trim();
        if (!email) {
          setError("会員メールが未登録です。店舗までご連絡ください。");
          setAuthReady(true);
          return;
        }
        setMemberEmailInput(email);
        setMemberName(String(member?.name ?? ""));
        setMemberCode(code);
        setTicketKoma(Math.max(0, Number(member?.ticket_koma ?? 0) || 0));
        setRemainingBookableKoma(
          member?.remaining_bookable_koma == null ? null : Math.max(0, Number(member.remaining_bookable_koma) || 0)
        );
        setPassEmail(email);
        setPassEmailInput(email);
        setPassMemberCodeInput(code);
        const pass = json.trainer_visibility_pass as { active?: boolean } | undefined;
        const active = resolveTrainerVisibilityPassActive(pass?.active, email, code);
        setPassActive(active);
        persistTrainerPass(email, code, active);
        setAuthReady(true);
      } catch (e: any) {
        if (!cancelled) {
          const next = safeMemberNextPath(`${window.location.pathname}${window.location.search}`, "/booking");
          window.location.replace(`/login?next=${encodeURIComponent(next)}`);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
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
    setError(null);
    setSessionType("store");
    setDays(null);
    setMonthSlots(null);
    setSelectedDate("");
    setSlots(null);
    setSelectedSlotKey("");
  }, [selectedStoreId, month]);

  useEffect(() => {
    if (!authReady || !passEmail || !selectedStoreId || openedOctoberRef.current) return;
    const today = DateTime.now().setZone(TZ).toISODate()!;
    if (today >= "2026-10-01") return;
    let cancelled = false;
    apiGet<{ dates: { date: string; count: number }[] }>(
      availableDatesPath(selectedStoreId, "2026-10", passEmail)
    )
      .then((d) => {
        if (cancelled) return;
        const open = (d.dates ?? []).some((x) => x.date >= today && x.count > 0);
        openedOctoberRef.current = true;
        if (open) setMonth(DateTime.fromISO("2026-10-01", { zone: TZ }).startOf("month"));
      })
      .catch(() => {
        openedOctoberRef.current = true;
      });
    return () => {
      cancelled = true;
    };
  }, [authReady, passEmail, selectedStoreId]);

  useEffect(() => {
    if (!authReady || !passEmail || !selectedStoreId) return;
    const monthParam = month.toFormat("yyyy-MM");
    apiGet<{ dates: { date: string; count: number; trainers?: SlotTrainer[] }[] }>(
      availableDatesPath(selectedStoreId, monthParam, passEmail)
    )
      .then((d) =>
        setDays(
          (d.dates ?? []).map((x) => {
            const slotCount = x.count;
            const status = slotCount >= 3 ? "available" : slotCount >= 1 ? "limited" : "full";
            return { date: x.date, slotCount, status, trainers: x.trainers };
          })
        )
      )
      .catch((e: any) => setError(e?.message ?? "カレンダーの取得に失敗しました"));
  }, [authReady, selectedStoreId, month, passEmail]);

  useEffect(() => {
    if (!authReady || !passEmail || !selectedStoreId || !selectedDate) return;
    let cancelled = false;
    setError(null);
    apiGet<BookingV2Slot[]>(availableSlotsPath(selectedStoreId, selectedDate, passEmail))
      .then((rows) => {
        if (cancelled) return;
        const mapped = mapBookingSlots(rows);
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
  }, [authReady, selectedStoreId, selectedDate, passEmail]);

  useEffect(() => {
    if (dateView !== "list") return;
    if (!authReady || !passEmail || !selectedStoreId || !days) return;
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
        const rows = await apiGet<BookingV2Slot[]>(availableSlotsPath(selectedStoreId, date, passEmail));
        return [date, mapBookingSlots(rows)] as const;
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
  }, [authReady, dateView, selectedStoreId, days, todayYmd, passEmail]);

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

  async function lookupTrainerPass(
    emailRaw: string,
    opts?: { silent?: boolean }
  ): Promise<{ ok: true; active: boolean } | { ok: false }> {
    const v = validateMemberEmail(emailRaw);
    if (!v.ok) {
      if (!opts?.silent) setPassMsg(v.message);
      return { ok: false };
    }
    setPassBusy(true);
    if (!opts?.silent) setPassMsg(null);
    try {
      const qs = new URLSearchParams({ email: v.email });
      if (selectedStoreId) qs.set("store_id", selectedStoreId);
      const info = await apiGet<{
        member: { id: string; member_code: string; name: string };
        trainer_visibility_pass?: { active?: boolean; subscribe_url?: string | null };
      }>(`/api/booking-v2/member?${qs.toString()}`);
      const active = resolveTrainerVisibilityPassActive(
        info.trainer_visibility_pass?.active,
        v.email,
        info.member.member_code || passMemberCodeInput
      );
      setPassEmail(v.email);
      setMemberEmailInput(v.email);
      setMemberName(info.member.name ?? "");
      setPassActive(active);
      if (info.member.member_code) setPassMemberCodeInput(info.member.member_code);
      persistTrainerPass(v.email, info.member.member_code || passMemberCodeInput, active);
      if (active) {
        setPassJustPaid(false);
        setPassMsg(null);
      } else if (passJustPaid) {
        setPassMsg("決済の反映を確認しています。数十秒後にもう一度お試しください。");
      } else if (!opts?.silent) {
        setPassMsg("このメールではまだパスがありません。上のボタンから申し込めます。");
      }
      return { ok: true, active };
    } catch (e: any) {
      // 照会失敗で既存のパス表示を消さない
      if (!opts?.silent) setPassMsg(e?.message ?? "会員情報の取得に失敗しました");
      return { ok: false };
    } finally {
      setPassBusy(false);
    }
  }

  async function completeFromCheckout(sessionId: string) {
    setPassBusy(true);
    setPassMsg(null);
    try {
      const info = await apiGet<{
        email: string;
        member?: { name?: string; member_code?: string };
        trainer_visibility_pass?: { active?: boolean };
      }>(`/api/booking-v2/trainer-pass/from-checkout?session_id=${encodeURIComponent(sessionId)}`);
      const email = String(info.email ?? "").trim();
      setPassEmail(email);
      setPassEmailInput(email);
      setMemberEmailInput(email);
      setMemberName(info.member?.name ?? "");
      if (info.member?.member_code) {
        setPassMemberCodeInput(info.member.member_code);
        setMemberCode(info.member.member_code);
      }
      setPassActive(true);
      setPassJustPaid(false);
      setPassMsg(null);
      persistTrainerPass(email, info.member?.member_code ?? "", true);
      try {
        window.history.replaceState({}, "", "/booking");
      } catch {
        // ignore
      }
    } catch (e: any) {
      setPassMsg(e?.message ?? "決済の確認に失敗しました。会員登録と同じメールで決済したか確認してください。");
    } finally {
      setPassBusy(false);
    }
  }

  async function completeTicketFromCheckout(sessionId: string) {
    setTicketBusy(true);
    setTicketMsg(null);
    try {
      const info = await apiGet<{ ticket_koma?: number; granted?: number; already?: boolean }>(
        `/api/member/tickets/from-checkout?session_id=${encodeURIComponent(sessionId)}`
      );
      setTicketKoma(Math.max(0, Number(info.ticket_koma ?? 0) || 0));
      try {
        const me = await apiGet<{
          member?: { remaining_bookable_koma?: number | null; ticket_koma?: number };
        }>("/api/member/me");
        setTicketKoma(Math.max(0, Number(me.member?.ticket_koma ?? info.ticket_koma ?? 0) || 0));
        setRemainingBookableKoma(
          me.member?.remaining_bookable_koma == null
            ? null
            : Math.max(0, Number(me.member.remaining_bookable_koma) || 0)
        );
      } catch {
        // 残数の再取得に失敗しても購入反映は成功として扱う
      }
      setTicketMsg(
        info.already
          ? "チケットはすでに反映済みです。"
          : info.granted
            ? `チケットを${info.granted}コマ追加しました。`
            : "チケットを反映しました。"
      );
      try {
        window.history.replaceState({}, "", "/booking");
      } catch {
        // ignore
      }
    } catch (e: any) {
      setTicketMsg(e?.message ?? "チケットの反映に失敗しました。");
    } finally {
      setTicketBusy(false);
    }
  }

  async function goToTicketCheckout() {
    setTicketBusy(true);
    setTicketMsg(null);
    try {
      const d = await apiPost<{ url?: string }>("/api/member/tickets/checkout", { koma: 1 });
      if (!d.url) throw new Error("決済画面を開けませんでした");
      window.location.href = d.url;
    } catch (e: any) {
      const msg = String(e?.message ?? "");
      setTicketMsg(msg.includes("|") ? msg.split("|").slice(1).join("|") : msg || "決済画面を開けませんでした");
      setTicketBusy(false);
    }
  }

  async function logout() {
    if (logoutBusy) return;
    setLogoutBusy(true);
    try {
      await fetch("/api/member/logout", { method: "POST" });
    } catch {
      // クッキーが残っていてもログイン画面へ戻す
    }
    try {
      sessionStorage.removeItem(PASS_EMAIL_KEY);
      sessionStorage.removeItem(PASS_CODE_KEY);
      sessionStorage.removeItem(PASS_ACTIVE_KEY);
      sessionStorage.removeItem(PASS_STORE_KEY);
      localStorage.removeItem(PASS_EMAIL_KEY);
      localStorage.removeItem(PASS_CODE_KEY);
      localStorage.removeItem(PASS_ACTIVE_KEY);
      localStorage.removeItem(PASS_STORE_KEY);
    } catch {
      // ignore
    }
    window.location.replace("/login?next=/booking");
  }

  async function goToTrainerPassCheckout() {
    const v = validateMemberEmail(passEmailInput);
    const memberCode = passMemberCodeInput.trim();
    if (!v.ok) {
      setPassMsg("課金する前に、会員登録のメールアドレスを入力してください。");
      return;
    }
    if (!memberCode) {
      setPassMsg("課金する前に、会員番号も入力してください。");
      return;
    }
    const result = await lookupTrainerPass(v.email);
    if (!result.ok) return;
    if (result.active) return;
    try {
      if (selectedStoreId) {
        sessionStorage.setItem(PASS_STORE_KEY, selectedStoreId);
        localStorage.setItem(PASS_STORE_KEY, selectedStoreId);
      }
      persistTrainerPass(v.email, memberCode, false);
    } catch {
      // ignore
    }
    const qs = new URLSearchParams({ email: v.email, member_code: memberCode });
    window.location.href = `/api/booking-v2/trainer-pass/checkout?${qs.toString()}`;
  }

  useEffect(() => {
    if (!passCheckoutSessionId) return;
    void completeFromCheckout(passCheckoutSessionId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [passCheckoutSessionId]);

  useEffect(() => {
    if (!ticketCheckoutSessionId) return;
    void completeTicketFromCheckout(ticketCheckoutSessionId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticketCheckoutSessionId]);

  useEffect(() => {
    if (!passRestoreEmail) return;
    if (passCheckoutSessionId) return;
    void lookupTrainerPass(passRestoreEmail, { silent: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [passRestoreEmail, passCheckoutSessionId]);

  useEffect(() => {
    if (passJustPaid) setPassMenuOpen(true);
  }, [passJustPaid]);

  useEffect(() => {
    if (!passJustPaid || passActive || !passEmail) return;
    const t = window.setTimeout(() => {
      void lookupTrainerPass(passEmail, { silent: true });
    }, 2500);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [passJustPaid, passActive, passEmail]);

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
      const info = await apiGet<{
        member: { id: string; member_code: string; name: string };
        trainer_visibility_pass?: { active?: boolean; subscribe_url?: string | null };
      }>(
        `/api/booking-v2/member?${qs.toString()}`
      );
      setMemberEmailInput(v.email.trim());
      setMemberName(info.member.name ?? "");
      const pass = (info as { trainer_visibility_pass?: { active?: boolean; subscribe_url?: string | null } })
        .trainer_visibility_pass;
      setPassEmail(v.email);
      setMemberEmailInput(v.email);
      const nextActive = resolveTrainerVisibilityPassActive(pass?.active, v.email, info.member.member_code);
      setPassActive((prev) => {
        const merged = v.email === passEmail ? prev || nextActive : nextActive;
        persistTrainerPass(v.email, info.member.member_code, merged);
        return merged;
      });
      setStep(6);
    } catch (e: any) {
      setMemberName("");
      setError(e?.message ?? "会員情報の取得に失敗しました。もう一度お試しください。");
    } finally {
      setBusy(false);
    }
  }

  async function handleCreateReservation(convertToOfferedPlan = false) {
    if (!selectedSlot || !selectedDate) return;
    setBusy(true);
    setError(null);
    if (!convertToOfferedPlan) setPlanConvertOffer(null);
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
        convert_to_plan: convertToOfferedPlan ? planConvertOffer ?? undefined : undefined,
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
      const payload = e?.payload as { offer_plan?: "monthly_10" | "monthly_20" } | undefined;
      if (payload?.offer_plan && !convertToOfferedPlan) {
        setPlanConvertOffer(payload.offer_plan);
        return;
      }
      if (convertToOfferedPlan) setPlanConvertOffer(null);
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
    const current = step >= 6 ? 5 : step === 5 ? 5 : step;
    return Math.round(((current - 1) / 4) * 100);
  }, [step]);

  const stepLabel = step >= 5 ? 5 : step;

  const sessionTypeLabel = useMemo(() => (sessionType === "online" ? "オンライン" : "店舗"), [sessionType]);

  function resetToStart() {
    setError(null);
    setBusy(false);
    setPlanConvertOffer(null);
    setStep(1);
    setMonth(DateTime.now().setZone(TZ).startOf("month"));
    setDays(null);
    setMonthSlots(null);
    setSelectedDate("");
    setSessionType("store");
    setSlots(null);
    setSelectedSlotKey("");
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
    setStep(selectedSlotKey ? 6 : 4);
  }

  function dayStatusMeta(status: AvailableDay["status"]) {
    const symbol = status === "available" ? "○" : status === "limited" ? "△" : "×";
    const color =
      status === "available" ? "var(--ok)" : status === "limited" ? "var(--warn)" : "var(--muted)";
    return { symbol, color };
  }

  const trainerPassBanner = (
    <div className="rounded-xl border border-line bg-white px-4 py-3 space-y-2">
      <div className="text-xs text-ink-500">
        {memberName || memberCode ? `${memberName || "会員"}（${memberCode || memberEmailInput}）` : "ログイン中"}
      </div>
      <div className="flex items-center justify-between gap-3 rounded-xl border border-line bg-[#F9FAFB] px-3 py-2">
        <div>
          {remainingBookableKoma != null ? (
            <>
              <div className="text-[11px] text-ink-500">残り予約可能数</div>
              <div className="text-sm font-semibold text-ink-900">あと{remainingBookableKoma}コマ予約できます</div>
            </>
          ) : (
            <div className="text-sm font-semibold text-ink-900">予約できます</div>
          )}
          {ticketKoma > 0 ? (
            <div className="pt-0.5 text-[11px] text-ink-500">チケット {ticketKoma}コマ</div>
          ) : null}
        </div>
        <button
          type="button"
          disabled={ticketBusy}
          onClick={() => void goToTicketCheckout()}
          className="rounded-xl px-3 py-2 text-xs font-semibold text-white disabled:opacity-60"
          style={{ background: "var(--accent)" }}
        >
          {ticketBusy ? "処理中…" : "チケットを購入"}
        </button>
      </div>
      {ticketMsg ? <div className="text-xs text-ink-500">{ticketMsg}</div> : null}
      {passActive ? (
        <>
          <div className="text-sm font-semibold">担当トレーナー表示中</div>
          <div className="text-xs text-ink-500">各日・各時間の出勤トレーナーを表示しています。</div>
        </>
      ) : !passMenuOpen ? (
        <button
          type="button"
          onClick={() => setPassMenuOpen(true)}
          className="w-full rounded-xl border px-4 py-3 text-sm font-semibold"
          style={{ borderColor: "var(--accentBorder)", color: "var(--accent)" }}
        >
          担当トレーナー表示（オプション）
        </button>
      ) : (
        <>
          <div className="text-sm font-semibold">担当トレーナー表示</div>
          <div className="text-xs text-ink-500 leading-relaxed">
            ログイン中の会員（{memberCode || memberEmailInput}）に紐づけて表示します。別のメールを入れ直す必要はありません。
          </div>
          <button
            type="button"
            disabled={passBusy || !memberEmailInput || !passMemberCodeInput}
            onClick={() => void goToTrainerPassCheckout()}
            className="w-full rounded-xl px-4 py-3 text-sm font-semibold text-white disabled:opacity-60"
            style={{ background: "var(--accent)" }}
          >
            {passBusy ? "確認中…" : "オプション追加してトレーナーを表示する"}
          </button>
        </>
      )}
      {passJustPaid && !passActive ? (
        <div className="text-xs" style={{ color: "var(--accent)" }}>
          決済を確認しています…
        </div>
      ) : null}
      {passMsg ? <div className="text-xs text-ink-500">{passMsg}</div> : null}
    </div>
  );

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
      {!authReady ? (
        <div className="rounded-2xl border border-line bg-white px-4 py-8 text-center text-sm text-ink-500">
          ログインを確認しています…
        </div>
      ) : (
        <>
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={resetToStart}
          className="text-sm text-ink-500 hover:text-ink-900"
        >
          ↺ 最初から予約する
        </button>
        <div className="text-sm font-medium">予約</div>
        <button
          type="button"
          disabled={logoutBusy}
          onClick={() => void logout()}
          className="text-sm text-ink-500 hover:text-ink-900 disabled:opacity-60"
        >
          {logoutBusy ? "ログアウト中…" : "ログアウト"}
        </button>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between text-xs text-ink-500">
          <div>Step {stepLabel} / 5</div>
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

      <div className="sticky top-0 z-20 -mx-1 bg-white/95 px-1 py-1 backdrop-blur">
        {trainerPassBanner}
      </div>

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
                    try {
                      sessionStorage.setItem(PASS_STORE_KEY, s.id);
                      localStorage.setItem(PASS_STORE_KEY, s.id);
                    } catch {
                      // ignore
                    }
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
                    const names = formatTrainerNames(meta?.trainers);
                    const disabled = !inMonth || !ymd || isPast || (meta?.slotCount ?? 0) === 0;
                    const selected = ymd && selectedDate === ymd;

                    return (
                      <button
                        key={idx}
                        type="button"
                        disabled={disabled || !selectedStoreId}
                        onClick={() => goToDate(ymd)}
                        className={[
                          "rounded-xl border p-1.5 text-left transition-colors",
                          passActive ? "min-h-[76px]" : "aspect-square p-2",
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
                          <div className="h-full flex flex-col justify-between gap-0.5">
                            <div className="flex items-start justify-between gap-0.5">
                              <div className="text-sm font-medium">{dayNum}</div>
                              <div className="text-xs font-semibold" style={{ color }}>
                                {symbol}
                              </div>
                            </div>
                            {names ? <div className="text-[9px] leading-tight text-ink-500 line-clamp-3">{names}</div> : null}
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
                      <div>
                        <div className="text-sm font-semibold">{formatJstDateLabel(d.date)}</div>
                        {formatTrainerNames(d.trainers) ? (
                          <div className="pt-0.5 text-[11px] font-normal text-ink-500">
                            {formatTrainerNames(d.trainers)}
                          </div>
                        ) : null}
                      </div>
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
                          className="rounded-xl border px-3 py-2 text-left text-sm font-medium"
                          style={{ borderColor: "#E5E7EB", background: "#fff" }}
                        >
                          <div>{formatJstTime(s.startAt)}</div>
                          {formatTrainerNames(s.trainers) ? (
                            <div className="pt-0.5 text-[11px] font-normal text-ink-500">
                              {formatTrainerNames(s.trainers)}
                            </div>
                          ) : null}
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

          <div className={passActive ? "grid grid-cols-2 gap-2" : "grid grid-cols-3 gap-2"}>
            {(slots ?? []).map((s) => {
              const k = `${s.startAt}|${s.endAt}`;
              const selected = selectedSlotKey === k;
              const names = formatTrainerNames(s.trainers);
              return (
                <button
                  key={k}
                  type="button"
                  onClick={() => {
                    setSelectedSlotKey(k);
                    setStep(6);
                  }}
                  className="rounded-xl border px-3 py-3 text-left transition-colors"
                  style={
                    selected
                      ? { borderColor: "var(--accentBorder)", background: "var(--accentSoft)" }
                      : { borderColor: "#E5E7EB", background: "#fff" }
                  }
                >
                  <div className="text-sm font-medium">{formatJstTime(s.startAt)}</div>
                  {names ? <div className="pt-1 text-[11px] text-ink-500">{names}</div> : null}
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
              {formatTrainerNames(selectedSlot?.trainers) ? (
                <div className="text-sm text-ink-500">出勤: {formatTrainerNames(selectedSlot?.trainers)}</div>
              ) : null}
            </div>
            <div className="space-y-1">
              <div className="text-xs text-ink-500">会員</div>
              <div className="text-base font-medium">
                <div>
                  {memberName || "-"}
                  {memberCode ? `（${memberCode}）` : ""}
                </div>
                {memberEmailInput ? <div className="pt-1 text-sm text-ink-500">{memberEmailInput}</div> : null}
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={() => void handleCreateReservation(false)}
            disabled={busy}
            className="inline-flex w-full items-center justify-center rounded-xl px-4 py-3 text-white font-semibold disabled:opacity-60"
            style={{ background: "var(--accent)" }}
          >
            {busy ? "確定中…" : "予約を確定する"}
          </button>
        </section>
      ) : null}

      {planConvertOffer ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center">
          <div className="w-full max-w-[440px] rounded-2xl border border-line bg-white p-5 shadow-card space-y-4">
            <div className="text-base font-semibold">
              {planConvertOffer === "monthly_20" ? "月20コマプランへの変更" : "月10コマプランへの変更"}
            </div>
            <div className="text-sm text-ink-700 leading-relaxed space-y-2">
              <p>
                この予約をとるには、
                {planConvertOffer === "monthly_20" ? "月20コマプラン" : "月10コマプラン"}
                への変更が必要です。
              </p>
              <p>
                変更すると今回の予約は取れます。ただし、月に
                {planConvertOffer === "monthly_20" ? "20" : "10"}
                コマを超える予約はできなくなります。
              </p>
            </div>
            <div className="flex gap-3">
              <button
                type="button"
                disabled={busy}
                onClick={() => setPlanConvertOffer(null)}
                className="flex-1 rounded-xl border border-line px-4 py-3 text-sm font-medium disabled:opacity-60"
              >
                戻る
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void handleCreateReservation(true)}
                className="flex-1 rounded-xl px-4 py-3 text-sm font-semibold text-white disabled:opacity-60"
                style={{ background: "var(--accent)" }}
              >
                {busy ? "予約中…" : "変更して予約する"}
              </button>
            </div>
          </div>
        </div>
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
            if (step === 6) return setStep(4);
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
            if (step === 4 && selectedSlot) return setStep(6);
            if (step === 5) return setStep(6);
          }}
          disabled={
            busy ||
            (step === 1 && !selectedStoreId) ||
            step === 2 ||
            step === 3 ||
            (step === 4 && !selectedSlot) ||
            step === 6
          }
          className="flex-1 rounded-xl px-4 py-3 text-sm font-semibold text-white disabled:opacity-60"
          style={{ background: "var(--accent)" }}
        >
          次へ
        </button>
      </div>
        </>
      )}
    </main>
  );
}
