"use client";

import { DateTime } from "luxon";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

const TZ = "Asia/Tokyo";

type Row = { id: string; display_name: string; store_id: string; store_name: string };

async function apiGet<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: "no-store" });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((j as any).error ?? "取得に失敗しました");
  return j as T;
}

export function TrainersDashboardClient({ trainers }: { trainers: Row[] }) {
  const month = useMemo(() => DateTime.now().setZone(TZ).toFormat("yyyy-MM"), []);
  const [counts, setCounts] = useState<Record<string, { shifts: number; reservations: number }>>({});

  useEffect(() => {
    let cancelled = false;
    async function run() {
      const next: Record<string, { shifts: number; reservations: number }> = {};
      await Promise.all(
        trainers.map(async (t) => {
          try {
            const [s, r] = await Promise.all([
              apiGet<{ shifts: unknown[] }>(
                `/api/shifts?store_id=${encodeURIComponent(t.store_id)}&month=${encodeURIComponent(month)}&trainer_id=${encodeURIComponent(t.id)}`
              ),
              apiGet<{ reservations: unknown[] }>(
                `/api/booking-v2/reservations?trainer_id=${encodeURIComponent(t.id)}&month=${encodeURIComponent(month)}`
              ),
            ]);
            next[t.id] = { shifts: (s.shifts ?? []).length, reservations: (r.reservations ?? []).length };
          } catch {
            next[t.id] = { shifts: 0, reservations: 0 };
          }
        })
      );
      if (!cancelled) setCounts(next);
    }
    void run();
    return () => {
      cancelled = true;
    };
  }, [trainers, month]);

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-600">
        集計月: <span className="font-mono font-medium">{month}</span>（JST）
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        {trainers.map((t) => (
          <Link
            key={t.id}
            href={`/admin/trainers/dashboard/${t.id}`}
            className="block rounded-xl border border-slate-200 bg-white p-4 shadow-sm hover:border-slate-300"
          >
            <div className="text-base font-bold text-slate-900">{t.display_name}</div>
            <div className="text-xs text-slate-500">{t.store_name}</div>
            <div className="mt-2 flex gap-4 text-sm text-slate-700">
              <div>
                今月シフト: <span className="font-semibold">{counts[t.id]?.shifts ?? "…"}</span>
              </div>
              <div>
                今月予約: <span className="font-semibold">{counts[t.id]?.reservations ?? "…"}</span>
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
