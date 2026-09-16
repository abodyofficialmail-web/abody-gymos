"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { WeightOutlook } from "@/lib/diet/weightOutlook";

export const HOME_PAGE_CLASS = "min-w-0 snap-start px-4 flex-[0_0_100%]";

function formatKg(n: number) {
  return `${n.toFixed(1)}kg`;
}

function deltaText(n: number) {
  if (n === 0) return "±0";
  return `${n > 0 ? "+" : ""}${n.toFixed(1)}kg`;
}

function toneOf(monthlyKg: number) {
  if (monthlyKg < 0) return "loss" as const;
  if (monthlyKg > 0) return "gain" as const;
  return "flat" as const;
}

const TONE_DELTA = {
  loss: "text-emerald-700",
  gain: "text-amber-700",
  flat: "text-slate-500",
};

export function WeightOutlookStrip({ outlook }: { outlook: WeightOutlook }) {
  const tone = toneOf(outlook.monthly_kg);
  const points = outlook.points.filter((p) => p.months > 0);
  return (
    <div className="space-y-2">
      <div className="text-sm font-bold text-slate-900">この調子なら</div>
      <div className="grid grid-cols-3 gap-2">
        {points.map((p) => (
          <div key={p.months} className="rounded-2xl border border-slate-200 bg-white px-2 py-3 text-center shadow-sm">
            <div className="text-[10px] font-semibold text-slate-500">{p.months}ヶ月後</div>
            <div className="mt-1 text-base font-bold text-slate-900">{p.kg.toFixed(1)}kg</div>
            <div className={`mt-0.5 text-[11px] font-semibold ${TONE_DELTA[tone]}`}>{deltaText(p.delta_kg)}</div>
          </div>
        ))}
      </div>
      <p className="text-[11px] leading-relaxed text-slate-500">
        いま {formatKg(outlook.current_kg)}。{outlook.note}
      </p>
    </div>
  );
}

export function HomeSwipePager({
  children,
  labels,
}: {
  children: ReactNode;
  labels?: string[];
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);
  const [total, setTotal] = useState(1);

  const sync = useCallback(() => {
    const el = scroller.current;
    if (!el) return;
    const n = el.children.length;
    setTotal(Math.max(1, n));
    const w = el.clientWidth;
    if (w <= 0) return;
    setIndex(Math.max(0, Math.min(n - 1, Math.round(el.scrollLeft / w))));
  }, []);

  useEffect(() => {
    sync();
    const el = scroller.current;
    if (!el) return;
    const obs = new MutationObserver(sync);
    obs.observe(el, { childList: true });
    return () => obs.disconnect();
  }, [sync, children]);

  function goTo(i: number) {
    const el = scroller.current;
    if (!el) return;
    el.scrollTo({ left: i * el.clientWidth, behavior: "smooth" });
  }

  return (
    <div className="relative -mx-4">
      <div
        ref={scroller}
        onScroll={sync}
        onTouchEnd={sync}
        className="flex snap-x snap-mandatory overflow-x-auto overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {children}
      </div>
      {total > 1 ? (
        <div className="fixed inset-x-0 bottom-[5.5rem] z-20 flex justify-center gap-1.5">
          {Array.from({ length: total }, (_, i) => (
            <button
              key={i}
              type="button"
              aria-label={labels?.[i] ?? (i === 0 ? "1枚目" : `${i + 1}枚目`)}
              onClick={() => goTo(i)}
              className={`h-1.5 rounded-full transition-all ${
                i === index ? "w-5 bg-slate-800" : "w-1.5 bg-slate-300"
              }`}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
