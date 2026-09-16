"use client";

import { MealPersonalPanel } from "@/components/member/MealPersonalPanel";
import type { MealSlot } from "@/lib/memberMealLogs";
import { useEffect, useState } from "react";

type Gate = "checking" | "ready";

export function MealLogClient({
  signed,
  initialSlot,
}: {
  signed?: { s: string; sig: string } | null;
  initialSlot?: MealSlot | null;
}) {
  const [gate, setGate] = useState<Gate>(signed ? "ready" : "checking");
  const [locked, setLocked] = useState(false);
  const [priceLabel, setPriceLabel] = useState("食事パーソナル（月額）");
  const [subscribeUrl, setSubscribeUrl] = useState<string | null>(null);
  const [paidNotice, setPaidNotice] = useState<string | null>(null);

  useEffect(() => {
    if (signed) {
      setLocked(false);
      setGate("ready");
      return;
    }
    let cancelled = false;

    const activateIfNeeded = async () => {
      try {
        const q = new URLSearchParams(window.location.search);
        const sessionId = (q.get("session_id") || q.get("checkout_session_id") || "").trim();
        if (q.get("meal_pass") !== "success" && !sessionId) return false;
        if (!sessionId) return false;
        const res = await fetch(`/api/member/meal-personal/from-checkout?session_id=${encodeURIComponent(sessionId)}`, {
          cache: "no-store",
        });
        if (res.ok) {
          window.history.replaceState({}, "", "/meal-log");
          if (!cancelled) setPaidNotice("お申し込みが完了しました。食事記録が使えます。");
          return true;
        }
      } catch {
        // webhook 側で有効化される場合もある
      }
      return false;
    };

    (async () => {
      const justPaid = await activateIfNeeded();
      const res = await fetch("/api/member/me", { cache: "no-store" });
      if (cancelled) return;
      if (res.status === 401) {
        window.location.href = "/login";
        return;
      }
      const json = (await res.json().catch(() => ({}))) as {
        member?: { meal_personal_enabled?: boolean };
        meal_personal_pass?: { active?: boolean; subscribe_url?: string | null; price_label?: string };
      };
      const enabled = Boolean(json?.member?.meal_personal_enabled || json?.meal_personal_pass?.active || justPaid);
      setPriceLabel(json?.meal_personal_pass?.price_label || "食事パーソナル（月額）");
      setSubscribeUrl(json?.meal_personal_pass?.subscribe_url ?? "/api/member/meal-personal/checkout");
      setLocked(!enabled);
      setGate("ready");
    })().catch(() => {
      if (!cancelled) {
        setLocked(true);
        setGate("ready");
      }
    });

    return () => {
      cancelled = true;
    };
  }, [signed]);

  if (gate === "checking") {
    return <div className="rounded-2xl border border-slate-200 bg-white p-5 text-sm text-slate-600 shadow-sm">読み込み中…</div>;
  }

  return (
    <div className="space-y-4">
      {paidNotice ? (
        <div className="rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-900">{paidNotice}</div>
      ) : null}
      <MealPersonalPanel
        signed={signed}
        initialSlot={locked ? null : initialSlot}
        locked={locked}
        subscribeUrl={subscribeUrl}
        priceLabel={priceLabel}
      />
    </div>
  );
}
