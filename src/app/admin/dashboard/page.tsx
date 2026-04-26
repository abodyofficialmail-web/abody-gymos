"use client";

import Link from "next/link";
import { DateTime } from "luxon";
import { useEffect, useMemo, useState } from "react";
import { GymShell } from "@/components/gym/GymShell";

type Store = { id: string; name: string };
type ReservationRow = {
  id: string;
  store_id: string;
  store_name?: string;
  trainer_id: string | null;
  trainer_name?: string;
  member_id: string;
  member_code?: string;
  start_at: string;
  end_at: string;
  status: string;
  created_at: string;
};

async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(path, { cache: "no-store" });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((json as any)?.error ?? "取得に失敗しました");
  return json as T;
}

export default function AdminDashboardTopPage() {
  const kpiCards = [
    { label: "今日の予約数", value: "—" },
    { label: "今月の予約数", value: "—" },
    { label: "トレーナー数", value: "—" },
  ];

  const month = useMemo(() => DateTime.now().setZone("Asia/Tokyo").toFormat("yyyy-MM"), []);
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);

  const [stores, setStores] = useState<Store[] | null>(null);
  const [storeId, setStoreId] = useState("");
  const [rows, setRows] = useState<ReservationRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setErr(null);
    apiGet<{ stores: Store[] }>("/api/booking-v2/stores")
      .then((d) => setStores(d.stores ?? []))
      .catch((e: any) => {
        setErr(String(e?.message ?? "店舗の取得に失敗しました"));
        setStores([]);
      });
  }, []);

  useEffect(() => {
    if (stores && !storeId) setStoreId(stores[0]?.id ?? "");
  }, [stores, storeId]);

  useEffect(() => {
    setErr(null);
    apiGet<{ reservations: ReservationRow[] }>(`/api/booking-v2/reservations?month=${encodeURIComponent(month)}`)
      .then((d) => setRows(d.reservations ?? []))
      .catch((e: any) => {
        setErr(String(e?.message ?? "予約の取得に失敗しました"));
        setRows([]);
      });
  }, [month]);

  const todayRows = useMemo(() => {
    const list = rows ?? [];
    const filtered = list.filter((r) => r.start_at.startsWith(today) && (!storeId || r.store_id === storeId));
    filtered.sort((a, b) => a.start_at.localeCompare(b.start_at));
    return filtered;
  }, [rows, today, storeId]);

  const navCards = [
    { href: "/admin/dashboard/shifts", label: "シフト作成", icon: "📅" },
    { href: "/admin/dashboard/trainers", label: "トレーナー一覧", icon: "👤" },
    { href: "/admin/dashboard/reservations", label: "予約一覧", icon: "🕒" },
    { href: "/admin/dashboard/members", label: "会員カルテ", icon: "🗂" },
    { href: "/admin/dashboard/today", label: "本日の予約", icon: "🧾" },
  ];

  return (
    <GymShell title="管理ダッシュボード" nav={[]}>
      <div className="space-y-4">
        <section className="rounded-xl bg-white p-6 shadow-md space-y-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <div className="text-sm font-bold text-slate-900">本日の予約</div>
              <div className="text-xs text-slate-500">{today}</div>
            </div>
            <label className="text-sm font-medium text-slate-700">
              店舗
              <select
                value={storeId}
                onChange={(e) => setStoreId(e.target.value)}
                className="mt-1 w-full min-h-[44px] rounded-xl border border-slate-200 bg-white px-3 text-sm"
              >
                {(stores ?? []).map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {err ? <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{err}</div> : null}

          {rows === null ? <div className="text-sm text-slate-600">読み込み中…</div> : null}
          {rows !== null && todayRows.length === 0 ? <div className="text-sm text-slate-600">本日の予約はありません。</div> : null}
          <div className="grid gap-2">
            {todayRows.map((r) => (
              <div key={r.id} className="rounded-xl border border-slate-200 bg-white px-4 py-3">
                <div className="text-sm font-bold text-slate-900">
                  {r.start_at.slice(11, 16)}〜{r.end_at.slice(11, 16)}
                </div>
                <div className="mt-1 text-xs text-slate-500">
                  トレーナー: {r.trainer_name || (r.trainer_id ?? "-")} / 会員: {r.member_code || r.member_id}
                </div>
              </div>
            ))}
          </div>
        </section>

        <div className="grid gap-3 sm:grid-cols-3">
          {kpiCards.map((c) => (
            <div key={c.label} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="text-xs font-medium text-slate-500">{c.label}</div>
              <div className="mt-2 text-2xl font-bold text-slate-900">{c.value}</div>
              <div className="mt-1 text-xs text-slate-500">※ダミー表示（後で実データに置換可）</div>
            </div>
          ))}
        </div>

        <section className="grid gap-3 sm:grid-cols-3">
          {navCards.map((c) => (
            <Link
              key={c.href}
              href={c.href}
              className="rounded-xl bg-white p-6 shadow-md hover:shadow-lg cursor-pointer border border-slate-200 hover:border-slate-300 transition"
            >
              <div className="text-2xl">{c.icon}</div>
              <div className="mt-2 text-base font-bold text-slate-900">{c.label}</div>
            </Link>
          ))}
        </section>
      </div>
    </GymShell>
  );
}

