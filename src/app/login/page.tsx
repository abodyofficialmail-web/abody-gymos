"use client";

import { GymShell } from "@/components/gym/GymShell";
import { useEffect, useState } from "react";

async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((json as any)?.error ?? "ログインに失敗しました");
  return json as T;
}

export default function LoginPage({ searchParams }: { searchParams?: { from?: string; reason?: string } }) {
  const [memberCode, setMemberCode] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (searchParams?.reason) setErr(decodeURIComponent(searchParams.reason));
  }, [searchParams?.reason]);

  return (
    <GymShell title="ログイン" nav={[]}>
      <div className="space-y-4">
        {searchParams?.from === "line" ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            LINE自動ログインに失敗しました。会員番号ログインをお試しください。
          </div>
        ) : null}
        {err ? <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{err}</div> : null}

        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm space-y-3">
          <div className="text-sm font-bold text-slate-900">会員番号ログイン</div>
          <div className="grid gap-2">
            <div>
              <div className="text-xs font-semibold text-slate-700">会員番号</div>
              <input
                value={memberCode}
                onChange={(e) => setMemberCode(e.target.value.toUpperCase())}
                placeholder="EBI001"
                className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
                autoCapitalize="characters"
              />
            </div>
            <div>
              <div className="text-xs font-semibold text-slate-700">メールアドレス</div>
              <input
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="example@gmail.com"
                inputMode="email"
                className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
              />
            </div>
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setErr(null);
              try {
                await apiPost("/api/member/login", { member_code: memberCode, email });
                window.location.href = "/member";
              } catch (e: any) {
                setErr(String(e?.message ?? "ログインに失敗しました"));
              } finally {
                setBusy(false);
              }
            }}
            className="inline-flex w-full items-center justify-center rounded-xl bg-emerald-600 px-4 py-3 text-sm font-semibold text-white disabled:opacity-60"
          >
            {busy ? "ログイン中…" : "ログイン"}
          </button>
        </section>
      </div>
    </GymShell>
  );
}

