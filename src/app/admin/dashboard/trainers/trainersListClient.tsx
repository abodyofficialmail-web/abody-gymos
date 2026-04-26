"use client";

import Link from "next/link";
import { DateTime } from "luxon";
import { useEffect, useMemo, useState } from "react";

type TrainerRow = {
  id: string;
  name: string;
  store_id: string;
  store_name: string;
};

type ReservationRow = {
  id: string;
  trainer_id: string | null;
  start_at: string;
  end_at: string;
  store_id: string;
  member_id: string;
  member_code?: string;
  trainer_name?: string;
  store_name?: string;
  status: string;
  created_at: string;
};

async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(path, { cache: "no-store" });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((json as any)?.error ?? "取得に失敗しました");
  return json as T;
}

export function TrainersListClient() {
  const [rows, setRows] = useState<TrainerRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const month = useMemo(() => DateTime.now().setZone("Asia/Tokyo").toFormat("yyyy-MM"), []);
  const [resCounts, setResCounts] = useState<Record<string, number>>({});
  const sessionYen = 3000;

  useEffect(() => {
    setErr(null);
    apiGet<{ trainers: TrainerRow[] }>("/api/trainers")
      .then((d) => setRows(d.trainers ?? []))
      .catch((e: any) => {
        setErr(String(e?.message ?? "取得に失敗しました"));
        setRows([]);
      });
  }, []);

  useEffect(() => {
    apiGet<{ reservations: ReservationRow[] }>(`/api/booking-v2/reservations?month=${encodeURIComponent(month)}`)
      .then((d) => {
        const m: Record<string, number> = {};
        for (const r of d.reservations ?? []) {
          const tid = r.trainer_id;
          if (!tid) continue;
          m[tid] = (m[tid] ?? 0) + 1;
        }
        setResCounts(m);
      })
      .catch(() => setResCounts({}));
  }, [month]);

  return (
    <div className="space-y-3">
      <div className="text-xs text-slate-500">
        集計月: <span className="font-mono">{month}</span>
      </div>
      {err ? <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{err}</div> : null}
      {rows === null ? <div className="text-sm text-slate-600">読み込み中…</div> : null}
      {rows !== null && rows.length === 0 ? <div className="text-sm text-slate-600">トレーナーがいません。</div> : null}
      <div className="grid gap-2 sm:grid-cols-2">
        {(rows ?? []).map((t) => (
          <Link key={t.id} href={`/admin/dashboard/trainers/${t.id}`} className="group">
            <div className="rounded-xl bg-white p-6 shadow-md hover:shadow-lg cursor-pointer border border-slate-200 hover:border-slate-300 transition">
              <div className="text-base font-bold text-slate-900">{t.name}</div>
              <div className="text-xs text-slate-500">{t.store_name}</div>
              <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
                <div className="rounded-lg bg-slate-50 px-3 py-2">
                  <div className="text-[11px] text-slate-500">今月予約数</div>
                  <div className="font-bold text-slate-900">{resCounts[t.id] ?? 0}</div>
                </div>
                <div className="rounded-lg bg-slate-50 px-3 py-2">
                  <div className="text-[11px] text-slate-500">今月給与</div>
                  <div className="font-bold text-slate-900">¥{((resCounts[t.id] ?? 0) * sessionYen).toLocaleString("ja-JP")}</div>
                </div>
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}

