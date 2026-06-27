"use client";

import { DateTime } from "luxon";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

const TZ = "Asia/Tokyo";
const LOW_BOOKING_MAX = 3;

type Store = { id: string; name: string };
type MemberRow = {
  id: string;
  member_code: string;
  name: string | null;
  email?: string | null;
  line_user_id: string | null;
  is_active: boolean;
  store_id?: string | null;
  store_name?: string | null;
};

type BookingFilter = "all" | "low" | "zero";

function storeSortRank(storeName: string): number {
  if (storeName === "恵比寿") return 1;
  if (storeName === "上野") return 2;
  if (storeName === "桜木町") return 3;
  if (storeName === "新宿") return 4;
  if (storeName === "福岡") return 5;
  return 99;
}

function bookingCountBadgeClass(count: number): string {
  const base = "rounded-full border px-2 py-0.5 text-xs font-semibold";
  if (count === 0) return `${base} border-red-200 bg-red-50 text-red-800`;
  if (count <= LOW_BOOKING_MAX) return `${base} border-amber-200 bg-amber-50 text-amber-800`;
  return `${base} border-slate-200 bg-slate-50 text-slate-700`;
}

export function MembersClient(props: { stores: Store[]; members: MemberRow[] }) {
  const { stores, members } = props;
  const month = useMemo(() => DateTime.now().setZone(TZ).toFormat("yyyy-MM"), []);
  const monthLabel = useMemo(() => DateTime.now().setZone(TZ).setLocale("ja").toFormat("M月"), []);

  const [selectedStoreId, setSelectedStoreId] = useState<string>("all");
  const [bookingFilter, setBookingFilter] = useState<BookingFilter>("all");
  const [q, setQ] = useState("");
  const [bookingCounts, setBookingCounts] = useState<Record<string, number>>({});
  const [countsLoading, setCountsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setCountsLoading(true);
    const qs = new URLSearchParams({ month });
    if (selectedStoreId !== "all") qs.set("store_id", selectedStoreId);

    fetch(`/api/admin/member-booking-counts?${qs.toString()}`, { cache: "no-store" })
      .then((res) => res.json())
      .then((json: { counts?: Record<string, number> }) => {
        if (!cancelled) setBookingCounts(json.counts ?? {});
      })
      .catch(() => {
        if (!cancelled) setBookingCounts({});
      })
      .finally(() => {
        if (!cancelled) setCountsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [month, selectedStoreId]);

  const activeMembers = useMemo(() => (members ?? []).filter((m) => m.is_active), [members]);

  const lowBookingSummary = useMemo(() => {
    let low = 0;
    let zero = 0;
    for (const m of activeMembers) {
      if (selectedStoreId !== "all" && String(m.store_id ?? "") !== selectedStoreId) continue;
      const count = bookingCounts[m.id] ?? 0;
      if (count === 0) zero += 1;
      if (count <= LOW_BOOKING_MAX) low += 1;
    }
    return { low, zero };
  }, [activeMembers, bookingCounts, selectedStoreId]);

  const filtered = useMemo(() => {
    const keyword = q.trim().toLowerCase();
    let list = members ?? [];
    if (selectedStoreId !== "all") {
      list = list.filter((m) => String(m.store_id ?? "") === selectedStoreId);
    }
    if (keyword) {
      list = list.filter((m) => {
        const code = String(m.member_code ?? "").toLowerCase();
        const name = String(m.name ?? "").toLowerCase();
        const email = String(m.email ?? "").toLowerCase();
        return code.includes(keyword) || name.includes(keyword) || email.includes(keyword);
      });
    }
    if (bookingFilter === "low") {
      list = list.filter((m) => m.is_active && (bookingCounts[m.id] ?? 0) <= LOW_BOOKING_MAX);
    } else if (bookingFilter === "zero") {
      list = list.filter((m) => m.is_active && (bookingCounts[m.id] ?? 0) === 0);
    }

    const nameByStoreId = new Map((stores ?? []).map((s) => [s.id, s.name]));
    const sorted = [...list].sort((a, b) => {
      if (bookingFilter !== "all") {
        const aCount = bookingCounts[a.id] ?? 0;
        const bCount = bookingCounts[b.id] ?? 0;
        if (aCount !== bCount) return aCount - bCount;
      }
      const aStore = String(a.store_name ?? nameByStoreId.get(String(a.store_id ?? "")) ?? "");
      const bStore = String(b.store_name ?? nameByStoreId.get(String(b.store_id ?? "")) ?? "");
      const aRank = storeSortRank(aStore);
      const bRank = storeSortRank(bStore);
      if (aRank !== bRank) return aRank - bRank;
      if (aStore !== bStore) return aStore.localeCompare(bStore, "ja");
      return String(a.member_code ?? "").localeCompare(String(b.member_code ?? ""), "ja");
    });
    return sorted;
  }, [members, q, selectedStoreId, stores, bookingFilter, bookingCounts]);

  return (
    <div className="space-y-3">
      <div className="text-sm font-semibold text-slate-900">会員一覧</div>

      <Link
        href="/admin/dashboard/members/new"
        className="flex w-full items-center justify-center gap-2 rounded-2xl bg-slate-900 px-4 py-3.5 text-base font-semibold text-white shadow-sm"
      >
        ＋ 新規会員登録
      </Link>

      <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700 space-y-1">
        <div className="font-semibold text-slate-900">{monthLabel}の予約状況（有効会員）</div>
        {countsLoading ? (
          <div className="text-xs text-slate-500">集計中…</div>
        ) : (
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
            <span>
              {LOW_BOOKING_MAX}件以下:{" "}
              <span className="font-semibold text-amber-800">{lowBookingSummary.low}人</span>
            </span>
            <span>
              0件: <span className="font-semibold text-red-700">{lowBookingSummary.zero}人</span>
            </span>
          </div>
        )}
      </div>

      <div className="space-y-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="検索（会員番号 / 氏名 / メール）"
          className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-[16px] outline-none focus:border-slate-400"
        />

        <div className="flex gap-2 overflow-x-auto pb-1">
          <button
            type="button"
            onClick={() => setSelectedStoreId("all")}
            className={[
              "shrink-0 rounded-full border px-4 py-2 text-sm font-semibold transition-colors",
              selectedStoreId === "all" ? "text-slate-900" : "bg-white text-slate-700 hover:bg-slate-50",
            ].join(" ")}
            style={
              selectedStoreId === "all"
                ? { borderColor: "#CBD5E1", background: "#F8FAFC", boxShadow: "inset 0 0 0 1px #CBD5E1" }
                : { borderColor: "#E5E7EB" }
            }
          >
            全店舗
          </button>
          {(stores ?? []).map((s) => {
            const active = selectedStoreId === s.id;
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => setSelectedStoreId(s.id)}
                className={[
                  "shrink-0 rounded-full border px-4 py-2 text-sm font-semibold transition-colors",
                  active ? "text-slate-900" : "bg-white text-slate-700 hover:bg-slate-50",
                ].join(" ")}
                style={active ? { borderColor: "#CBD5E1", background: "#F8FAFC", boxShadow: "inset 0 0 0 1px #CBD5E1" } : { borderColor: "#E5E7EB" }}
              >
                {s.name}
              </button>
            );
          })}
        </div>

        <div className="flex gap-2 overflow-x-auto pb-1">
          {(
            [
              ["all", "すべて"],
              ["low", `${monthLabel} ${LOW_BOOKING_MAX}件以下`],
              ["zero", `${monthLabel} 0件`],
            ] as const
          ).map(([id, label]) => {
            const active = bookingFilter === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => setBookingFilter(id)}
                className={[
                  "shrink-0 rounded-full border px-4 py-2 text-sm font-semibold transition-colors",
                  active ? "text-slate-900" : "bg-white text-slate-700 hover:bg-slate-50",
                ].join(" ")}
                style={active ? { borderColor: "#CBD5E1", background: "#F8FAFC", boxShadow: "inset 0 0 0 1px #CBD5E1" } : { borderColor: "#E5E7EB" }}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="text-xs text-slate-500">
        表示件数: <span className="font-mono">{filtered.length}</span>
      </div>

      <div className="grid gap-2">
        {filtered.map((m) => {
          const bookingCount = bookingCounts[m.id] ?? 0;
          return (
            <Link
              key={m.id}
              href={`/admin/dashboard/members/${m.id}`}
              className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm hover:border-slate-300"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-base font-bold text-slate-900">{m.member_code}</div>
                  <div className="pt-1 text-sm text-slate-700">{m.name ?? ""}</div>
                </div>
                <div className="flex flex-col items-end gap-1">
                  {!countsLoading && m.is_active ? (
                    <span className={bookingCountBadgeClass(bookingCount)}>
                      {monthLabel} {bookingCount}件
                    </span>
                  ) : null}
                  <span
                    className={[
                      "rounded-full px-2 py-0.5 text-xs font-semibold border",
                      m.line_user_id
                        ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                        : "border-slate-200 bg-slate-50 text-slate-600",
                    ].join(" ")}
                  >
                    {m.line_user_id ? "LINE連携済み" : "LINE未連携"}
                  </span>
                </div>
              </div>

              <div className="pt-1 flex flex-wrap items-center gap-2 text-xs">
                <span className="text-slate-500">{m.is_active ? "有効" : "無効"}</span>
                {m.store_name ? (
                  <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-slate-700">{m.store_name}</span>
                ) : null}
              </div>
            </Link>
          );
        })}
      </div>

      {filtered.length === 0 ? <div className="text-sm text-slate-600">該当する会員がいません。</div> : null}
    </div>
  );
}
