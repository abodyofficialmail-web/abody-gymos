"use client";

import Script from "next/script";
import { useEffect, useState } from "react";
import { sessionSurveyPagePath } from "@/lib/sessionSurveyPaths";
import {
  captureSurveyParamsFromLocation,
  toSurveyApiQuery,
} from "@/lib/sessionSurveyParams";

declare global {
  interface Window {
    liff?: any;
  }
}

async function postLineLogin(body: { line_user_id: string }): Promise<void> {
  const res = await fetch("/api/member/line-login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as {
    code?: string;
    error?: string;
    message?: string;
  };
  if (!res.ok) {
    if (res.status === 404 && json.code === "NOT_LINKED") {
      throw new Error(
        "このLINEはまだ会員と紐付いていません。店舗のLINE公式トークで会員番号（例：EBI001）を送信し、案内に従って「はい」で連携したあと、もう一度この画面を開いてください。"
      );
    }
    throw new Error(json.message || json.error || json.code || "ログインに失敗しました");
  }
}

export default function LineEntryPage() {
  const [status, setStatus] = useState<"boot" | "loading" | "error">("boot");
  const [msg, setMsg] = useState<string>("");

  useEffect(() => {
    const surveyParams = captureSurveyParamsFromLocation();
    if (surveyParams) {
      const q = toSurveyApiQuery(surveyParams);
      if (q) {
        window.location.replace(sessionSurveyPagePath(q));
        return;
      }
    }

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

        await postLineLogin({ line_user_id: userId });
        window.location.href = "/member";
      } catch (e: any) {
        const code = String(e?.message ?? "");
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

