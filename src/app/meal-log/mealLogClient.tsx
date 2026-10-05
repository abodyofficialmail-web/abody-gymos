"use client";

import { MealPersonalEntry } from "@/components/member/MealPersonalEntry";
import { MealPersonalPanel } from "@/components/member/MealPersonalPanel";
import type { MealSlot } from "@/lib/memberMealLogs";
import { isMealPersonalStandaloneAccount } from "@/lib/memberMealPersonalRollout";
import { useCallback, useEffect, useState } from "react";

type Gate = "checking" | "entry" | "ready";

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
  const [gatePaidActions, setGatePaidActions] = useState(false);
  const [sessionTickets, setSessionTickets] = useState(0);

  const refresh = useCallback(async () => {
    if (signed) {
      setLocked(false);
      setGate("ready");
      return;
    }
    setGate("checking");
    let justPaid = false;
    try {
      const q = new URLSearchParams(window.location.search);
      const sessionId = (q.get("session_id") || q.get("checkout_session_id") || "").trim();
      if (q.get("ticket") === "success" && sessionId) {
        const paid = await fetch(`/api/member/meal-personal/ticket/from-checkout?session_id=${encodeURIComponent(sessionId)}`, {
          cache: "no-store",
        });
        if (paid.ok) {
          window.history.replaceState({}, "", "/meal-log");
          setPaidNotice("パーソナルチケットを追加しました。1回予約できます。");
        }
      } else if ((q.get("meal_pass") === "success" || sessionId) && sessionId) {
        const paid = await fetch(`/api/member/meal-personal/from-checkout?session_id=${encodeURIComponent(sessionId)}`, {
          cache: "no-store",
        });
        if (paid.ok) {
          window.history.replaceState({}, "", "/meal-log");
          setPaidNotice("お申し込みが完了しました。食事記録が使えます。");
          justPaid = true;
        }
      }
    } catch {
      // webhook 側で有効化される場合もある
    }

    try {
      const res = await fetch("/api/member/me", { cache: "no-store" });
      if (res.status === 401) {
        setGate("entry");
        return;
      }
      const json = (await res.json().catch(() => ({}))) as {
        member?: { member_code?: string; meal_personal_enabled?: boolean; meal_session_tickets?: number };
        meal_personal_pass?: { active?: boolean; subscribe_url?: string | null; price_label?: string };
      };
      const standalone = isMealPersonalStandaloneAccount(json?.member?.member_code);
      const tickets = Math.max(0, Number(json?.member?.meal_session_tickets ?? 0) || 0);
      setGatePaidActions(standalone);
      setSessionTickets(tickets);
      const enabled = Boolean(json?.member?.meal_personal_enabled || json?.meal_personal_pass?.active || justPaid);
      setPriceLabel(json?.meal_personal_pass?.price_label || "食事パーソナル（月額）");
      setSubscribeUrl(json?.meal_personal_pass?.subscribe_url ?? "/api/member/meal-personal/checkout");
      setLocked(!enabled);
      setGate("ready");
    } catch {
      setLocked(true);
      setGate("ready");
    }
  }, [signed]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const links = document.querySelectorAll<HTMLElement>('header a[href="/booking"]');
    links.forEach((el) => {
      el.hidden = gatePaidActions && sessionTickets < 1;
    });
  }, [gate, gatePaidActions, sessionTickets]);

  if (gate === "checking") {
    return <div className="rounded-2xl border border-slate-200 bg-white p-5 text-sm text-slate-600 shadow-sm">読み込み中…</div>;
  }

  if (gate === "entry") {
    return <MealPersonalEntry onLoggedIn={() => void refresh()} />;
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
        gatePaidActions={gatePaidActions}
        sessionTickets={sessionTickets}
      />
    </div>
  );
}
