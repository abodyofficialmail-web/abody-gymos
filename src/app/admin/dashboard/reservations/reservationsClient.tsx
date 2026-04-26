"use client";

import { DateTime } from "luxon";
import { useEffect, useMemo, useState } from "react";

const TZ = "Asia/Tokyo";

type Store = { id: string; name: string };

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
  // 店舗セッションは店舗色（要望: 恵比寿=青、桜木町=青、上野=緑）
  const storeName = (stores ?? []).find((s) => s.id === r.store_id)?.name ?? r.store_name ?? "";
  if (storeName === "上野") return { border: "#16A34A", soft: "#ECFDF5" };
  // 恵比寿/桜木町は青
  return { border: "#2563EB", soft: "#EFF6FF" };
}

async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(path, { cache: "no-store" });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((json as any)?.error ?? "取得に失敗しました");
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

  const selectedStoreName = useMemo(() => {
    if (selectedStoreId === "all") return "全店舗";
    return (stores ?? []).find((s) => s.id === selectedStoreId)?.name ?? "";
  }, [stores, selectedStoreId]);

  const theme = useMemo(() => {
    if (selectedStoreId === "all") return themeForStoreName("");
    return themeForStoreName(selectedStoreName);
  }, [selectedStoreId, selectedStoreName]);

  const todayYmd = useMemo(() => DateTime.now().setZone(TZ).toISODate()!, []);

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
          <div className="text-sm font-bold text-slate-900">
            {DateTime.fromISO(selectedYmd, { zone: TZ }).toFormat("M/d（ccc）")} の予約
          </div>

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
                    <a
                      href={`/admin/dashboard/members/${r.member_id}`}
                      className="inline-flex min-h-[40px] items-center justify-center rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-800 hover:bg-slate-50"
                    >
                      カルテを見る
                    </a>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
