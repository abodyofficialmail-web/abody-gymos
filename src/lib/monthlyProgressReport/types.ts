export type MonthlyProgressPhotoAngle = {
  frontUrl: string | null;
  backUrl: string | null;
  sideUrl: string | null;
};

export type MonthlyProgressPhotoSet = {
  photoDate: string;
  label: string;
  roleLabel?: string;
  angles: MonthlyProgressPhotoAngle;
};

export type WeightProgressRow = {
  exercise: string;
  firstMax: number;
  firstDate: string;
  prevMonthMax: number | null;
  monthMax: number;
  vsPrev: number | null;
  vsFirst: number;
  growthPct: number;
  /** 先月比の伸び率（%） */
  vsPrevPct?: number | null;
  julySets: number;
  /** 来月の目標重量（AI推定） */
  nextTarget?: number;
  /** 今月→来月の想定伸び kg */
  nextDelta?: number;
  /** 今月→来月の想定伸び率 % */
  nextGrowthPct?: number;
  /** 推定根拠の短い説明（ルール） */
  nextReason?: string;
  /** LLM（またはフォールバック）の根拠コメント ※キャッシュ読込 */
  aiRationale?: string;
  /** トレーナー向け一言 ※キャッシュ読込 */
  trainerTip?: string;
  aiCommentModel?: string | null;
  /** 基準月に実施があったか（ライブ表示用） */
  hasCurrentMonth?: boolean;
};

export type PartRatio = {
  part: string;
  count: number;
  pct: number;
};

export type MonthlyProgressReport = {
  meta: {
    yearMonth: string; // 2026-07
    yearMonthLabel: string; // 2026年7月
    nextMonthLabel: string; // 8月
    generatedAt: string;
  };
  member: {
    id: string;
    memberCode: string;
    name: string;
    storeName: string;
    joinedAt: string;
    tenureMonths: number;
  };
  trainer: {
    id: string;
    displayName: string;
  } | null;
  photos: {
    /** 一番古い写真 */
    oldest?: MonthlyProgressPhotoSet | null;
    /** 先月（または中間） */
    previous?: MonthlyProgressPhotoSet | null;
    /** 今月 */
    current?: MonthlyProgressPhotoSet | null;
    /** 互換: 最古 */
    before: MonthlyProgressPhotoSet | null;
    /** 互換: 今月寄り */
    after: MonthlyProgressPhotoSet | null;
    hasComparison: boolean;
    hasTimeline?: boolean;
    hasAny?: boolean;
    record?: MonthlyProgressPhotoSet | null;
  };
  metrics: {
    visitCount: number;
    totalMinutes: number;
    estimatedKcal: number;
    cumulativeVisits: number;
    avgSatisfaction: number | null;
    surveyResponseRate: number | null;
    bookingAchievementRate: number | null;
    abodyScore: number;
    overallGrade: string;
  };
  visitDates: string[]; // YYYY-MM-DD
  partRatios: PartRatio[];
  topExercises: { exercise: string; sets: number }[];
  weightRows: WeightProgressRow[];
  volumeTrend: { month: string; totalKg: number; avgKg: number; sets: number }[];
  feedbacks: { date: string; text: string }[];
  ai: {
    overallComment: string;
    postureItems: { key: string; label: string; stars: number; summary: string; detail: string }[];
    overallAnalysisFallback: string;
    achievements: { title: string; detail: string }[];
    analysis: {
      mostImproved: string;
      plateau: string;
      focusPart: string;
      strongPart: string;
      challengePart: string;
      narrative: string;
    };
    goals: { title: string; detail: string; target: string }[];
    strategies: { title: string; detail: string; priority: number }[];
    habits: { key: string; title: string; detail: string }[];
    timeline: { label: string; detail: string; stars: number }[];
    trainerComment: string | null;
    closingTrainerComment: string | null;
  };
};
