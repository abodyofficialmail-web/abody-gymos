"use client";

import { formatIntakeLabel, type MemberNutritionTargetView } from "@/lib/memberNutritionTargets";
import { useEffect, useState } from "react";

function pfcPercents(target: MemberNutritionTargetView) {
  const p = target.protein_g * 4;
  const f = target.fat_g * 9;
  const c = target.carb_g * 4;
  const total = p + f + c;
  if (total <= 0) return { p: 0, f: 0, c: 0 };
  return {
    p: Math.round((p / total) * 100),
    f: Math.round((f / total) * 100),
    c: Math.round((c / total) * 100),
  };
}

export function MealPersonalLockedPreview({
  priceLabel,
  subscribeUrl,
}: {
  priceLabel: string;
  subscribeUrl: string | null;
}) {
  const [loading, setLoading] = useState(true);
  const [target, setTarget] = useState<MemberNutritionTargetView | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/member/nutrition-targets", { cache: "no-store" })
      .then(async (res) => {
        const json = (await res.json().catch(() => ({}))) as { target?: MemberNutritionTargetView | null };
        if (!cancelled) setTarget(json.target ?? null);
      })
      .catch(() => {
        if (!cancelled) setTarget(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const pct = target ? pfcPercents(target) : null;

  return (
    <div className="space-y-4">
      {loading ? (
        <section className="rounded-2xl border border-slate-200 bg-white p-5 text-sm text-slate-600 shadow-sm">
          読み込み中…
        </section>
      ) : target ? (
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm space-y-3">
          <div className="space-y-1">
            <div className="text-sm font-bold text-slate-900">いまの消費カロリー・PFC</div>
            <p className="text-xs leading-relaxed text-slate-500">
              目標達成のための1日の目安です。トレーナーが調整する場合があります。
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3">
              <div className="text-[11px] font-semibold text-slate-500">1日の消費カロリー</div>
              <div className="mt-0.5 text-lg font-bold text-slate-900">
                {target.daily_expenditure_kcal}
                <span className="ml-1 text-xs font-semibold text-slate-500">kcal</span>
              </div>
            </div>
            <div className="rounded-xl border border-teal-200 bg-teal-50 px-3 py-3">
              <div className="text-[11px] font-semibold text-teal-800">目標摂取カロリー</div>
              <div className="mt-0.5 text-lg font-bold text-teal-900">
                {formatIntakeLabel(target)}
                <span className="ml-1 text-xs font-semibold text-teal-700">kcal</span>
              </div>
            </div>
          </div>
          <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 space-y-2">
            <div className="text-[11px] font-semibold text-slate-500">PFCバランス</div>
            <div className="grid grid-cols-3 gap-2 text-center">
              <div>
                <div className="text-[11px] font-semibold text-rose-700">P たんぱく質</div>
                <div className="text-base font-bold text-slate-900">{target.protein_g}g</div>
                <div className="text-[11px] text-slate-500">{pct?.p ?? 0}%</div>
              </div>
              <div>
                <div className="text-[11px] font-semibold text-amber-700">F 脂質</div>
                <div className="text-base font-bold text-slate-900">{target.fat_g}g</div>
                <div className="text-[11px] text-slate-500">{pct?.f ?? 0}%</div>
              </div>
              <div>
                <div className="text-[11px] font-semibold text-sky-700">C 炭水化物</div>
                <div className="text-base font-bold text-slate-900">{target.carb_g}g</div>
                <div className="text-[11px] text-slate-500">{pct?.c ?? 0}%</div>
              </div>
            </div>
            <div className="flex h-2 overflow-hidden rounded-full bg-slate-200">
              <div className="bg-rose-400" style={{ width: `${pct?.p ?? 0}%` }} />
              <div className="bg-amber-400" style={{ width: `${pct?.f ?? 0}%` }} />
              <div className="bg-sky-400" style={{ width: `${pct?.c ?? 0}%` }} />
            </div>
          </div>
          {target.note ? <div className="text-xs text-slate-600">※{target.note}</div> : null}
        </section>
      ) : (
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm space-y-2">
          <div className="text-sm font-bold text-slate-900">いまの消費カロリー・PFC</div>
          <p className="text-sm leading-relaxed text-slate-600">
            目標ヒアリングがまだのため、消費カロリーとPFCは表示できません。ヒアリング後に、いまの目安が出ます。
          </p>
          <a href="/member" className="inline-block text-sm font-semibold text-teal-800 underline">
            マイページで確認する
          </a>
        </section>
      )}

      <section className="rounded-2xl border border-teal-200 bg-teal-50 p-5 shadow-sm space-y-3">
        <div className="text-sm font-bold text-teal-950">食事記録・アドバイスはオプションです</div>
        <p className="text-sm leading-relaxed text-teal-900">
          {priceLabel}に申し込むと、写真からのカロリー計算、今日の残り、LINEリマインドなど食事パーソナルの全機能が使えます。
        </p>
        <ul className="list-disc space-y-1 pl-5 text-sm text-teal-900">
          <li>食事の写真・バーコードからカロリーとPFCを記録</li>
          <li>今日の残りカロリーとアドバイス</li>
          <li>朝・昼・夜・間食のLINE案内</li>
        </ul>
        {subscribeUrl ? (
          <a
            href={subscribeUrl}
            className="inline-flex items-center justify-center rounded-xl bg-teal-800 px-4 py-2.5 text-sm font-semibold text-white"
          >
            オプションを申し込む
          </a>
        ) : (
          <p className="text-sm font-semibold text-teal-900">現在お申し込みの準備中です。もうしばらくお待ちください。</p>
        )}
      </section>
    </div>
  );
}
