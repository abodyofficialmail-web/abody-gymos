"use client";

import { MealPersonalPanel } from "@/components/member/MealPersonalPanel";
import type { MealSlot } from "@/lib/memberMealLogs";
import { useEffect, useState } from "react";

export function MealLogClient({
  signed,
  initialSlot,
}: {
  signed?: { s: string; sig: string } | null;
  initialSlot?: MealSlot | null;
}) {
  const [gate, setGate] = useState<"checking" | "ok" | "forbidden">(signed ? "ok" : "checking");

  useEffect(() => {
    if (signed) {
      setGate("ok");
      return;
    }
    let cancelled = false;
    fetch("/api/member/me", { cache: "no-store" })
      .then(async (res) => {
        if (cancelled) return;
        if (res.status === 401) {
          window.location.href = "/login";
          return;
        }
        const json = (await res.json().catch(() => ({}))) as { member?: { meal_personal_enabled?: boolean } };
        if (!json?.member?.meal_personal_enabled) {
          setGate("forbidden");
          return;
        }
        setGate("ok");
      })
      .catch(() => {
        if (!cancelled) setGate("ok");
      });
    return () => {
      cancelled = true;
    };
  }, [signed]);

  if (gate === "checking") {
    return <div className="rounded-2xl border border-slate-200 bg-white p-5 text-sm text-slate-600 shadow-sm">読み込み中…</div>;
  }
  if (gate === "forbidden") {
    return (
      <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        この機能は現在ご利用いただけません。
        <a href="/member" className="mx-1 font-semibold underline">
          マイページ
        </a>
        へ戻る
      </div>
    );
  }

  return <MealPersonalPanel signed={signed} initialSlot={initialSlot} />;
}
