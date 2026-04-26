"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = (json as any)?.error ?? "送信に失敗しました";
    throw new Error(String(msg));
  }
  return json as T;
}

export function TrainerGateClient({ trainerId, trainerName }: { trainerId: string; trainerName: string }) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const title = useMemo(() => `${trainerName} の給与画面`, [trainerName]);

  async function onSubmit() {
    setBusy(true);
    setErr(null);
    try {
      await apiPost<{ ok: true }>("/api/admin/trainer-gate", { trainer_id: trainerId, password });
      router.refresh();
    } catch (e: any) {
      const m = String(e?.message ?? "");
      setErr(m === "invalid_password" ? "パスワードが違います" : "認証に失敗しました");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-sm space-y-3">
      <div className="space-y-1">
        <div className="text-sm font-bold text-slate-900">{title}</div>
        <div className="text-xs text-slate-500">パスワード認証後に閲覧できます。</div>
      </div>

      {err ? <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">{err}</div> : null}

      <label className="block text-sm font-medium text-slate-700">
        パスワード
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="mt-1 w-full min-h-[44px] rounded-xl border border-slate-200 bg-white px-3 text-sm"
          disabled={busy}
          autoFocus
        />
      </label>

      <button
        type="button"
        onClick={() => void onSubmit()}
        className="min-h-[44px] w-full rounded-xl bg-slate-900 px-4 text-sm font-bold text-white disabled:opacity-60"
        disabled={busy || !password}
      >
        確認
      </button>
    </div>
  );
}

