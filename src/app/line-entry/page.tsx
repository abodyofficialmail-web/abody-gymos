"use client";

import Script from "next/script";
import { useEffect, useState } from "react";

declare global {
  interface Window {
    liff?: any;
  }
}

async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((json as any)?.code ?? (json as any)?.error ?? "ログインに失敗しました");
  return json as T;
}

export default function LineEntryPage() {
  const [status, setStatus] = useState<"boot" | "loading" | "error">("boot");
  const [msg, setMsg] = useState<string>("");

  useEffect(() => {
    const liffId = process.env.NEXT_PUBLIC_LIFF_ID;
    if (!liffId) {
      setStatus("error");
      setMsg("LIFF設定がありません。/login からログインしてください。");
      return;
    }
    setStatus("loading");

    const run = async () => {
      try {
        const liff = window.liff;
        if (!liff) throw new Error("LIFF SDK が読み込めませんでした");
        await liff.init({ liffId });
        if (!liff.isLoggedIn()) {
          liff.login();
          return;
        }
        const profile = await liff.getProfile();
        const userId = profile?.userId;
        if (!userId) throw new Error("LINEユーザーIDの取得に失敗しました");

        await apiPost("/api/member/line-login", { line_user_id: userId });
        window.location.href = "/member";
      } catch (e: any) {
        const code = String(e?.message ?? "");
        // 未紐付け or 何らかの失敗は手動ログインへ
        window.location.href = `/login?from=line&reason=${encodeURIComponent(code)}`;
      }
    };

    // SDKロード後に実行
    const t = window.setInterval(() => {
      if (window.liff) {
        window.clearInterval(t);
        run();
      }
    }, 50);
    return () => window.clearInterval(t);
  }, []);

  return (
    <main className="mx-auto w-full max-w-[520px] px-5 py-10">
      <Script src="https://static.line-scdn.net/liff/edge/2/sdk.js" strategy="afterInteractive" />
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="text-base font-semibold">LINEログイン</div>
        <div className="pt-2 text-sm text-slate-600">
          {status === "loading" ? "読み込み中…" : status === "error" ? msg : "読み込み中…"}
        </div>
      </div>
    </main>
  );
}

