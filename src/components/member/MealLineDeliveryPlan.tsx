"use client";

import { DateTime } from "luxon";
import { useEffect, useState } from "react";
import {
  MEAL_LINE_DELIVERY_PRICE_LABEL,
  MEAL_LINE_DELIVERY_TRIAL_BUTTON,
  MEAL_LINE_DELIVERY_TRIAL_NOTE,
  type MealLineDeliveryView,
} from "@/lib/mealLineDelivery";

function formatTrialEnd(iso: string | null): string {
  if (!iso) return "";
  const dt = DateTime.fromISO(iso).setZone("Asia/Tokyo");
  if (!dt.isValid) return "";
  return dt.toFormat("M月d日 HH:mm");
}

export function MealLineDeliveryPlan({ onChange }: { onChange?: (view: MealLineDeliveryView) => void }) {
  const [view, setView] = useState<MealLineDeliveryView | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/member/meal-line-delivery", { cache: "no-store" })
      .then(async (res) => {
        const json = (await res.json().catch(() => ({}))) as { delivery?: MealLineDeliveryView; error?: string };
        if (!res.ok) throw new Error(json.error || "配信プランを読み込めませんでした");
        if (!cancelled && json.delivery) {
          setView(json.delivery);
          onChange?.(json.delivery);
        }
      })
      .catch((e: Error) => {
        if (!cancelled) setErr(e.message);
      });
    return () => {
      cancelled = true;
    };
    // 初回だけ読む。開始後は startTrial 側で onChange する。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function startTrial() {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/member/meal-line-delivery/trial", { method: "POST" });
      const json = (await res.json().catch(() => ({}))) as { delivery?: MealLineDeliveryView; error?: string };
      if (!res.ok) throw new Error(json.error || "お試しを開始できませんでした");
      if (json.delivery) {
        setView(json.delivery);
        onChange?.(json.delivery);
      }
    } catch (e) {
      setErr(String((e as Error)?.message ?? "お試しを開始できませんでした"));
    } finally {
      setBusy(false);
    }
  }

  const price = view?.price_label || MEAL_LINE_DELIVERY_PRICE_LABEL;
  const button = view?.trial_button_label || MEAL_LINE_DELIVERY_TRIAL_BUTTON;
  const endLabel = formatTrialEnd(view?.trial_ends_at ?? null);

  return (
    <section className="space-y-3 rounded-2xl border border-teal-200 bg-white p-5 shadow-sm">
      <div className="space-y-1">
        <div className="text-sm font-bold text-slate-900">LINE配信プラン</div>
        <p className="text-xs leading-relaxed text-slate-600">
          朝・昼・夜・間食の記録案内を、設定した時間にLINEで送ります。
        </p>
        <div className="text-sm font-semibold text-slate-900">{price}</div>
      </div>

      {view?.status === "trial" ? (
        <div className="rounded-xl bg-teal-50 px-3 py-2 text-sm text-teal-900">
          お試し配信中です。{endLabel ? `${endLabel}まで届きます。` : "期間中、配信が届きます。"}
        </div>
      ) : null}
      {view?.status === "active" ? (
        <div className="rounded-xl bg-teal-50 px-3 py-2 text-sm text-teal-900">配信中です。</div>
      ) : null}
      {view?.status === "expired" ? (
        <div className="rounded-xl bg-slate-50 px-3 py-2 text-sm text-slate-700">
          お試しは終了しました。続けるには{price}です。
        </div>
      ) : null}

      {view?.staff_controlled && !view.entitled ? (
        <div className="rounded-xl bg-slate-50 px-3 py-2 text-sm text-slate-700">配信は停止中です。</div>
      ) : null}

      {view && view.status === "none" && !view.staff_controlled ? (
        <div className="space-y-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => void startTrial()}
            className="inline-flex w-full items-center justify-center rounded-xl bg-teal-800 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
          >
            {busy ? "開始しています…" : button}
          </button>
          <p className="text-xs leading-relaxed text-slate-500">{MEAL_LINE_DELIVERY_TRIAL_NOTE}</p>
        </div>
      ) : null}

      {view && !view.entitled && view.subscribe_url ? (
        <a
          href={view.subscribe_url}
          className="inline-flex w-full items-center justify-center rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-800"
        >
          {price}で申し込む
        </a>
      ) : null}

      {err ? <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">{err}</div> : null}
    </section>
  );
}
