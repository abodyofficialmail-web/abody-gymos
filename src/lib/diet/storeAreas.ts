export type DietAreaKey = "ebisu" | "ueno" | "sakuragicho" | "shinjuku" | "fukuoka";

export type DietArea = {
  key: DietAreaKey;
  label: string;
  names: string[];
  lat: number;
  lng: number;
};

export const DIET_AREAS: DietArea[] = [
  { key: "ebisu", label: "恵比寿", names: ["恵比寿"], lat: 35.6467, lng: 139.7101 },
  { key: "ueno", label: "上野", names: ["上野"], lat: 35.7138, lng: 139.7773 },
  { key: "sakuragicho", label: "桜木町", names: ["桜木町", "横浜"], lat: 35.4508, lng: 139.6317 },
  { key: "shinjuku", label: "新宿", names: ["新宿"], lat: 35.6909, lng: 139.7003 },
  { key: "fukuoka", label: "福岡", names: ["福岡", "天神"], lat: 33.5902, lng: 130.4017 },
];

export function haversineKm(aLat: number, aLng: number, bLat: number, bLng: number) {
  const toRad = (n: number) => (n * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
}

export function nearestArea(lat: number, lng: number): DietArea {
  return DIET_AREAS.slice()
    .sort((a, b) => haversineKm(lat, lng, a.lat, a.lng) - haversineKm(lat, lng, b.lat, b.lng))[0];
}

export function areaFromStoreName(storeName: string | null | undefined): DietArea {
  const n = String(storeName ?? "");
  return DIET_AREAS.find((a) => a.names.some((x) => n.includes(x))) ?? DIET_AREAS[0];
}
