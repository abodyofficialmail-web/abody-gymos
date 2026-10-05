"use client";

import { useEffect, useState } from "react";

export type ReferrerChoice = {
  id: string;
  member_code: string;
  name: string;
};

type SearchRow = ReferrerChoice;

export function ReferrerMemberPicker({
  value,
  onChange,
  excludeMemberId,
  compact = false,
}: {
  value: ReferrerChoice | null;
  onChange: (next: ReferrerChoice | null) => void;
  excludeMemberId?: string;
  compact?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setHits([]);
      setErr(null);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setLoading(true);
      const params = new URLSearchParams({ q });
      if (excludeMemberId) params.set("exclude_id", excludeMemberId);
      fetch(`/api/gym/admin/members/search?${params.toString()}`, { cache: "no-store" })
        .then(async (res) => {
          const json = (await res.json().catch(() => ({}))) as { members?: SearchRow[]; error?: string };
          if (!res.ok) throw new Error(json.error ?? "紹介者の検索に失敗しました");
          if (!cancelled) setHits(json.members ?? []);
        })
        .catch((e: Error) => {
          if (!cancelled) {
            setHits([]);
            setErr(e.message || "紹介者の検索に失敗しました");
          }
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 200);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query, excludeMemberId]);

  const inputClass = compact
    ? "w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-slate-400"
    : "w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-[16px] outline-none focus:border-slate-400";

  return (
    <div className="space-y-1">
      <span className={compact ? "text-xs font-medium text-slate-700" : "text-sm font-semibold text-slate-700"}>
        紹介者
      </span>
      {value ? (
        <div className="flex items-center justify-between gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800">
          <span>
            <span className="font-mono font-semibold">{value.member_code}</span>
            {value.name ? <span className="ml-2">{value.name}</span> : null}
          </span>
          <button type="button" onClick={() => onChange(null)} className="text-xs font-semibold text-slate-600 underline">
            変更
          </button>
        </div>
      ) : (
        <input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setErr(null);
          }}
          placeholder="会員番号または氏名"
          className={inputClass}
        />
      )}
      {!value && query.trim() ? (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          {loading ? <div className="px-3 py-2 text-xs text-slate-500">検索中…</div> : null}
          {!loading && hits.length === 0 ? (
            <div className="px-3 py-2 text-xs text-slate-500">該当する会員がいません</div>
          ) : null}
          {hits.map((row) => (
            <button
              key={row.id}
              type="button"
              onClick={() => {
                onChange(row);
                setQuery("");
                setHits([]);
              }}
              className="block w-full border-t border-slate-100 px-3 py-2 text-left text-sm first:border-t-0 hover:bg-slate-50"
            >
              <span className="font-mono font-semibold">{row.member_code}</span>
              {row.name ? <span className="ml-2">{row.name}</span> : null}
            </button>
          ))}
        </div>
      ) : null}
      {err ? <div className="text-xs text-red-700">{err}</div> : null}
    </div>
  );
}
