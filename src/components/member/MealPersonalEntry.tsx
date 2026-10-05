"use client";

import { MealPersonalStart, MEAL_START_SKIP_KEY } from "@/components/member/MealPersonalStart";
import { useState } from "react";

export function MealPersonalEntry({
  onLoggedIn,
  initialView = "choose",
}: {
  onLoggedIn: () => void;
  initialView?: "choose" | "questions";
}) {
  const [view, setView] = useState<"choose" | "login" | "questions">(initialView);
  const [identifier, setIdentifier] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function login() {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/member/meal-personal/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: identifier.trim() }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(json.error || "ログインに失敗しました");
      try {
        window.sessionStorage.removeItem(MEAL_START_SKIP_KEY);
      } catch {
        // ログイン後は目標の有無で画面を決める
      }
      onLoggedIn();
    } catch (e) {
      setErr(String((e as Error)?.message ?? "ログインに失敗しました"));
      setBusy(false);
    }
  }

  if (view === "questions") {
    return (
      <MealPersonalStart
        onExit={() => {
          if (initialView === "questions") {
            window.location.href = "/meal-log";
            return;
          }
          setView("choose");
        }}
        onFinished={(target) => {
          try {
            if (target) window.sessionStorage.removeItem(MEAL_START_SKIP_KEY);
            else window.sessionStorage.setItem(MEAL_START_SKIP_KEY, "1");
          } catch {
            // 保存できなくても、ログイン後の画面遷移は続ける
          }
          onLoggedIn();
        }}
      />
    );
  }

  if (view === "login") {
    return (
      <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
        <img src="/meal-personal/start-hero.jpg" alt="食事の写真" className="h-44 w-full object-cover" />
        <div className="space-y-3 p-5">
          <button type="button" onClick={() => setView("choose")} className="text-xs font-semibold text-slate-500">
            戻る
          </button>
          <h1 className="text-2xl font-bold text-slate-900">ログイン</h1>
          <p className="text-sm leading-relaxed text-slate-600">
            新規スタートで登録したメールアドレスがログインIDです。ジムの会員番号とは別のアカウントです。
          </p>
          <label className="block text-xs font-semibold text-slate-700">
            ログインIDのメールアドレス
            <input
              type="email"
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              placeholder="例: misaki@example.com"
              className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-3 text-sm font-normal"
            />
          </label>
          {err ? <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">{err}</div> : null}
          <button
            type="button"
            disabled={busy}
            onClick={() => void login()}
            className="w-full rounded-2xl bg-teal-800 px-4 py-3.5 text-sm font-bold text-white disabled:opacity-60"
          >
            {busy ? "ログイン中…" : "ログインしてはじめる"}
          </button>
        </div>
      </section>
    );
  }

  return (
    <div className="space-y-4">
      <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
        <img src="/meal-personal/start-hero.jpg" alt="鮭とサラダ、ごはんの食事" className="h-52 w-full object-cover" />
        <div className="space-y-2 p-5">
          <p className="text-xs font-semibold tracking-wide text-teal-800">食事パーソナル</p>
          <h1 className="text-2xl font-bold leading-snug text-slate-900">はじめ方を選んでください</h1>
          <p className="text-sm leading-relaxed text-slate-600">
            食事パーソナルだけのアカウントです。ジムのパーソナル会員とは別に始まります。
          </p>
        </div>
      </section>
      <button
        type="button"
        onClick={() => {
          setErr(null);
          setView("login");
        }}
        className="flex w-full items-center gap-3 overflow-hidden rounded-3xl border border-slate-200 bg-white p-3 text-left shadow-sm"
      >
        <img src="/meal-personal/goal-habit.jpg" alt="" className="h-20 w-20 shrink-0 rounded-2xl object-cover" />
        <span>
          <span className="block text-base font-bold text-slate-900">ログイン</span>
          <span className="mt-1 block text-xs leading-relaxed text-slate-500">登録したメールアドレス（ログインID）で入る</span>
        </span>
      </button>
      <a
        href="/meal-log/start"
        className="flex w-full items-center gap-3 overflow-hidden rounded-3xl border border-teal-800 bg-teal-800 p-3 text-left text-white shadow-sm"
      >
        <img src="/meal-personal/goal-diet.jpg" alt="" className="h-20 w-20 shrink-0 rounded-2xl object-cover" />
        <span>
          <span className="block text-base font-bold">新規スタート</span>
          <span className="mt-1 block text-xs leading-relaxed text-white/80">ニックネームとログインIDを作って、最初の質問からはじめる</span>
        </span>
      </a>
    </div>
  );
}
