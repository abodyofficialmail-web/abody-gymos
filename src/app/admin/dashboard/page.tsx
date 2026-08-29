"use client";

import Link from "next/link";
import { DateTime } from "luxon";
import { useEffect, useMemo, useState } from "react";
import { GymShell } from "@/components/gym/GymShell";

type ShiftRow = {
  trainer_id: string;
  trainer_name: string;
  start_local: string;
  end_local: string;
};

type StoreOverview = {
  store_id: string;
  store_name: string;
  reservation_count: number;
  available_slot_count: number;
  available_minutes: number;
  shifts: ShiftRow[];
};

async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(path, { cache: "no-store" });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((json as any)?.error ?? "取得に失敗しました");
  return json as T;
}

function formatAvailableMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h <= 0) return `${m}分`;
  if (m === 0) return `${h}時間`;
  return `${h}時間${m}分`;
}

export default function AdminDashboardTopPage() {
  const today = useMemo(() => DateTime.now().setZone("Asia/Tokyo").toISODate()!, []);

  const [stores, setStores] = useState<StoreOverview[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setErr(null);
    setStores(null);
    apiGet<{ date: string; stores: StoreOverview[] }>(
      `/api/admin/dashboard-overview?date=${encodeURIComponent(today)}`
    )
      .then((d) => setStores(d.stores ?? []))
      .catch((e: any) => {
        setErr(String(e?.message ?? "ダッシュボードの取得に失敗しました"));
        setStores([]);
      });
  }, [today]);

  const navCards = [
    { href: "/admin/dashboard/shifts", label: "シフト作成", icon: "📅" },
    { href: "/admin/dashboard/trainers", label: "トレーナー一覧", icon: "👤" },
    { href: "/admin/dashboard/reservations", label: "予約一覧", icon: "🕒" },
    { href: "/admin/dashboard/members", label: "会員カルテ", icon: "🗂" },
    { href: "/admin/dashboard/today", label: "本日の予約", icon: "🧾" },
    { href: "/admin/dashboard/marketing", label: "広告レポート", icon: "📣" },
  ];

  return (
    <GymShell title="管理ダッシュボード" nav={[]}>
      <div className="space-y-4">
        <section className="rounded-xl bg-white p-6 shadow-md space-y-4">
          <div>
            <div className="text-sm font-bold text-slate-900">本日の店舗サマリ</div>
            <div className="text-xs text-slate-500">{today}</div>
          </div>

          {err ? <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{err}</div> : null}

          {stores === null ? <div className="text-sm text-slate-600">読み込み中…</div> : null}
          {stores !== null && stores.length === 0 ? <div className="text-sm text-slate-600">店舗がありません。</div> : null}

          <div className="grid gap-3">
            {(stores ?? []).map((s) => (
              <div key={s.store_id} className="rounded-xl border border-slate-200 bg-slate-50/60 px-4 py-4">
                <div className="text-base font-bold text-slate-900">{s.store_name}</div>

                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  <div className="rounded-lg bg-white px-3 py-2 border border-slate-200">
                    <div className="text-[11px] font-medium text-slate-500">予約数</div>
                    <div className="mt-0.5 text-xl font-bold text-slate-900">{s.reservation_count}</div>
                  </div>
                  <div className="rounded-lg bg-white px-3 py-2 border border-slate-200">
                    <div className="text-[11px] font-medium text-slate-500">セッション空き数</div>
                    <div className="mt-0.5 text-xl font-bold text-slate-900">{s.available_slot_count}</div>
                    <div className="text-[11px] text-slate-500">約{formatAvailableMinutes(s.available_minutes)}</div>
                  </div>
                </div>

                <div className="mt-3">
                  <div className="text-xs font-semibold text-slate-700">勤務トレーナーのシフト</div>
                  {s.shifts.length === 0 ? (
                    <div className="mt-1 text-sm text-slate-500">勤務予定なし</div>
                  ) : (
                    <ul className="mt-1 space-y-1">
                      {s.shifts.map((sh, idx) => (
                        <li
                          key={`${sh.trainer_id}-${sh.start_local}-${sh.end_local}-${idx}`}
                          className="text-sm text-slate-800"
                        >
                          <span className="font-medium">{sh.trainer_name || sh.trainer_id}</span>
                          <span className="text-slate-500">
                            {" "}
                            {sh.start_local}〜{sh.end_local}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>

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
