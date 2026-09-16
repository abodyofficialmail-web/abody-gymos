"use client";

import { useMemo, useState } from "react";
import { NEARBY_VENUES } from "@/lib/diet/nearbyCatalog";
import { areaFromStoreName, nearestArea, type DietArea } from "@/lib/diet/storeAreas";
import { suggestNearby, type NearbySuggestion } from "@/lib/diet/suggestNearby";
import type { MealRemaining } from "@/lib/memberMealLogs";

export function NearbyMealSuggest({
  remaining,
  storeName,
  lat,
  lng,
}: {
  remaining: MealRemaining | null;
  storeName?: string | null;
  lat?: number | null;
  lng?: number | null;
}) {
  const { area, suggestions } = useMemo(() => {
    const area: DietArea =
      lat != null && lng != null ? nearestArea(lat, lng) : areaFromStoreName(storeName);
    return suggestNearby({
      lat,
      lng,
      area,
      remaining: remaining
        ? {
            kcal: remaining.kcal,
            protein_g: remaining.protein_g,
            fat_g: remaining.fat_g,
            carb_g: remaining.carb_g,
          }
        : null,
      limit: 3,
    });
  }, [lat, lng, remaining, storeName]);

  const venues = useMemo(() => NEARBY_VENUES.filter((v) => v.area === area.key), [area.key]);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const bounds = useMemo(() => {
    const lats = venues.map((v) => v.lat);
    const lngs = venues.map((v) => v.lng);
    const minLat = Math.min(...lats, area.lat);
    const maxLat = Math.max(...lats, area.lat);
    const minLng = Math.min(...lngs, area.lng);
    const maxLng = Math.max(...lngs, area.lng);
    const padLat = Math.max((maxLat - minLat) * 0.2, 0.002);
    const padLng = Math.max((maxLng - minLng) * 0.2, 0.002);
    return {
      minLat: minLat - padLat,
      maxLat: maxLat + padLat,
      minLng: minLng - padLng,
      maxLng: maxLng + padLng,
    };
  }, [area.lat, area.lng, venues]);

  function xy(lat: number, lng: number) {
    const x = ((lng - bounds.minLng) / Math.max(bounds.maxLng - bounds.minLng, 0.0001)) * 100;
    const y = (1 - (lat - bounds.minLat) / Math.max(bounds.maxLat - bounds.minLat, 0.0001)) * 100;
    return { x: Math.min(96, Math.max(4, x)), y: Math.min(92, Math.max(8, y)) };
  }

  const you = xy(lat ?? area.lat, lng ?? area.lng);

  return (
    <div className="space-y-3">
      <div className="flex items-end justify-between gap-2">
        <div>
          <div className="text-sm font-bold text-slate-900">{area.label}周辺のおすすめ</div>
          <p className="text-xs text-slate-500">
            {remaining
              ? `今日の残り ${Math.round(remaining.kcal)}kcal / P ${remaining.protein_g}g。数字が分かるチェーンから選んでいます。`
              : "目標カロリー未設定のため、たんぱく多めの定番を出しています。"}
          </p>
        </div>
      </div>

      <div className="relative overflow-hidden rounded-2xl border border-slate-200 bg-slate-100" style={{ height: 220 }}>
        <div className="absolute inset-0 bg-[linear-gradient(#e2e8f0_1px,transparent_1px),linear-gradient(90deg,#e2e8f0_1px,transparent_1px)] bg-[size:28px_28px]" />
        <div
          className="absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-sky-500 shadow"
          style={{ left: `${you.x}%`, top: `${you.y}%` }}
          title="いまの位置"
        />
        {venues.map((v) => {
          const p = xy(v.lat, v.lng);
          const active = selectedId === v.id || suggestions.some((s) => s.venue.id === v.id);
          return (
            <button
              key={v.id}
              type="button"
              onClick={() => setSelectedId(v.id)}
              className={[
                "absolute -translate-x-1/2 -translate-y-full text-[10px] font-semibold",
                active ? "z-10 text-teal-800" : "text-slate-600",
              ].join(" ")}
              style={{ left: `${p.x}%`, top: `${p.y}%` }}
            >
              <span
                className={[
                  "mb-0.5 block h-2.5 w-2.5 rounded-full border-2 border-white shadow",
                  active ? "bg-teal-600" : "bg-slate-400",
                ].join(" ")}
              />
              {v.kind}
            </button>
          );
        })}
      </div>
      <div className="text-[11px] text-slate-500">青がいまの位置（許可しない場合は所属店舗）。緑がおすすめ候補です。</div>

      <div className="grid gap-2">
        {suggestions.map((row) => (
          <SuggestionCard
            key={row.venue.id}
            row={row}
            active={selectedId === row.venue.id}
            onSelect={() => setSelectedId(row.venue.id)}
          />
        ))}
      </div>
    </div>
  );
}

function SuggestionCard({
  row,
  active,
  onSelect,
}: {
  row: NearbySuggestion;
  active: boolean;
  onSelect: () => void;
}) {
  const maps = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(row.venue.mapsQuery)}`;
  return (
    <button
      type="button"
      onClick={onSelect}
      className={[
        "w-full rounded-2xl border px-4 py-3 text-left",
        active ? "border-teal-300 bg-teal-50" : "border-slate-200 bg-white",
      ].join(" ")}
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-[11px] font-semibold text-teal-800">{row.venue.kind}</div>
          <div className="text-sm font-bold text-slate-900">{row.venue.name}</div>
        </div>
        <div className="shrink-0 text-right text-xs font-semibold text-slate-500">{row.distance_km}km</div>
      </div>
      <div className="mt-1 text-sm font-semibold text-slate-800">{row.menu.name}</div>
      <div className="mt-0.5 text-xs text-slate-600">
        {row.menu.kcal}kcal / P {row.menu.protein_g}g / F {row.menu.fat_g}g / C {row.menu.carb_g}g
      </div>
      <p className="mt-1 text-xs leading-relaxed text-slate-500">{row.reason}</p>
      <a
        href={maps}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => e.stopPropagation()}
        className="mt-2 inline-flex text-xs font-semibold text-teal-800 underline"
      >
        地図アプリで開く
      </a>
    </button>
  );
}
