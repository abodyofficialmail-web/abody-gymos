"use client";

import { DateTime } from "luxon";
import { useEffect, useMemo, useState } from "react";
import { GymShell } from "@/components/gym/GymShell";
import {
  isLowBookingMotivationNeed,
  lowBookingMotivationBadgeClass,
  lowBookingMotivationBadgeLabel,
} from "@/lib/lowBookingMotivation";

const TZ = "Asia/Tokyo";

type ReservationRow = {
  id: string;
  store_id: string;
  store_name?: string;
  trainer_id: string | null;
  trainer_name?: string;
  member_id: string;
  member_code?: string;
  member_name?: string;
  session_type?: string | null;
  start_at: string;
  end_at: string;
  status: string;
  created_at: string;
};

type BodyPhotoStatusRow = {
  last_photo_date: string | null;
  needs_photo: boolean;
  reason: "never" | "stale_month" | null;
};

async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(path, { cache: "no-store" });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((json as any)?.error ?? "取得に失敗しました");
  return json as T;
}

function bodyPhotoBadge(status: BodyPhotoStatusRow | undefined) {
  if (!status?.needs_photo) return null;
  if (status.reason === "never") {
    return (
      <span className="rounded-md bg-rose-100 px-1.5 py-0.5 text-[10px] font-bold text-rose-900">
        写真なし・撮影推奨
      </span>
    );
  }
  return (
    <span className="rounded-md bg-sky-100 px-1.5 py-0.5 text-[10px] font-bold text-sky-900">
      今月未撮影・撮影推奨
    </span>
  );
}

export default function AdminDashboardTodayPage() {
  const month = useMemo(() => DateTime.now().setZone(TZ).toFormat("yyyy-MM"), []);
  const today = useMemo(() => DateTime.now().setZone(TZ).toISODate()!, []);

  const [rows, setRows] = useState<ReservationRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [bodyPhotoStatusByMember, setBodyPhotoStatusByMember] = useState<Record<string, BodyPhotoStatusRow>>(
    {}
  );

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
    const list = (rows ?? []).filter((r) => DateTime.fromISO(r.start_at).setZone(TZ).toISODate() === today);
    list.sort((a, b) => a.start_at.localeCompare(b.start_at));
    return list;
  }, [rows, today]);

  const monthBookingByMember = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows ?? []) {
      if (!r.member_id) continue;
      if (String(r.status ?? "") === "cancelled") continue;
      m.set(r.member_id, (m.get(r.member_id) ?? 0) + 1);
    }
    return m;
  }, [rows]);

  useEffect(() => {
    const memberIds = [
      ...new Set(
        todayRows
          .filter((r) => r.member_id && String(r.session_type ?? "store") !== "online")
          .map((r) => r.member_id)
      ),
    ];
    if (memberIds.length === 0) {
      setBodyPhotoStatusByMember({});
      return;
    }
    let cancelled = false;
    const qs = new URLSearchParams();
    qs.set("member_ids", memberIds.join(","));
    qs.set("as_of", today);
    apiGet<{ status: Record<string, BodyPhotoStatusRow> }>(
      `/api/admin/member-body-photo-status?${qs.toString()}`
    )
      .then((d) => {
        if (!cancelled) setBodyPhotoStatusByMember(d.status ?? {});
      })
      .catch(() => {
        if (!cancelled) setBodyPhotoStatusByMember({});
      });
    return () => {
      cancelled = true;
    };
  }, [todayRows, today]);

  return (
    <GymShell title="本日の予約" nav={[]}>
      <div className="space-y-3">
        <div className="text-xs text-slate-500">{today}</div>
        <div className="text-[11px] text-slate-500">
          体型写真は月1回。
          <span className="mx-1 rounded-md bg-rose-100 px-1 py-0.5 font-semibold text-rose-900">写真なし</span>/
          <span className="mx-1 rounded-md bg-sky-100 px-1 py-0.5 font-semibold text-sky-900">今月未撮影</span>
          はカルテから撮影してください。
        </div>
        {err ? <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{err}</div> : null}
        {rows === null ? <div className="text-sm text-slate-600">読み込み中…</div> : null}
        {rows !== null && todayRows.length === 0 ? <div className="text-sm text-slate-600">本日の予約はありません。</div> : null}
        <div className="grid gap-2">
          {todayRows.map((r) => (
            <div key={r.id} className="rounded-xl bg-white p-6 shadow-md hover:shadow-lg border border-slate-200">
              <div className="flex flex-wrap items-center gap-2">
                <div className="text-sm font-bold text-slate-900">
                  {DateTime.fromISO(r.start_at).setZone(TZ).toFormat("HH:mm")}〜
                  {DateTime.fromISO(r.end_at).setZone(TZ).toFormat("HH:mm")}
                </div>
                {String(r.session_type ?? "store") !== "online"
                  ? bodyPhotoBadge(bodyPhotoStatusByMember[r.member_id])
                  : null}
                {r.member_id && isLowBookingMotivationNeed(monthBookingByMember.get(r.member_id) ?? 0) ? (
                  <span className={lowBookingMotivationBadgeClass(monthBookingByMember.get(r.member_id) ?? 0)}>
                    {lowBookingMotivationBadgeLabel(monthBookingByMember.get(r.member_id) ?? 0)}
                  </span>
                ) : null}
              </div>
              <div className="mt-1 text-xs text-slate-500">
                トレーナー: {r.trainer_name || (r.trainer_id ?? "-")} / 会員:{" "}
                {r.member_code || r.member_id}
                {r.member_name ? `（${r.member_name}）` : ""}
              </div>
              {r.member_id ? (
                <a
                  href={`/admin/dashboard/members/${r.member_id}`}
                  className="mt-2 inline-flex text-xs font-semibold text-slate-700 underline"
                >
                  カルテを見る
                </a>
              ) : null}
            </div>
          ))}
        </div>
      </div>
    </GymShell>
  );
}
