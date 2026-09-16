import type { DietAreaKey } from "./storeAreas";

export type NearbyMenu = {
  name: string;
  kcal: number;
  protein_g: number;
  fat_g: number;
  carb_g: number;
  note: string;
};

export type NearbyVenue = {
  id: string;
  area: DietAreaKey;
  name: string;
  kind: "コンビニ" | "定食" | "サラダ" | "魚" | "カフェ";
  lat: number;
  lng: number;
  mapsQuery: string;
  menus: NearbyMenu[];
};

export const NEARBY_VENUES: NearbyVenue[] = [
  {
    id: "ebisu-seven",
    area: "ebisu",
    name: "セブン-イレブン 恵比寿駅前",
    kind: "コンビニ",
    lat: 35.6466,
    lng: 139.7104,
    mapsQuery: "セブンイレブン 恵比寿駅前",
    menus: [
      { name: "サラダチキン（プレーン）", kcal: 113, protein_g: 23, fat_g: 1.2, carb_g: 1.4, note: "たんぱく補給に最適" },
      { name: "グリルチキン", kcal: 160, protein_g: 22, fat_g: 6, carb_g: 4, note: "脂質も抑えめ" },
      { name: "プロテインヨーグルト", kcal: 90, protein_g: 12, fat_g: 0.5, carb_g: 9, note: "間食向け" },
    ],
  },
  {
    id: "ebisu-ootoya",
    area: "ebisu",
    name: "大戸屋 恵比寿店",
    kind: "定食",
    lat: 35.6461,
    lng: 139.7092,
    mapsQuery: "大戸屋 恵比寿",
    menus: [
      { name: "チキンかあさん煮定食", kcal: 620, protein_g: 38, fat_g: 16, carb_g: 72, note: "定食でたんぱくを取れる" },
      { name: "さばの塩焼定食", kcal: 580, protein_g: 32, fat_g: 18, carb_g: 68, note: "魚で満足感" },
    ],
  },
  {
    id: "ebisu-yayoi",
    area: "ebisu",
    name: "やよい軒 恵比寿店",
    kind: "定食",
    lat: 35.6472,
    lng: 139.711,
    mapsQuery: "やよい軒 恵比寿",
    menus: [{ name: "さば塩焼定食", kcal: 640, protein_g: 30, fat_g: 20, carb_g: 78, note: "ごはん少なめ依頼がしやすい" }],
  },
  {
    id: "ebisu-saize",
    area: "ebisu",
    name: "サイゼリヤ 恵比寿",
    kind: "カフェ",
    lat: 35.6469,
    lng: 139.7088,
    mapsQuery: "サイゼリヤ 恵比寿",
    menus: [
      { name: "チキンのグリル", kcal: 300, protein_g: 28, fat_g: 12, carb_g: 8, note: "単品で残りカロリーに合わせやすい" },
      { name: "ラムのランプステーキ", kcal: 390, protein_g: 32, fat_g: 24, carb_g: 2, note: "炭水化物を抑える日向け" },
    ],
  },
  {
    id: "ueno-seven",
    area: "ueno",
    name: "セブン-イレブン 上野駅前",
    kind: "コンビニ",
    lat: 35.7134,
    lng: 139.7768,
    mapsQuery: "セブンイレブン 上野駅",
    menus: [
      { name: "サラダチキン（プレーン）", kcal: 113, protein_g: 23, fat_g: 1.2, carb_g: 1.4, note: "たんぱく補給に最適" },
      { name: "グリルチキン", kcal: 160, protein_g: 22, fat_g: 6, carb_g: 4, note: "脂質も抑えめ" },
    ],
  },
  {
    id: "ueno-famima",
    area: "ueno",
    name: "ファミリーマート 上野公園前",
    kind: "コンビニ",
    lat: 35.7122,
    lng: 139.7745,
    mapsQuery: "ファミリーマート 上野公園前",
    menus: [
      { name: "グリルチキン", kcal: 165, protein_g: 21, fat_g: 7, carb_g: 3, note: "コンビニで一番無難" },
      { name: "サラダチキン", kcal: 120, protein_g: 22, fat_g: 2, carb_g: 2, note: "残りたんぱく向け" },
    ],
  },
  {
    id: "ueno-yayoi",
    area: "ueno",
    name: "やよい軒 上野店",
    kind: "定食",
    lat: 35.7115,
    lng: 139.7768,
    mapsQuery: "やよい軒 上野",
    menus: [{ name: "さば塩焼定食", kcal: 640, protein_g: 30, fat_g: 20, carb_g: 78, note: "上野駅から近い" }],
  },
  {
    id: "sak-seven",
    area: "sakuragicho",
    name: "セブン-イレブン 桜木町駅前",
    kind: "コンビニ",
    lat: 35.4509,
    lng: 139.6312,
    mapsQuery: "セブンイレブン 桜木町駅",
    menus: [
      { name: "サラダチキン", kcal: 113, protein_g: 23, fat_g: 1.2, carb_g: 1.4, note: "トレ前後の補食に" },
      { name: "おにぎり＋サラダチキン", kcal: 300, protein_g: 27, fat_g: 3, carb_g: 38, note: "炭水化物も欲しい日" },
    ],
  },
  {
    id: "sak-ootoya",
    area: "sakuragicho",
    name: "大戸屋 横浜店",
    kind: "定食",
    lat: 35.466,
    lng: 139.6226,
    mapsQuery: "大戸屋 横浜",
    menus: [{ name: "チキンかあさん煮定食", kcal: 620, protein_g: 38, fat_g: 16, carb_g: 72, note: "みなとみらい方面" }],
  },
  {
    id: "sak-matsuya",
    area: "sakuragicho",
    name: "松屋 桜木町",
    kind: "定食",
    lat: 35.4516,
    lng: 139.6328,
    mapsQuery: "松屋 桜木町",
    menus: [{ name: "チキン定食", kcal: 690, protein_g: 34, fat_g: 22, carb_g: 82, note: "プレミアム牛めしは脂質多めなので避ける" }],
  },
  {
    id: "shin-seven",
    area: "shinjuku",
    name: "セブン-イレブン 新宿南口",
    kind: "コンビニ",
    lat: 35.6888,
    lng: 139.7005,
    mapsQuery: "セブンイレブン 新宿南口",
    menus: [
      { name: "サラダチキン", kcal: 113, protein_g: 23, fat_g: 1.2, carb_g: 1.4, note: "移動中でも食べやすい" },
      { name: "グリルチキンサラダ", kcal: 180, protein_g: 20, fat_g: 6, carb_g: 10, note: "ドレッシングは半分に" },
    ],
  },
  {
    id: "shin-saize",
    area: "shinjuku",
    name: "サイゼリヤ 新宿",
    kind: "カフェ",
    lat: 35.6912,
    lng: 139.7018,
    mapsQuery: "サイゼリヤ 新宿",
    menus: [
      { name: "チキンのグリル", kcal: 300, protein_g: 28, fat_g: 12, carb_g: 8, note: "夜の残りカロリーに合わせやすい" },
    ],
  },
  {
    id: "shin-yayoi",
    area: "shinjuku",
    name: "やよい軒 新宿店",
    kind: "定食",
    lat: 35.6924,
    lng: 139.6991,
    mapsQuery: "やよい軒 新宿",
    menus: [{ name: "さば塩焼定食", kcal: 640, protein_g: 30, fat_g: 20, carb_g: 78, note: "ごはん少なめで依頼" }],
  },
  {
    id: "fuk-seven",
    area: "fukuoka",
    name: "セブン-イレブン 天神",
    kind: "コンビニ",
    lat: 33.5903,
    lng: 130.3994,
    mapsQuery: "セブンイレブン 天神",
    menus: [
      { name: "サラダチキン", kcal: 113, protein_g: 23, fat_g: 1.2, carb_g: 1.4, note: "補食の定番" },
      { name: "プロテインドリンク", kcal: 80, protein_g: 15, fat_g: 0.5, carb_g: 4, note: "食欲がないとき" },
    ],
  },
  {
    id: "fuk-yayoi",
    area: "fukuoka",
    name: "やよい軒 天神",
    kind: "定食",
    lat: 33.5896,
    lng: 130.4008,
    mapsQuery: "やよい軒 天神",
    menus: [{ name: "さば塩焼定食", kcal: 640, protein_g: 30, fat_g: 20, carb_g: 78, note: "魚中心で脂質を抑えめに" }],
  },
  {
    id: "fuk-ootoya",
    area: "fukuoka",
    name: "大戸屋 福岡",
    kind: "定食",
    lat: 33.5889,
    lng: 130.418,
    mapsQuery: "大戸屋 福岡",
    menus: [{ name: "チキンかあさん煮定食", kcal: 620, protein_g: 38, fat_g: 16, carb_g: 72, note: "たんぱくをしっかり" }],
  },
];
