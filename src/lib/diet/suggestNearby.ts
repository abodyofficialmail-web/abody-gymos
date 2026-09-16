import { NEARBY_VENUES, type NearbyMenu, type NearbyVenue } from "./nearbyCatalog";
import { DIET_AREAS, haversineKm, nearestArea, type DietArea } from "./storeAreas";

export type RemainingPfc = {
  kcal: number;
  protein_g: number;
  fat_g: number;
  carb_g: number;
};

export type NearbySuggestion = {
  venue: NearbyVenue;
  menu: NearbyMenu;
  distance_km: number;
  reason: string;
};

function menuScore(menu: NearbyMenu, remaining: RemainingPfc | null) {
  if (!remaining) return menu.protein_g * 2 - menu.fat_g;
  const kcalCap = Math.max(250, remaining.kcal);
  const overKcal = Math.max(0, menu.kcal - kcalCap);
  const proteinNeed = remaining.protein_g;
  const proteinHit = proteinNeed > 15 ? Math.min(menu.protein_g, proteinNeed) : menu.protein_g * 0.4;
  const fatPenalty = remaining.fat_g < 12 ? menu.fat_g * 2 : menu.fat_g * 0.3;
  return proteinHit * 4 - overKcal * 0.08 - fatPenalty;
}

export function suggestNearby(params: {
  lat?: number | null;
  lng?: number | null;
  area?: DietArea;
  remaining: RemainingPfc | null;
  limit?: number;
}): { area: DietArea; suggestions: NearbySuggestion[] } {
  const area =
    params.area ??
    (params.lat != null && params.lng != null ? nearestArea(params.lat, params.lng) : DIET_AREAS[0]);
  const originLat = params.lat ?? area.lat;
  const originLng = params.lng ?? area.lng;
  const venues = NEARBY_VENUES.filter((v) => v.area === area.key);
  const scored: NearbySuggestion[] = [];
  for (const venue of venues) {
    const best = venue.menus
      .map((menu) => ({ menu, score: menuScore(menu, params.remaining) }))
      .sort((a, b) => b.score - a.score)[0];
    if (!best) continue;
    const distance_km = Math.round(haversineKm(originLat, originLng, venue.lat, venue.lng) * 100) / 100;
    const remaining = params.remaining;
    let reason = best.menu.note;
    if (remaining) {
      if (remaining.protein_g > 20 && best.menu.protein_g >= 20) {
        reason = `残りたんぱく ${remaining.protein_g}g。${best.menu.name}なら目安${best.menu.protein_g}g取れる`;
      } else if (remaining.kcal < 500 && best.menu.kcal <= remaining.kcal) {
        reason = `残り ${Math.round(remaining.kcal)}kcal に収まる`;
      } else if (remaining.fat_g < 12) {
        reason = `今日は脂質が残り少ないので、揚げ物を外した選択`;
      }
    }
    scored.push({ venue, menu: best.menu, distance_km, reason });
  }
  scored.sort((a, b) => menuScore(b.menu, params.remaining) - menuScore(a.menu, params.remaining) || a.distance_km - b.distance_km);
  return { area, suggestions: scored.slice(0, params.limit ?? 3) };
}
