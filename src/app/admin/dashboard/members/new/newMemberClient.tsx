"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

type Store = { id: string; name: string };

type NextCodeResponse = {
  next_member_code?: string;
  store_name?: string;
  error?: string;
};

type CreateResponse = {
  member?: {
    id: string;
    member_code: string;
    name: string;
    email: string | null;
    store_name: string;
  };
  error?: string | { fieldErrors?: Record<string, string[]> };
};

function storeSortRank(storeName: string): number {
  if (storeName === "恵比寿") return 1;
  if (storeName === "上野") return 2;
  if (storeName === "桜木町") return 3;
  if (storeName === "新宿") return 4;
  return 99;
}

export function NewMemberClient({
  stores,
  initialNextCodesByStoreId,
}: {
  stores: Store[];
  initialNextCodesByStoreId: Record<string, string>;
}) {
  const router = useRouter();
  const sortedStores = useMemo(
    () => [...stores].sort((a, b) => storeSortRank(a.name) - storeSortRank(b.name) || a.name.localeCompare(b.name, "ja")),
    [stores]
  );

  const [storeId, setStoreId] = useState(() => sortedStores[0]?.id ?? "");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [nextCode, setNextCode] = useState<string | null>(() => {
    const id = sortedStores[0]?.id ?? "";
    return initialNextCodesByStoreId[id] ?? null;
  });
  const [codeLoading, setCodeLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const selectedStore = sortedStores.find((s) => s.id === storeId) ?? null;

  useEffect(() => {
    if (!storeId) {
      setNextCode(null);
      return;
    }
    const cached = initialNextCodesByStoreId[storeId];
    if (cached) {
      setNextCode(cached);
      return;
    }
    setCodeLoading(true);
    setErr(null);
    fetch(`/api/gym/admin/members?store_id=${encodeURIComponent(storeId)}`, { cache: "no-store" })
      .then(async (res) => {
        const json = (await res.json().catch(() => ({}))) as NextCodeResponse;
        if (!res.ok) throw new Error(String(json.error ?? "会員番号の取得に失敗しました"));
        setNextCode(json.next_member_code ?? null);
      })
      .catch((e: Error) => {
        setNextCode(null);
        setErr(String(e.message ?? "会員番号の取得に失敗しました"));
      })
      .finally(() => setCodeLoading(false));
  }, [storeId, initialNextCodesByStoreId]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/gym/admin/members", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          store_id: storeId,
          name,
          email,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as CreateResponse;
      if (!res.ok) {
        const detail = json.error;
        if (detail && typeof detail === "object" && detail.fieldErrors) {
          const first = Object.values(detail.fieldErrors).flat()[0];
          throw new Error(first ?? "登録に失敗しました");
        }
        throw new Error(String(detail ?? "登録に失敗しました"));
      }
      if (!json.member) throw new Error("登録に失敗しました");
      router.push(`/admin/dashboard/members/${json.member.id}/onboarding`);
    } catch (e) {
      setErr(String((e as Error)?.message ?? "登録に失敗しました"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="text-sm text-slate-600">
        店舗・氏名・メールを入力して会員登録します。登録後、カウンセリング内容と体験セッションの入力画面に進みます。
      </div>

      <label className="block space-y-1">
        <span className="text-sm font-semibold text-slate-700">店舗</span>
        <select
          value={storeId}
          onChange={(e) => setStoreId(e.target.value)}
          className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-[16px] outline-none focus:border-slate-400"
          required
        >
          {sortedStores.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </label>

      <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
        付与予定の会員番号:{" "}
        <span className="font-mono font-bold text-slate-900">
          {codeLoading ? "取得中…" : nextCode ?? "—"}
        </span>
        {selectedStore ? <span className="ml-2 text-slate-500">（{selectedStore.name}店）</span> : null}
      </div>

      <label className="block space-y-1">
        <span className="text-sm font-semibold text-slate-700">氏名</span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="例: 山田太郎"
          className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-[16px] outline-none focus:border-slate-400"
          required
        />
      </label>

      <label className="block space-y-1">
        <span className="text-sm font-semibold text-slate-700">メール</span>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="example@gmail.com"
          className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-[16px] outline-none focus:border-slate-400"
          required
        />
      </label>

      {err ? <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{err}</div> : null}

      <div className="flex flex-wrap gap-2">
        <button
          type="submit"
          disabled={busy || codeLoading || !storeId || !name.trim() || !email.trim() || !nextCode}
          className="rounded-2xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white disabled:opacity-50"
        >
          {busy ? "登録中…" : "登録して次へ"}
        </button>
        <Link href="/admin/dashboard/members" className="rounded-2xl px-4 py-3 text-sm font-semibold text-slate-600 underline">
          キャンセル
        </Link>
      </div>
    </form>
  );
}
