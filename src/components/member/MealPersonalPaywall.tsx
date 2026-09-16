"use client";

import { Lock } from "lucide-react";
import type { ReactNode } from "react";

export function MealPersonalPaywall({
  priceLabel,
  subscribeUrl,
  children,
}: {
  priceLabel: string;
  subscribeUrl: string | null;
  children: ReactNode;
}) {
  return (
    <div className="relative isolate min-h-[28rem] overflow-hidden rounded-2xl">
      <div
        className="pointer-events-none select-none"
        aria-hidden
        style={{
          filter: "blur(8px) contrast(1.12) saturate(0.8)",
          transform: "scale(1.03)",
        }}
      >
        {children}
      </div>
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage:
            "repeating-linear-gradient(0deg, rgba(255,255,255,0.42) 0 2px, transparent 2px 9px), repeating-linear-gradient(90deg, rgba(241,245,249,0.5) 0 2px, transparent 2px 9px)",
        }}
      />
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-slate-900/20 px-6 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-white/95 text-slate-900 shadow-lg">
          <Lock className="h-7 w-7" strokeWidth={2.4} />
        </div>
        <div className="max-w-xs rounded-2xl bg-white/95 px-4 py-3 shadow-lg">
          <div className="text-sm font-bold text-slate-900">課金すると使えます</div>
          <p className="mt-1 text-xs leading-relaxed text-slate-600">
            {priceLabel}に申し込むと、日記・記録・提案のモザイクが外れます。
          </p>
        </div>
        {subscribeUrl ? (
          <a
            href={subscribeUrl}
            className="inline-flex items-center justify-center rounded-xl bg-teal-800 px-5 py-2.5 text-sm font-semibold text-white shadow-lg"
          >
            オプションを申し込む
          </a>
        ) : (
          <p className="rounded-xl bg-white/95 px-4 py-2 text-xs font-semibold text-slate-700 shadow">
            現在お申し込みの準備中です
          </p>
        )}
      </div>
    </div>
  );
}
