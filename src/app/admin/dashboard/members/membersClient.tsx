"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

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

function storeSortRank(storeName: string): number {
  // 期待の表示順（必要なら後で変更可）
  if (storeName === "恵比寿") return 1;
  if (storeName === "上野") return 2;
  if (storeName === "桜木町") return 3;
  return 99;
}

export function MembersClient(props: { stores: Store[]; members: MemberRow[] }) {
  const { stores, members } = props;
  const [selectedStoreId, setSelectedStoreId] = useState<string>("all");
  const [q, setQ] = useState("");

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
        const email = String((m as any).email ?? "").toLowerCase();
        return code.includes(keyword) || name.includes(keyword) || email.includes(keyword);
      });
    }

    const nameByStoreId = new Map((stores ?? []).map((s) => [s.id, s.name]));
    const sorted = [...list].sort((a, b) => {
      const aStore = String(a.store_name ?? nameByStoreId.get(String(a.store_id ?? "")) ?? "");
      const bStore = String(b.store_name ?? nameByStoreId.get(String(b.store_id ?? "")) ?? "");
      const aRank = storeSortRank(aStore);
      const bRank = storeSortRank(bStore);
      if (aRank !== bRank) return aRank - bRank;
      if (aStore !== bStore) return aStore.localeCompare(bStore, "ja");
      return String(a.member_code ?? "").localeCompare(String(b.member_code ?? ""), "ja");
    });
    return sorted;
  }, [members, q, selectedStoreId, stores]);

  return (
    <div className="space-y-3">
      <div className="text-sm text-slate-600">会員一覧</div>

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
      </div>

      <div className="text-xs text-slate-500">
        表示件数: <span className="font-mono">{filtered.length}</span>
      </div>

      <div className="grid gap-2">
        {filtered.map((m) => (
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
              <span
                className={[
                  "rounded-full px-2 py-0.5 text-xs font-semibold border",
                  m.line_user_id ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-slate-200 bg-slate-50 text-slate-600",
                ].join(" ")}
              >
                {m.line_user_id ? "LINE連携済み" : "LINE未連携"}
              </span>
            </div>

            <div className="pt-1 flex flex-wrap items-center gap-2 text-xs">
              <span className="text-slate-500">{m.is_active ? "有効" : "無効"}</span>
              {m.store_name ? (
                <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-slate-700">{m.store_name}</span>
              ) : null}
            </div>
          </Link>
        ))}
      </div>

      {filtered.length === 0 ? <div className="text-sm text-slate-600">該当する会員がいません。</div> : null}
    </div>
  );
}

