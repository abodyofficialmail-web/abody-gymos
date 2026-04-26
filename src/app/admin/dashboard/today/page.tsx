"use client";

import { DateTime } from "luxon";
import { useEffect, useMemo, useState } from "react";
import { GymShell } from "@/components/gym/GymShell";

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

export default function AdminDashboardTodayPage() {
  const month = useMemo(() => DateTime.now().setZone("Asia/Tokyo").toFormat("yyyy-MM"), []);
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);

  const [rows, setRows] = useState<ReservationRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setErr(null);
    apiGet<{ reservations: ReservationRow[] }>(`/api/booking-v2/reservations?month=${encodeURIComponent(month)}`)
      .then((d) => setRows(d.reservations ?? []))
      .catch((e: any) => {
        setErr(String(e?.message ?? "取得に失敗しました"));
        setRows([]);
      });
  }, [month]);

  const todayRows = useMemo(() => {
    const list = (rows ?? []).filter((r) => r.start_at.startsWith(today));
    list.sort((a, b) => a.start_at.localeCompare(b.start_at));
    return list;
  }, [rows, today]);

  return (
    <GymShell title="本日の予約" nav={[]}>
      <div className="space-y-3">
        <div className="text-xs text-slate-500">{today}</div>
        {err ? <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{err}</div> : null}
        {rows === null ? <div className="text-sm text-slate-600">読み込み中…</div> : null}
        {rows !== null && todayRows.length === 0 ? <div className="text-sm text-slate-600">本日の予約はありません。</div> : null}
        <div className="grid gap-2">
          {todayRows.map((r) => (
            <div key={r.id} className="rounded-xl bg-white p-6 shadow-md hover:shadow-lg border border-slate-200">
              <div className="text-sm font-bold text-slate-900">
                {r.start_at.slice(11, 16)}〜{r.end_at.slice(11, 16)}
              </div>
              <div className="mt-1 text-xs text-slate-500">
                トレーナー: {r.trainer_name || (r.trainer_id ?? "-")} / 会員: {r.member_code || r.member_id}
              </div>
            </div>
          ))}
        </div>
      </div>
    </GymShell>
  );
}

