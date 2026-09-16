"use client";

import { ChefHat, ChevronDown, ExternalLink, Play } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  cookpadSearchUrl,
  homeCookCoverUrl,
  suggestHomeCooks,
  youtubeSearchUrl,
  youtubeThumbUrl,
  youtubeWatchUrl,
  type HomeCookMeal,
} from "@/lib/diet/homeCooks";
import type { MealRemaining } from "@/lib/memberMealLogs";

export function HomeCookSuggest({ remaining }: { remaining: MealRemaining | null }) {
  const meals = useMemo(() => suggestHomeCooks(remaining, 3), [remaining]);
  const [openId, setOpenId] = useState<string | null>(null);

  return (
    <div className="space-y-2 border-t border-slate-100 pt-3">
      <div className="flex items-start gap-2">
        <ChefHat className="mt-0.5 h-5 w-5 shrink-0 text-orange-700" />
        <div>
          <div className="text-sm font-bold text-slate-900">おすすめの自炊</div>
          <p className="mt-0.5 text-xs leading-relaxed text-slate-600">
            {remaining
              ? `残り ${Math.round(remaining.kcal)}kcal に合う家メニューです。メニューをタップすると食材と作り方が出ます。`
              : "たんぱくを取りやすい家メニューです。メニューをタップすると食材と作り方が出ます。"}
          </p>
        </div>
      </div>
      <div className="grid gap-2">
        {meals.map((meal) => (
          <HomeCookCard
            key={meal.id}
            meal={meal}
            open={openId === meal.id}
            onToggle={() => setOpenId((cur) => (cur === meal.id ? null : meal.id))}
          />
        ))}
      </div>
    </div>
  );
}

function HomeCookCard({
  meal,
  open,
  onToggle,
}: {
  meal: HomeCookMeal;
  open: boolean;
  onToggle: () => void;
}) {
  const cover = homeCookCoverUrl(meal);
  const cookpad = cookpadSearchUrl(meal.cookpadQuery);
  const youtube = meal.youtubeId ? youtubeWatchUrl(meal.youtubeId) : youtubeSearchUrl(meal.youtubeQuery);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    if (!open) setPlaying(false);
  }, [open]);

  return (
    <div className={["overflow-hidden rounded-2xl border", open ? "border-orange-200 bg-orange-50/40" : "border-slate-200 bg-white"].join(" ")}>
      <button type="button" onClick={onToggle} aria-expanded={open} className="flex w-full items-stretch gap-3 p-3 text-left">
        <span className="relative h-20 w-24 shrink-0 overflow-hidden rounded-xl bg-slate-100">
          {cover ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={cover} alt={meal.imageAlt} className="h-full w-full object-cover" />
          ) : (
            <span className="flex h-full items-center justify-center text-xs text-slate-400">自炊</span>
          )}
          {meal.youtubeId ? (
            <span className="absolute inset-0 flex items-center justify-center bg-black/20">
              <Play className="h-6 w-6 fill-white text-white" />
            </span>
          ) : null}
        </span>
        <span className="min-w-0 flex-1 py-0.5">
          <span className="text-[11px] font-semibold text-orange-800">自炊・約{meal.minutes}分</span>
          <span className="mt-0.5 block text-sm font-bold leading-snug text-slate-900">{meal.name}</span>
          <span className="mt-0.5 block text-xs font-semibold text-slate-700">
            {meal.kcal}kcal　P {meal.protein_g} / F {meal.fat_g} / C {meal.carb_g}
          </span>
          <span className="mt-1 block text-xs leading-relaxed text-slate-500">{meal.why}</span>
        </span>
        <ChevronDown className={["mt-2 h-4 w-4 shrink-0 text-slate-400 transition", open ? "rotate-180" : ""].join(" ")} />
      </button>

      {open ? (
        <div className="space-y-3 border-t border-orange-100 px-3 pb-3 pt-3">
          {meal.youtubeId && playing ? (
            <div className="overflow-hidden rounded-xl bg-black">
              <iframe
                title={meal.youtubeTitle ?? meal.name}
                src={`https://www.youtube-nocookie.com/embed/${meal.youtubeId}?autoplay=1`}
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                allowFullScreen
                className="aspect-video w-full border-0"
              />
            </div>
          ) : meal.youtubeId ? (
            <button
              type="button"
              onClick={() => setPlaying(true)}
              className="relative block w-full overflow-hidden rounded-xl"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={youtubeThumbUrl(meal.youtubeId)}
                alt={meal.youtubeTitle ?? meal.imageAlt}
                className="aspect-video w-full object-cover"
              />
              <span className="absolute inset-0 flex flex-col items-center justify-center bg-black/30">
                <span className="flex h-12 w-12 items-center justify-center rounded-full bg-red-600 text-white shadow">
                  <Play className="h-6 w-6 fill-white" />
                </span>
                <span className="mt-2 max-w-[90%] truncate rounded-full bg-black/55 px-3 py-1 text-[11px] font-semibold text-white">
                  {meal.youtubeTitle ?? "YouTubeで作り方を見る"}
                </span>
              </span>
            </button>
          ) : cover ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={cover} alt={meal.imageAlt} className="h-36 w-full rounded-xl object-cover" />
          ) : null}

          <div>
            <div className="text-xs font-bold text-slate-800">必要食材（1人分）</div>
            <ul className="mt-1.5 divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
              {meal.ingredients.map((item) => (
                <li key={item.name} className="flex items-baseline justify-between gap-3 px-3 py-1.5 text-xs">
                  <span className="text-slate-800">{item.name}</span>
                  <span className="shrink-0 font-semibold text-slate-600">{item.amount}</span>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <div className="text-xs font-bold text-slate-800">調理方法</div>
            <ol className="mt-1.5 space-y-1.5">
              {meal.steps.map((step, i) => (
                <li key={step} className="flex gap-2 text-xs leading-relaxed text-slate-700">
                  <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-orange-700 text-[10px] font-bold text-white">
                    {i + 1}
                  </span>
                  <span>{step}</span>
                </li>
              ))}
            </ol>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <a
              href={cookpad}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center gap-1 rounded-xl border border-slate-200 bg-white px-2 py-2 text-[11px] font-semibold text-slate-800"
            >
              クックパッド
              <ExternalLink className="h-3 w-3" />
            </a>
            <a
              href={youtube}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center gap-1 rounded-xl border border-red-200 bg-white px-2 py-2 text-[11px] font-semibold text-red-800"
            >
              YouTube
              <ExternalLink className="h-3 w-3" />
            </a>
          </div>
          <p className="text-[10px] leading-relaxed text-slate-500">
            食材と手順はジム向けの1人分量です。動画・クックパッドは作り方の参考リンクです。
          </p>
        </div>
      ) : null}
    </div>
  );
}
