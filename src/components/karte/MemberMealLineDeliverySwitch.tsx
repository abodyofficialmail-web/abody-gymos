"use client";

import { useCallback, useEffect, useState } from "react";

type DeliveryState = {
  enabled: boolean;
  line_linked: boolean;
};

export function MemberMealLineDeliverySwitch({ memberId }: { memberId: string }) {
  const [state, setState] = useState<DeliveryState | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setErr(null);
    const res = await fetch(`/api/admin/members/${encodeURIComponent(memberId)}/meal-line-delivery`, { cache: "no-store" });
    const json = (await res.json().catch(() => ({}))) as DeliveryState & { error?: string };
    if (!res.ok) throw new Error(json.error || "配信設定を読み込めませんでした");
    setState({ enabled: Boolean(json.enabled), line_linked: Boolean(json.line_linked) });
  }, [memberId]);

  useEffect(() => {
    void load().catch((e: Error) => setErr(e.message));
  }, [load]);

  async function toggle() {
    if (!state) return;
    const next = !state.enabled;
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/admin/members/${encodeURIComponent(memberId)}/meal-line-delivery`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled: next }),
      });
      const json = (await res.json().catch(() => ({}))) as DeliveryState & { error?: string };
      if (!res.ok) throw new Error(json.error || "保存に失敗しました");
      setState({ enabled: Boolean(json.enabled), line_linked: Boolean(json.line_linked) });
    } catch (e) {
      setErr(String((e as Error)?.message ?? "保存に失敗しました"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-start justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-3">
      <div className="min-w-0 space-y-1">
        <div className="text-sm font-bold text-slate-900">食事のLINE配信</div>
        <p className="text-xs leading-relaxed text-slate-600">朝・昼・夜・間食の記録案内をLINEで送ります。</p>
        <div className="text-xs font-semibold text-slate-700">
          {state ? (state.enabled ? "現在: ON（送信する）" : "現在: OFF（送らない）") : "読み込み中…"}
          {busy ? " …更新中" : ""}
        </div>
        {state && !state.line_linked ? (
          <p className="text-xs leading-relaxed text-amber-800">LINE未連携のため、ONにしても届きません。</p>
        ) : null}
        {err ? <p className="text-xs text-red-700">{err}</p> : null}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={Boolean(state?.enabled)}
        aria-label="食事のLINE配信"
        disabled={!state || busy}
        onClick={() => void toggle()}
        className={[
          "relative mt-0.5 h-8 w-14 shrink-0 rounded-full transition-colors disabled:opacity-60",
          state?.enabled ? "bg-slate-900" : "bg-slate-300",
        ].join(" ")}
      >
        <span
          className={[
            "absolute top-1 h-6 w-6 rounded-full bg-white shadow transition-transform",
            state?.enabled ? "left-7" : "left-1",
          ].join(" ")}
        />
      </button>
    </div>
  );
}
