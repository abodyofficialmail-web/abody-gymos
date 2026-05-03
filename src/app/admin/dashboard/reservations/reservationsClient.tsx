"use client";

import { DateTime } from "luxon";
import { useCallback, useEffect, useMemo, useState } from "react";

const TZ = "Asia/Tokyo";

type Store = { id: string; name: string };

type ShiftDto = {
  id: string;
  trainer_id: string;
  trainer_name: string;
  store_id: string;
  date: string; // YYYY-MM-DD
  start_local: string;
  end_local: string;
  breaks: Array<{ id: string; start_time: string; end_time: string }>;
};

type MemberRow = {
  id: string;
  member_code: string;
  name: string | null;
  email?: string | null;
  line_user_id?: string | null;
};

type ReservationRow = {
  id: string;
  store_id: string;
  store_name?: string;
  trainer_id: string | null;
  trainer_name?: string;
  trainer_candidates?: string[];
  member_id: string;
  member_code?: string;
  member_name?: string;
  session_type?: string | null;
  start_at: string;
  end_at: string;
  status: string;
  created_at: string;
};

type StoreTheme = {
  accent: string;
  accentSoft: string;
  accentBorder: string;
};

function themeForStoreName(storeName: string): StoreTheme {
  if (storeName === "上野") {
    return { accent: "#16A34A", accentSoft: "#ECFDF5", accentBorder: "#86EFAC" };
  }
  if (storeName === "恵比寿") {
    return { accent: "#2563EB", accentSoft: "#EFF6FF", accentBorder: "#93C5FD" };
  }
  if (storeName === "桜木町") {
    return { accent: "#CA8A04", accentSoft: "#FFFBEB", accentBorder: "#FDE68A" };
  }
  return { accent: "#111827", accentSoft: "#F3F4F6", accentBorder: "#E5E7EB" };
}

function themeForStoreId(stores: Store[] | null, storeId: string): StoreTheme {
  const name = (stores ?? []).find((s) => s.id === storeId)?.name ?? "";
  return themeForStoreName(name);
}

function sessionTypeBadge(sessionType: string | null | undefined) {
  const t = String(sessionType ?? "store");
  if (t === "online") return "💻 オンライン";
  return "🏠 店舗";
}

function reservationAccent(stores: Store[] | null, r: ReservationRow): { border: string; soft: string } {
  const sessionType = String(r.session_type ?? "store");
  if (sessionType === "online") return { border: "#A855F7", soft: "#FAF5FF" }; // purple
  // 店舗セッションは店舗色（上野=緑、恵比寿=青、桜木町=黄）
  const storeName = (stores ?? []).find((s) => s.id === r.store_id)?.name ?? r.store_name ?? "";
  if (storeName === "上野") return { border: "#16A34A", soft: "#ECFDF5" };
  if (storeName === "桜木町") return { border: "#CA8A04", soft: "#FFFBEB" };
  return { border: "#2563EB", soft: "#EFF6FF" }; // 恵比寿など
}

async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(path, { cache: "no-store" });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((json as any)?.error ?? "取得に失敗しました");
  return json as T;
}

async function apiPost<T>(path: string, body: any): Promise<T> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((json as any)?.error ?? "保存に失敗しました");
  return json as T;
}

async function apiPatch<T>(path: string, body: any): Promise<T> {
  const res = await fetch(path, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((json as any)?.error ?? "更新に失敗しました");
  return json as T;
}

export function ReservationsClient() {
  const [month, setMonth] = useState(() => DateTime.now().setZone(TZ).startOf("month"));
  const monthKey = useMemo(() => month.toFormat("yyyy-MM"), [month]);

  const [stores, setStores] = useState<Store[] | null>(null);
  // "all" = 全店舗を1枚のカレンダーに重ね表示
  const [selectedStoreId, setSelectedStoreId] = useState<string>("all");

  const [rows, setRows] = useState<ReservationRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const [selectedYmd, setSelectedYmd] = useState<string | null>(null);

  const [busy, setBusy] = useState(false);

  // 予約追加モーダル
  const [addOpen, setAddOpen] = useState(false);
  const [addStep, setAddStep] = useState<"member" | "slot" | "confirm">("member");
  const [memberQuery, setMemberQuery] = useState("");
  const [memberResults, setMemberResults] = useState<MemberRow[] | null>(null);
  const [selectedMember, setSelectedMember] = useState<MemberRow | null>(null);
  const [addStoreId, setAddStoreId] = useState<string>("");
  const [addDateYmd, setAddDateYmd] = useState<string>("");
  const [addSlots, setAddSlots] = useState<Array<{ start_at: string; end_at: string }> | null>(null);
  const [addSelectedSlot, setAddSelectedSlot] = useState<{ start_at: string; end_at: string } | null>(null);
  const [addSessionType, setAddSessionType] = useState<"store" | "online">("store");
  const [addErr, setAddErr] = useState<string | null>(null);

  // 予約変更モーダル
  const [editTarget, setEditTarget] = useState<ReservationRow | null>(null);
  const [editStoreId, setEditStoreId] = useState<string>("");
  const [editDateYmd, setEditDateYmd] = useState<string>("");
  const [editSlots, setEditSlots] = useState<Array<{ start_at: string; end_at: string }> | null>(null);
  const [editSelectedSlot, setEditSelectedSlot] = useState<{ start_at: string; end_at: string } | null>(null);
  const [editErr, setEditErr] = useState<string | null>(null);

  // キャンセルモーダル
  const [cancelTarget, setCancelTarget] = useState<ReservationRow | null>(null);
  const [cancelErr, setCancelErr] = useState<string | null>(null);

  // 休憩追加モーダル
  const [breakOpen, setBreakOpen] = useState(false);
  const [breakErr, setBreakErr] = useState<string | null>(null);
  const [breakStoreId, setBreakStoreId] = useState<string>("");
  const [breakDateYmd, setBreakDateYmd] = useState<string>("");
  const [breakShifts, setBreakShifts] = useState<ShiftDto[] | null>(null);
  const [breakShiftId, setBreakShiftId] = useState<string>("");
  const [breakSlots, setBreakSlots] = useState<Array<{ start_time: string; end_time: string }> | null>(null);
  const [breakSelected, setBreakSelected] = useState<{ start_time: string; end_time: string } | null>(null);

  /** 当日・店舗フィルタに合わせたシフト（休憩一覧用） */
  const [dayShiftsByStore, setDayShiftsByStore] = useState<Array<{ store_id: string; store_name: string; shifts: ShiftDto[] }> | null>(
    null
  );

  const selectedStoreName = useMemo(() => {
    if (selectedStoreId === "all") return "全店舗";
    return (stores ?? []).find((s) => s.id === selectedStoreId)?.name ?? "";
  }, [stores, selectedStoreId]);

  const theme = useMemo(() => {
    if (selectedStoreId === "all") return themeForStoreName("");
    return themeForStoreName(selectedStoreName);
  }, [selectedStoreId, selectedStoreName]);

  const todayYmd = useMemo(() => DateTime.now().setZone(TZ).toISODate()!, []);

  const refreshRows = async () => {
    const qs = new URLSearchParams();
    qs.set("month", monthKey);
    if (selectedStoreId !== "all") qs.set("store_id", selectedStoreId);
    const d = await apiGet<{ reservations: ReservationRow[] }>(`/api/booking-v2/reservations?${qs.toString()}`);
    setRows(d.reservations ?? []);
  };

  const loadDayShiftsForSelectedDate = useCallback(async () => {
    if (!selectedYmd || !stores || stores.length === 0) {
      setDayShiftsByStore(null);
      return;
    }
    const storeIds = selectedStoreId === "all" ? stores.map((s) => s.id) : [selectedStoreId];
    setDayShiftsByStore(null);
    try {
      const blocks = await Promise.all(
        storeIds.map(async (sid) => {
          const d = await apiGet<{ shifts: ShiftDto[] }>(
            `/api/admin/shifts/by-store-date?store_id=${encodeURIComponent(sid)}&date=${encodeURIComponent(selectedYmd)}`
          );
          const name = stores.find((s) => s.id === sid)?.name ?? sid;
          return { store_id: sid, store_name: name, shifts: d.shifts ?? [] };
        })
      );
      setDayShiftsByStore(blocks);
    } catch {
      setDayShiftsByStore([]);
    }
  }, [selectedYmd, selectedStoreId, stores]);

  useEffect(() => {
    void loadDayShiftsForSelectedDate();
  }, [loadDayShiftsForSelectedDate]);

  useEffect(() => {
    setErr(null);
    apiGet<{ stores: Store[] }>("/api/booking-v2/stores")
      .then((d) => setStores(d.stores ?? []))
      .catch((e: any) => setErr(String(e?.message ?? "店舗の取得に失敗しました")));
  }, []);

  useEffect(() => {
    setErr(null);
    setRows(null);
    const qs = new URLSearchParams();
    qs.set("month", monthKey);
    if (selectedStoreId !== "all") qs.set("store_id", selectedStoreId);
    apiGet<{ reservations: ReservationRow[] }>(`/api/booking-v2/reservations?${qs.toString()}`)
      .then((d) => setRows(d.reservations ?? []))
      .catch((e: any) => {
        setErr(String(e?.message ?? "取得に失敗しました"));
        setRows([]);
      });
  }, [monthKey, selectedStoreId]);

  // 休憩追加: 初期値（店舗/日付）
  useEffect(() => {
    if (!stores || stores.length === 0) return;
    const defaultStoreId = selectedStoreId !== "all" ? selectedStoreId : stores[0]?.id ?? "";
    if (!breakStoreId) setBreakStoreId(defaultStoreId);
  }, [stores, selectedStoreId, breakStoreId]);

  useEffect(() => {
    const d = selectedYmd ?? todayYmd;
    if (!breakDateYmd) setBreakDateYmd(d);
  }, [selectedYmd, todayYmd, breakDateYmd]);

  const openBreak = async () => {
    setBreakErr(null);
    setBreakOpen(true);
    setBreakSelected(null);
    setBreakSlots(null);
    setBreakShifts(null);
    setBreakShiftId("");
    setBusy(true);
    try {
      const d = await apiGet<{ shifts: ShiftDto[] }>(
        `/api/admin/shifts/by-store-date?store_id=${encodeURIComponent(breakStoreId)}&date=${encodeURIComponent(breakDateYmd)}`
      );
      const list = d.shifts ?? [];
      setBreakShifts(list);
      const first = list[0]?.id ?? "";
      setBreakShiftId(first);
    } catch (e: any) {
      setBreakErr(String(e?.message ?? "シフトの取得に失敗しました"));
      setBreakShifts([]);
    } finally {
      setBusy(false);
    }
  };

  function hhmmToMin(t: string): number {
    const s = String(t ?? "");
    const hh = Number(s.slice(0, 2));
    const mm = Number(s.slice(3, 5));
    if (!Number.isFinite(hh) || !Number.isFinite(mm)) return NaN;
    return hh * 60 + mm;
  }

  function minToHHMM(m: number): string {
    const hh = Math.floor(m / 60);
    const mm = m % 60;
    return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
  }

  const buildBreakSlots = (shift: ShiftDto | null): Array<{ start_time: string; end_time: string }> => {
    if (!shift) return [];
    const sm = hhmmToMin(shift.start_local);
    const em = hhmmToMin(shift.end_local);
    if (!Number.isFinite(sm) || !Number.isFinite(em) || em <= sm) return [];
    const SLOT = 30;
    const out: Array<{ start_time: string; end_time: string }> = [];
    for (let m = sm; m + SLOT <= em; m += SLOT) {
      out.push({ start_time: minToHHMM(m), end_time: minToHHMM(m + SLOT) });
    }
    return out;
  };

  useEffect(() => {
    if (!breakOpen) return;
    const shift = (breakShifts ?? []).find((s) => s.id === breakShiftId) ?? null;
    setBreakSelected(null);
    setBreakSlots(buildBreakSlots(shift));
  }, [breakOpen, breakShiftId, breakShifts]);

  const saveBreak = async () => {
    if (!breakShiftId || !breakSelected) {
      setBreakErr("休憩時間を選択してください");
      return;
    }
    setBreakErr(null);
    setBusy(true);
    try {
      await apiPost(`/api/shifts/${encodeURIComponent(breakShiftId)}/breaks`, breakSelected);
      setBreakOpen(false);
      // 枠の提案に影響するので、予約一覧も更新（任意）
      await refreshRows();
      await loadDayShiftsForSelectedDate();
    } catch (e: any) {
      setBreakErr(String(e?.message ?? "休憩の追加に失敗しました"));
    } finally {
      setBusy(false);
    }
  };

  // 追加: 初期値のセット
  useEffect(() => {
    if (!stores || stores.length === 0) return;
    const defaultStoreId = selectedStoreId !== "all" ? selectedStoreId : stores[0]?.id ?? "";
    if (!addStoreId) setAddStoreId(defaultStoreId);
    if (!editStoreId && editTarget) setEditStoreId(editTarget.store_id);
  }, [stores, selectedStoreId, addStoreId, editStoreId, editTarget]);

  useEffect(() => {
    const d = selectedYmd ?? todayYmd;
    if (!addDateYmd) setAddDateYmd(d);
  }, [selectedYmd, todayYmd, addDateYmd]);

  // 会員検索（追加用）
  useEffect(() => {
    if (!addOpen || addStep !== "member") return;
    setAddErr(null);
    const q = memberQuery.trim();
    const timer = setTimeout(() => {
      apiGet<{ members: MemberRow[] }>(`/api/admin/members/search?q=${encodeURIComponent(q)}&limit=20`)
        .then((d) => setMemberResults(d.members ?? []))
        .catch((e: any) => {
          setAddErr(String(e?.message ?? "会員検索に失敗しました"));
          setMemberResults([]);
        });
    }, 250);
    return () => clearTimeout(timer);
  }, [memberQuery, addOpen, addStep]);

  const openAdd = () => {
    setAddErr(null);
    setAddOpen(true);
    setAddStep("member");
    setMemberQuery("");
    setMemberResults(null);
    setSelectedMember(null);
    setAddSelectedSlot(null);
    setAddSlots(null);
    setAddSessionType("store");
    // store/date は既存stateを使う
  };

  const fetchSlots = async (storeId: string, dateYmd: string) => {
    const list = await apiGet<Array<{ start_at: string; end_at: string }>>(
      `/api/booking-v2/available-slots?store_id=${encodeURIComponent(storeId)}&date=${encodeURIComponent(dateYmd)}`
    );
    return list ?? [];
  };

  const startAddSlotStep = async () => {
    if (!selectedMember) {
      setAddErr("会員を選択してください");
      return;
    }
    if (!addStoreId || !addDateYmd) {
      setAddErr("店舗と日付を選択してください");
      return;
    }
    setAddErr(null);
    setBusy(true);
    setAddSlots(null);
    setAddSelectedSlot(null);
    try {
      const slots = await fetchSlots(addStoreId, addDateYmd);
      setAddSlots(slots);
      setAddStep("slot");
    } catch (e: any) {
      setAddErr(String(e?.message ?? "空き枠の取得に失敗しました"));
      setAddSlots([]);
    } finally {
      setBusy(false);
    }
  };

  const confirmAdd = async () => {
    if (!selectedMember || !addSelectedSlot) {
      setAddErr("会員と時間を選択してください");
      return;
    }
    setAddErr(null);
    setBusy(true);
    try {
      await apiPost("/api/admin/reservations", {
        store_id: addStoreId,
        member_id: selectedMember.id,
        start_at: addSelectedSlot.start_at,
        end_at: addSelectedSlot.end_at,
        session_type: addSessionType,
      });
      await refreshRows();
      setAddOpen(false);
    } catch (e: any) {
      setAddErr(String(e?.message ?? "予約追加に失敗しました"));
    } finally {
      setBusy(false);
    }
  };

  const openEdit = async (r: ReservationRow) => {
    setEditErr(null);
    setEditTarget(r);
    const ymd = DateTime.fromISO(r.start_at).setZone(TZ).toISODate()!;
    setEditDateYmd(ymd);
    setEditStoreId(r.store_id);
    setEditSlots(null);
    setEditSelectedSlot(null);
    setBusy(true);
    try {
      const slots = await fetchSlots(r.store_id, ymd);
      setEditSlots(slots);
    } catch (e: any) {
      setEditErr(String(e?.message ?? "空き枠の取得に失敗しました"));
      setEditSlots([]);
    } finally {
      setBusy(false);
    }
  };

  const refetchEditSlots = async () => {
    if (!editTarget) return;
    if (!editStoreId || !editDateYmd) return;
    setEditErr(null);
    setBusy(true);
    setEditSlots(null);
    setEditSelectedSlot(null);
    try {
      const slots = await fetchSlots(editStoreId, editDateYmd);
      setEditSlots(slots);
    } catch (e: any) {
      setEditErr(String(e?.message ?? "空き枠の取得に失敗しました"));
      setEditSlots([]);
    } finally {
      setBusy(false);
    }
  };

  const confirmEdit = async () => {
    if (!editTarget || !editSelectedSlot) {
      setEditErr("変更先の時間を選択してください");
      return;
    }
    setEditErr(null);
    setBusy(true);
    try {
      await apiPatch(`/api/admin/reservations/${editTarget.id}`, {
        action: "reschedule",
        store_id: editStoreId,
        start_at: editSelectedSlot.start_at,
        end_at: editSelectedSlot.end_at,
      });
      await refreshRows();
      setEditTarget(null);
    } catch (e: any) {
      setEditErr(String(e?.message ?? "予約変更に失敗しました"));
    } finally {
      setBusy(false);
    }
  };

  const confirmCancel = async () => {
    if (!cancelTarget) return;
    setCancelErr(null);
    setBusy(true);
    try {
      await apiPatch(`/api/admin/reservations/${cancelTarget.id}`, { action: "cancel" });
      await refreshRows();
      setCancelTarget(null);
    } catch (e: any) {
      setCancelErr(String(e?.message ?? "キャンセルに失敗しました"));
    } finally {
      setBusy(false);
    }
  };

  const countsByYmd = useMemo(() => {
    const m = new Map<
      string,
      {
        store: number;
        online: number;
        total: number;
        byStore: Map<string, { store: number; online: number; total: number }>;
      }
    >();
    for (const r of rows ?? []) {
      const ymd = DateTime.fromISO(r.start_at).setZone(TZ).toISODate();
      if (!ymd) continue;
      const cur =
        m.get(ymd) ??
        ({
          store: 0,
          online: 0,
          total: 0,
          byStore: new Map(),
        });

      const st = String(r.session_type ?? "store");
      if (st === "online") cur.online += 1;
      else cur.store += 1;
      cur.total += 1;

      const sid = String(r.store_id ?? "");
      if (sid) {
        const prev = cur.byStore.get(sid) ?? { store: 0, online: 0, total: 0 };
        if (st === "online") prev.online += 1;
        else prev.store += 1;
        prev.total += 1;
        cur.byStore.set(sid, prev);
      }

      m.set(ymd, cur);
    }
    return m;
  }, [rows]);

  const selectedDayRows = useMemo(() => {
    if (!selectedYmd) return [];
    const list = (rows ?? []).filter((r) => DateTime.fromISO(r.start_at).setZone(TZ).toISODate() === selectedYmd);
    return list.sort((a, b) => DateTime.fromISO(a.start_at).toMillis() - DateTime.fromISO(b.start_at).toMillis());
  }, [rows, selectedYmd]);

  const breakDisplayLines = useMemo(() => {
    if (!dayShiftsByStore || dayShiftsByStore.length === 0) return [];
    const lines: { key: string; sort: string; text: string }[] = [];
    for (const block of dayShiftsByStore) {
      for (const sh of block.shifts) {
        for (const br of sh.breaks ?? []) {
          lines.push({
            key: `${block.store_id}-${sh.id}-${br.id}`,
            sort: `${br.start_time}-${block.store_id}-${sh.trainer_id}`,
            text:
              selectedStoreId === "all"
                ? `${block.store_name} · ${sh.trainer_name || sh.trainer_id} ${br.start_time}〜${br.end_time}`
                : `${sh.trainer_name || sh.trainer_id} ${br.start_time}〜${br.end_time}`,
          });
        }
      }
    }
    lines.sort((a, b) => a.sort.localeCompare(b.sort, "en"));
    return lines;
  }, [dayShiftsByStore, selectedStoreId]);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="text-xs text-slate-500">
          表示月: <span className="font-mono">{monthKey}</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50"
            onClick={() => {
              setMonth((m) => m.minus({ months: 1 }).startOf("month"));
              setSelectedYmd(null);
            }}
          >
            前月
          </button>
          <button
            type="button"
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50"
            onClick={() => {
              setMonth((m) => m.plus({ months: 1 }).startOf("month"));
              setSelectedYmd(null);
            }}
          >
            次月
          </button>
        </div>
      </div>

      <div className="flex gap-2 overflow-x-auto pb-1">
        <button
          type="button"
          onClick={() => {
            setSelectedStoreId("all");
            setSelectedYmd(null);
          }}
          className={[
            "shrink-0 rounded-full border px-4 py-2 text-sm font-semibold transition-colors",
            selectedStoreId === "all" ? "text-slate-900" : "bg-white text-slate-700 hover:bg-slate-50",
          ].join(" ")}
          style={
            selectedStoreId === "all"
              ? {
                  borderColor: "#CBD5E1",
                  background: "#F8FAFC",
                  boxShadow: "inset 0 0 0 1px #CBD5E1",
                }
              : { borderColor: "#E5E7EB" }
          }
        >
          全店舗
        </button>
        {(stores ?? []).map((s) => {
          const active = s.id === selectedStoreId;
          const t = themeForStoreName(s.name);
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => {
                setSelectedStoreId(s.id);
                setSelectedYmd(null);
              }}
              className={[
                "shrink-0 rounded-full border px-4 py-2 text-sm font-semibold transition-colors",
                active ? "text-slate-900" : "bg-white text-slate-700 hover:bg-slate-50",
              ].join(" ")}
              style={
                active
                  ? { borderColor: t.accentBorder, background: t.accentSoft, boxShadow: `inset 0 0 0 1px ${t.accentBorder}` }
                  : { borderColor: "#E5E7EB" }
              }
            >
              {s.name}
            </button>
          );
        })}
        {stores === null ? <div className="text-sm text-slate-600">店舗読み込み中…</div> : null}
      </div>

      {err ? <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{err}</div> : null}

      <section
        className="rounded-2xl border bg-white p-4 shadow-sm"
        style={{ borderColor: theme.accentBorder, background: theme.accentSoft }}
      >
        <div className="flex items-center justify-between">
          <div className="text-sm font-bold text-slate-900">{month.toFormat("yyyy年M月")}</div>
          <div className="text-xs text-slate-600">タップで当日の予約を表示</div>
        </div>

        <div className="mt-3 grid grid-cols-7 gap-1 text-center text-xs text-slate-500">
          {["日", "月", "火", "水", "木", "金", "土"].map((w) => (
            <div key={w} className="py-1">
              {w}
            </div>
          ))}
        </div>

        <div className="mt-1 grid grid-cols-7 gap-1">
          {(() => {
            const first = month.startOf("month");
            const startDow = first.weekday % 7; // 0=Sun
            const daysInMonth = month.daysInMonth ?? 31;
            const cells = 42;
            return Array.from({ length: cells }, (_, idx) => {
              const dayNum = idx - startDow + 1;
              const inMonth = dayNum >= 1 && dayNum <= daysInMonth;
              const ymd = inMonth ? month.set({ day: dayNum }).toISODate()! : "";
              const meta = ymd ? countsByYmd.get(ymd) : undefined;
              const selected = ymd && selectedYmd === ymd;
              const isPast = ymd ? ymd < todayYmd : false;
              const topStores =
                meta && selectedStoreId === "all"
                  ? Array.from(meta.byStore.entries())
                      .map(([storeId, v]) => ({ storeId, ...v }))
                      .sort((a, b) => b.total - a.total)
                      .slice(0, 3)
                  : [];

              return (
                <button
                  key={idx}
                  type="button"
                  disabled={!inMonth || !ymd}
                  onClick={() => {
                    if (!ymd) return;
                    setSelectedYmd(ymd);
                  }}
                  className={[
                    "aspect-square rounded-xl border p-2 text-left transition-colors",
                    !inMonth ? "border-transparent bg-transparent" : "border-slate-200 bg-white",
                    inMonth && isPast ? "opacity-55" : "",
                    inMonth ? "hover:bg-white" : "",
                  ].join(" ")}
                  style={
                    selected
                      ? { borderColor: theme.accent, boxShadow: `0 0 0 2px ${theme.accent}33` }
                      : { borderColor: "#E5E7EB" }
                  }
                >
                  {inMonth ? (
                    <div className="h-full flex flex-col justify-between">
                      <div className="text-sm font-semibold text-slate-900">{dayNum}</div>
                      <div className="flex items-center justify-between gap-1 pt-1">
                        <div className="flex items-center gap-1">
                          {selectedStoreId === "all" ? (
                            <>
                              {topStores.map((x) => {
                                const t = themeForStoreId(stores, x.storeId).accent;
                                return (
                                  <span
                                    key={x.storeId}
                                    className="inline-block h-2 w-2 rounded-full"
                                    style={{ background: t, opacity: x.total > 0 ? 1 : 0.15 }}
                                    title="店舗別件数（色=店舗）"
                                  />
                                );
                              })}
                              <span
                                className="inline-block h-2 w-2 rounded-full"
                                style={{ background: "#22C55E", opacity: (meta?.store ?? 0) > 0 ? 1 : 0.15 }}
                                title="店舗セッション合計"
                              />
                              <span
                                className="inline-block h-2 w-2 rounded-full"
                                style={{ background: "#A855F7", opacity: (meta?.online ?? 0) > 0 ? 1 : 0.15 }}
                                title="オンライン合計"
                              />
                            </>
                          ) : (
                            <>
                              <span
                                className="inline-block h-2 w-2 rounded-full"
                                style={{ background: "#22C55E", opacity: (meta?.store ?? 0) > 0 ? 1 : 0.15 }}
                                title="店舗"
                              />
                              <span
                                className="inline-block h-2 w-2 rounded-full"
                                style={{ background: "#A855F7", opacity: (meta?.online ?? 0) > 0 ? 1 : 0.15 }}
                                title="オンライン"
                              />
                            </>
                          )}
                        </div>
                        <div className="text-[11px] font-semibold text-slate-600">{meta?.total ? meta.total : ""}</div>
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

        <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-slate-600">
          {selectedStoreId === "all" ? (
            <div className="text-slate-600">
              先頭の色ドットは「その日に予約がある店舗（上位3店舗）」です（色は店舗ごと）。
            </div>
          ) : null}
          <div className="flex items-center gap-2">
            <span className="inline-block h-2 w-2 rounded-full" style={{ background: "#22C55E" }} />
            店舗セッション件数
          </div>
          <div className="flex items-center gap-2">
            <span className="inline-block h-2 w-2 rounded-full" style={{ background: "#A855F7" }} />
            オンライン件数
          </div>
        </div>
      </section>

      {!selectedYmd ? (
        <div className="text-sm text-slate-600">カレンダーの日付をタップすると、その日の予約一覧が表示されます。</div>
      ) : (
        <section className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <div className="text-sm font-bold text-slate-900">
              {DateTime.fromISO(selectedYmd, { zone: TZ }).toFormat("M/d（ccc）")} の予約
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={openBreak}
                className="inline-flex min-h-[40px] items-center justify-center rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-800 hover:bg-slate-50"
                disabled={busy || selectedStoreId === "all"}
                title={selectedStoreId === "all" ? "休憩追加は店舗を選択してから実行してください" : ""}
              >
                ＋ 休憩追加
              </button>
              <button
                type="button"
                onClick={openAdd}
                className="inline-flex min-h-[40px] items-center justify-center rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-800 hover:bg-slate-50"
              >
                ＋ 予約追加
              </button>
            </div>
          </div>

          {dayShiftsByStore === null ? (
            <div className="text-xs text-slate-500">休憩情報を読み込み中…</div>
          ) : breakDisplayLines.length > 0 ? (
            <div className="rounded-2xl border border-amber-200 bg-amber-50/90 px-4 py-3 shadow-sm">
              <div className="text-xs font-bold text-amber-950">トレーナー休憩</div>
              <ul className="mt-2 space-y-1.5 text-sm text-amber-950">
                {breakDisplayLines.map((line) => (
                  <li key={line.key} className="pl-1">
                    {line.text}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {rows === null ? <div className="text-sm text-slate-600">読み込み中…</div> : null}
          {rows !== null && selectedDayRows.length === 0 ? (
            <div className="text-sm text-slate-600">この日の予約はありません。</div>
          ) : null}

          <div className="grid gap-2">
            {selectedDayRows.map((r) => {
              const sa = reservationAccent(stores, r);
              const trainerText =
                r.trainer_name ||
                (r.trainer_candidates && r.trainer_candidates.length > 0 ? `候補: ${r.trainer_candidates.join(" / ")}` : "-");
              return (
                <div
                  key={r.id}
                  className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
                  style={{ borderLeftWidth: 6, borderLeftColor: sa.border, background: sa.soft }}
                >
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <div className="text-sm font-bold text-slate-900">
                        {DateTime.fromISO(r.start_at).setZone(TZ).toFormat("HH:mm")}〜
                        {DateTime.fromISO(r.end_at).setZone(TZ).toFormat("HH:mm")}
                      </div>
                      <div className="mt-1 text-xs font-semibold text-slate-700">{sessionTypeBadge(r.session_type)}</div>
                      <div className="mt-1 text-xs text-slate-500">
                        トレーナー: {trainerText} / 店舗: {r.store_name || r.store_id}
                      </div>
                      <div className="mt-1 text-xs text-slate-500">
                        会員: {r.member_code || r.member_id}
                        {r.member_name ? `（${r.member_name}）` : ""}
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => openEdit(r)}
                        className="inline-flex min-h-[40px] items-center justify-center rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-800 hover:bg-slate-50"
                        disabled={busy}
                      >
                        予約変更
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setCancelErr(null);
                          setCancelTarget(r);
                        }}
                        className="inline-flex min-h-[40px] items-center justify-center rounded-xl border border-red-200 bg-white px-4 text-sm font-semibold text-red-700 hover:bg-red-50"
                        disabled={busy}
                      >
                        キャンセル
                      </button>
                      <a
                        href={`/admin/dashboard/members/${r.member_id}`}
                        className="inline-flex min-h-[40px] items-center justify-center rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-800 hover:bg-slate-50"
                      >
                        カルテを見る
                      </a>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* 予約追加モーダル */}
      {addOpen ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center">
          <div className="w-full max-w-2xl rounded-2xl bg-white p-5 shadow-lg">
            <div className="flex items-center justify-between gap-3">
              <div className="text-sm font-bold text-slate-900">予約追加</div>
              <button
                type="button"
                className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50"
                onClick={() => setAddOpen(false)}
                disabled={busy}
              >
                閉じる
              </button>
            </div>

            {addErr ? <div className="mt-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{addErr}</div> : null}

            <div className="mt-4">
              <div className="text-xs font-semibold text-slate-700">ステップ</div>
              <div className="mt-1 text-sm text-slate-800">
                {addStep === "member" ? "会員選択" : addStep === "slot" ? "店舗・日時選択" : "確認"}
              </div>
            </div>

            {addStep === "member" ? (
              <div className="mt-4 space-y-3">
                <div>
                  <div className="text-xs font-semibold text-slate-700">会員検索</div>
                  <input
                    value={memberQuery}
                    onChange={(e) => setMemberQuery(e.target.value)}
                    placeholder="会員番号 / 氏名 / メール"
                    className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-[16px] outline-none focus:border-slate-400"
                  />
                </div>

                <div className="rounded-xl border border-slate-200 bg-slate-50 p-2">
                  {memberResults === null ? (
                    <div className="px-2 py-3 text-sm text-slate-600">検索ワードを入力してください（未入力でも一覧が出ます）</div>
                  ) : memberResults.length === 0 ? (
                    <div className="px-2 py-3 text-sm text-slate-600">該当する会員がいません。</div>
                  ) : (
                    <div className="max-h-[320px] overflow-auto">
                      {memberResults.map((m) => {
                        const active = selectedMember?.id === m.id;
                        return (
                          <button
                            key={m.id}
                            type="button"
                            onClick={() => {
                              setSelectedMember(m);
                              setAddErr(null);
                            }}
                            className={[
                              "w-full rounded-xl border px-3 py-3 text-left transition-colors",
                              active ? "border-slate-400 bg-white" : "border-transparent bg-transparent hover:bg-white",
                            ].join(" ")}
                          >
                            <div className="text-sm font-semibold text-slate-900">
                              {m.member_code} {m.name ? `（${m.name}）` : ""}
                            </div>
                            <div className="mt-1 text-xs text-slate-500 break-all">{m.email ?? ""}</div>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>

                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={startAddSlotStep}
                    className="inline-flex min-h-[40px] items-center justify-center rounded-xl border border-slate-200 bg-slate-900 px-4 text-sm font-semibold text-white hover:bg-slate-800"
                    disabled={busy || !selectedMember}
                  >
                    次へ
                  </button>
                </div>
              </div>
            ) : null}

            {addStep === "slot" ? (
              <div className="mt-4 space-y-3">
                <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                  <div className="text-xs font-semibold text-slate-700">会員</div>
                  <div className="text-sm text-slate-900">
                    {selectedMember?.member_code} {selectedMember?.name ? `（${selectedMember.name}）` : ""}
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-3">
                  <div>
                    <div className="text-xs font-semibold text-slate-700">店舗</div>
                    <select
                      value={addStoreId}
                      onChange={(e) => setAddStoreId(e.target.value)}
                      className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-3 text-[16px]"
                    >
                      {(stores ?? []).map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <div className="text-xs font-semibold text-slate-700">日付</div>
                    <input
                      type="date"
                      value={addDateYmd}
                      onChange={(e) => setAddDateYmd(e.target.value)}
                      className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-3 text-[16px]"
                    />
                  </div>
                  <div>
                    <div className="text-xs font-semibold text-slate-700">セッション種別</div>
                    <select
                      value={addSessionType}
                      onChange={(e) => setAddSessionType((e.target.value as any) === "online" ? "online" : "store")}
                      className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-3 text-[16px]"
                    >
                      <option value="store">🏠 店舗</option>
                      <option value="online">💻 オンライン</option>
                    </select>
                  </div>
                </div>

                <div className="flex items-center justify-between gap-2">
                  <div className="text-xs text-slate-600">空き時間をタップしてください（30分）</div>
                  <button
                    type="button"
                    onClick={async () => {
                      setAddErr(null);
                      setBusy(true);
                      setAddSlots(null);
                      setAddSelectedSlot(null);
                      try {
                        const slots = await fetchSlots(addStoreId, addDateYmd);
                        setAddSlots(slots);
                      } catch (e: any) {
                        setAddErr(String(e?.message ?? "空き枠の取得に失敗しました"));
                        setAddSlots([]);
                      } finally {
                        setBusy(false);
                      }
                    }}
                    className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50"
                    disabled={busy}
                  >
                    再取得
                  </button>
                </div>

                <div className="rounded-xl border border-slate-200 bg-white p-3">
                  {addSlots === null ? (
                    <div className="text-sm text-slate-600">読み込み中…</div>
                  ) : addSlots.length === 0 ? (
                    <div className="text-sm text-slate-600">空き枠がありません。</div>
                  ) : (
                    <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                      {addSlots.map((s) => {
                        const start = DateTime.fromISO(s.start_at).setZone(TZ).toFormat("HH:mm");
                        const end = DateTime.fromISO(s.end_at).setZone(TZ).toFormat("HH:mm");
                        const active = addSelectedSlot?.start_at === s.start_at && addSelectedSlot?.end_at === s.end_at;
                        return (
                          <button
                            key={`${s.start_at}|${s.end_at}`}
                            type="button"
                            onClick={() => {
                              setAddSelectedSlot(s);
                              setAddStep("confirm");
                              setAddErr(null);
                            }}
                            className={[
                              "rounded-xl border px-3 py-3 text-sm font-semibold",
                              active ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-900 hover:bg-slate-50",
                            ].join(" ")}
                          >
                            {start}〜{end}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>

                <div className="flex justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setAddStep("member");
                      setAddErr(null);
                    }}
                    className="inline-flex min-h-[40px] items-center justify-center rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-800 hover:bg-slate-50"
                    disabled={busy}
                  >
                    戻る
                  </button>
                </div>
              </div>
            ) : null}

            {addStep === "confirm" ? (
              <div className="mt-4 space-y-3">
                <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                  <div className="text-xs font-semibold text-slate-700">この内容で予約を確定しますか？</div>
                  <div className="mt-2 text-sm text-slate-900">
                    <div>店舗：{(stores ?? []).find((s) => s.id === addStoreId)?.name ?? addStoreId}</div>
                    <div>
                      日時：
                      {addSelectedSlot
                        ? `${DateTime.fromISO(addSelectedSlot.start_at).setZone(TZ).toFormat("M/d（ccc） HH:mm")}〜${DateTime.fromISO(addSelectedSlot.end_at)
                            .setZone(TZ)
                            .toFormat("HH:mm")}`
                        : ""}
                    </div>
                    <div>
                      会員：{selectedMember?.member_code} {selectedMember?.name ? `（${selectedMember.name}）` : ""}
                    </div>
                    <div>セッション種別：{addSessionType === "online" ? "オンライン" : "店舗"}</div>
                  </div>
                  <div className="mt-2 text-xs text-slate-600">確定後、LINE連携済みの会員には確定LINEを送信します。</div>
                </div>

                <div className="flex justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setAddStep("slot");
                      setAddErr(null);
                    }}
                    className="inline-flex min-h-[40px] items-center justify-center rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-800 hover:bg-slate-50"
                    disabled={busy}
                  >
                    戻る
                  </button>
                  <button
                    type="button"
                    onClick={confirmAdd}
                    className="inline-flex min-h-[40px] items-center justify-center rounded-xl border border-slate-200 bg-slate-900 px-4 text-sm font-semibold text-white hover:bg-slate-800"
                    disabled={busy}
                  >
                    確定
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {/* 予約変更モーダル */}
      {editTarget ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center">
          <div className="w-full max-w-2xl rounded-2xl bg-white p-5 shadow-lg">
            <div className="flex items-center justify-between gap-3">
              <div className="text-sm font-bold text-slate-900">予約変更</div>
              <button
                type="button"
                className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50"
                onClick={() => setEditTarget(null)}
                disabled={busy}
              >
                閉じる
              </button>
            </div>

            {editErr ? <div className="mt-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{editErr}</div> : null}

            <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
              <div className="text-xs font-semibold text-slate-700">現在の予約</div>
              <div className="mt-1 text-sm text-slate-900">
                <div>店舗：{editTarget.store_name || editTarget.store_id}</div>
                <div>
                  日時：
                  {DateTime.fromISO(editTarget.start_at).setZone(TZ).toFormat("M/d（ccc） HH:mm")}〜
                  {DateTime.fromISO(editTarget.end_at).setZone(TZ).toFormat("HH:mm")}
                </div>
                <div>
                  会員：{editTarget.member_code || editTarget.member_id}
                  {editTarget.member_name ? `（${editTarget.member_name}）` : ""}
                </div>
              </div>
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <div>
                <div className="text-xs font-semibold text-slate-700">店舗</div>
                <select
                  value={editStoreId}
                  onChange={(e) => setEditStoreId(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-3 text-[16px]"
                  disabled={busy}
                >
                  {(stores ?? []).map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <div className="text-xs font-semibold text-slate-700">日付</div>
                <input
                  type="date"
                  value={editDateYmd}
                  onChange={(e) => setEditDateYmd(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-3 text-[16px]"
                  disabled={busy}
                />
              </div>
            </div>

            <div className="mt-3 flex items-center justify-between gap-2">
              <div className="text-xs text-slate-600">その日の空き時間をタップしてください</div>
              <button
                type="button"
                onClick={refetchEditSlots}
                className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50"
                disabled={busy}
              >
                空き枠を取得
              </button>
            </div>

            <div className="mt-3 rounded-xl border border-slate-200 bg-white p-3">
              {editSlots === null ? (
                <div className="text-sm text-slate-600">読み込み中…</div>
              ) : editSlots.length === 0 ? (
                <div className="text-sm text-slate-600">空き枠がありません。</div>
              ) : (
                <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                  {editSlots.map((s) => {
                    const start = DateTime.fromISO(s.start_at).setZone(TZ).toFormat("HH:mm");
                    const end = DateTime.fromISO(s.end_at).setZone(TZ).toFormat("HH:mm");
                    const active = editSelectedSlot?.start_at === s.start_at && editSelectedSlot?.end_at === s.end_at;
                    return (
                      <button
                        key={`${s.start_at}|${s.end_at}`}
                        type="button"
                        onClick={() => setEditSelectedSlot(s)}
                        className={[
                          "rounded-xl border px-3 py-3 text-sm font-semibold",
                          active ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-900 hover:bg-slate-50",
                        ].join(" ")}
                      >
                        {start}〜{end}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
              <div className="text-xs font-semibold text-slate-700">確認</div>
              <div className="mt-1 text-sm text-slate-900">
                <div>店舗：{(stores ?? []).find((s) => s.id === editStoreId)?.name ?? editStoreId}</div>
                <div>
                  時間：
                  {editSelectedSlot
                    ? `${DateTime.fromISO(editSelectedSlot.start_at).setZone(TZ).toFormat("M/d（ccc） HH:mm")}〜${DateTime.fromISO(editSelectedSlot.end_at)
                        .setZone(TZ)
                        .toFormat("HH:mm")}`
                    : "未選択"}
                </div>
                <div>
                  会員：{editTarget.member_code || editTarget.member_id}
                  {editTarget.member_name ? `（${editTarget.member_name}）` : ""}
                </div>
              </div>
              <div className="mt-2 text-xs text-slate-600">確定後、LINE連携済みの会員には変更LINEを送信します。</div>
            </div>

            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={confirmEdit}
                className="inline-flex min-h-[40px] items-center justify-center rounded-xl border border-slate-200 bg-slate-900 px-4 text-sm font-semibold text-white hover:bg-slate-800"
                disabled={busy || !editSelectedSlot}
              >
                この時間に変更しますか？ → 確定
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* キャンセルモーダル */}
      {cancelTarget ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center">
          <div className="w-full max-w-lg rounded-2xl bg-white p-5 shadow-lg space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div className="text-sm font-bold text-slate-900">予約のキャンセル</div>
              <button
                type="button"
                className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50"
                onClick={() => setCancelTarget(null)}
                disabled={busy}
              >
                閉じる
              </button>
            </div>

            <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
              <div className="text-xs font-semibold text-slate-700">店舗</div>
              <div className="text-sm text-slate-900">{cancelTarget.store_name || cancelTarget.store_id}</div>
              <div className="mt-2 text-xs font-semibold text-slate-700">日時</div>
              <div className="text-sm text-slate-900">
                {DateTime.fromISO(cancelTarget.start_at).setZone(TZ).toFormat("M/d（ccc）")}{" "}
                {DateTime.fromISO(cancelTarget.start_at).setZone(TZ).toFormat("HH:mm")}〜
                {DateTime.fromISO(cancelTarget.end_at).setZone(TZ).toFormat("HH:mm")}
              </div>
              <div className="mt-2 text-xs font-semibold text-slate-700">会員</div>
              <div className="text-sm text-slate-900">
                {cancelTarget.member_code || cancelTarget.member_id}
                {cancelTarget.member_name ? `（${cancelTarget.member_name}）` : ""}
              </div>
              <div className="mt-2 text-xs text-slate-600">この予約をキャンセルしますか？</div>
            </div>

            {cancelErr ? <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{cancelErr}</div> : null}

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setCancelTarget(null)}
                className="inline-flex min-h-[40px] items-center justify-center rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-800 hover:bg-slate-50"
                disabled={busy}
              >
                やめる
              </button>
              <button
                type="button"
                onClick={confirmCancel}
                className="inline-flex min-h-[40px] items-center justify-center rounded-xl border border-red-200 bg-red-600 px-4 text-sm font-semibold text-white hover:bg-red-700"
                disabled={busy}
              >
                キャンセル確定
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* 休憩追加モーダル */}
      {breakOpen ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center">
          <div className="w-full max-w-2xl rounded-2xl bg-white p-5 shadow-lg space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div className="text-sm font-bold text-slate-900">休憩追加（30分）</div>
              <button
                type="button"
                className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50"
                onClick={() => setBreakOpen(false)}
                disabled={busy}
              >
                閉じる
              </button>
            </div>

            {breakErr ? <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{breakErr}</div> : null}

            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <div className="text-xs font-semibold text-slate-700">店舗</div>
                <select
                  value={breakStoreId}
                  onChange={(e) => setBreakStoreId(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-3 text-[16px]"
                  disabled={busy}
                >
                  {(stores ?? []).map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <div className="text-xs font-semibold text-slate-700">日付</div>
                <input
                  type="date"
                  value={breakDateYmd}
                  onChange={(e) => setBreakDateYmd(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-3 text-[16px]"
                  disabled={busy}
                />
              </div>
              <div className="flex items-end">
                <button
                  type="button"
                  onClick={openBreak}
                  className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-60"
                  disabled={busy}
                >
                  シフト再取得
                </button>
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 space-y-2">
              <div className="text-xs font-semibold text-slate-700">トレーナー（出勤シフト）</div>
              {breakShifts === null ? <div className="text-sm text-slate-600">読み込み中…</div> : null}
              {breakShifts !== null && breakShifts.length === 0 ? (
                <div className="text-sm text-slate-600">この日のシフトがありません。</div>
              ) : null}
              {breakShifts && breakShifts.length > 0 ? (
                <select
                  value={breakShiftId}
                  onChange={(e) => setBreakShiftId(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-3 text-[16px]"
                  disabled={busy}
                >
                  {breakShifts.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.trainer_name || s.trainer_id}（{String(s.start_local).slice(0, 5)}〜{String(s.end_local).slice(0, 5)}）
                    </option>
                  ))}
                </select>
              ) : null}
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-3">
              <div className="text-xs text-slate-600">休憩時間（30分）をタップしてください</div>
              {breakSlots === null ? <div className="text-sm text-slate-600">候補を生成中…</div> : null}
              {breakSlots !== null && breakSlots.length === 0 ? (
                <div className="text-sm text-slate-600">候補がありません。</div>
              ) : null}
              {breakSlots && breakSlots.length > 0 ? (
                <div className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-4">
                  {breakSlots.map((s) => {
                    const active = breakSelected?.start_time === s.start_time && breakSelected?.end_time === s.end_time;
                    return (
                      <button
                        key={`${s.start_time}|${s.end_time}`}
                        type="button"
                        onClick={() => setBreakSelected(s)}
                        className={[
                          "rounded-xl border px-3 py-3 text-sm font-semibold",
                          active ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-900 hover:bg-slate-50",
                        ].join(" ")}
                      >
                        {s.start_time}〜{s.end_time}
                      </button>
                    );
                  })}
                </div>
              ) : null}
            </div>

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={saveBreak}
                disabled={busy || !breakSelected}
                className="rounded-xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white disabled:opacity-60"
              >
                {busy ? "保存中…" : "休憩を追加する"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
