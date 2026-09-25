export const MEMBERSHIP_PLANS = [
  "unlimited_30",
  "session_60",
  "monthly_10",
  "monthly_20",
  "ticket",
  "this_month_10",
] as const;

export type MembershipPlan = (typeof MEMBERSHIP_PLANS)[number];

export const MEMBERSHIP_PLAN_OPTIONS: Array<{ id: MembershipPlan; label: string; hint: string }> = [
  { id: "unlimited_30", label: "30分受け放題プラン", hint: "常に2コマまで。1日2コマは不可" },
  { id: "session_60", label: "60分プラン", hint: "常に4コマまで。同じ日は2コマまで（60分=2コマ）" },
  { id: "monthly_10", label: "月10コマプラン", hint: "一気に10コマまで予約できる。11コマ目から×。同じ日は2コマまで" },
  { id: "monthly_20", label: "月20コマプラン", hint: "一気に20コマまで予約できる。21コマ目から×。同じ日は2コマまで" },
  { id: "ticket", label: "回数券プラン", hint: "常に2コマまで。残チケットが必要" },
  { id: "this_month_10", label: "今月10コマプラン", hint: "一度に10コマまで。今月10コマ上限" },
];

export function isMembershipPlan(value: unknown): value is MembershipPlan {
  return typeof value === "string" && (MEMBERSHIP_PLANS as readonly string[]).includes(value);
}

export function parseMembershipPlan(value: unknown): MembershipPlan | null {
  return isMembershipPlan(value) ? value : null;
}

export function membershipPlanLabel(plan: MembershipPlan | null | undefined): string {
  if (!plan) return "未設定";
  return MEMBERSHIP_PLAN_OPTIONS.find((o) => o.id === plan)?.label ?? plan;
}

export function membershipPlanShortLabel(plan: MembershipPlan | null | undefined): string {
  if (!plan) return "プラン未設定";
  if (plan === "unlimited_30") return "30分受け放題";
  if (plan === "session_60") return "60分";
  if (plan === "monthly_10") return "月10コマ";
  if (plan === "monthly_20") return "月20コマ";
  if (plan === "ticket") return "回数券";
  if (plan === "this_month_10") return "今月10コマ";
  return plan;
}

export type MemberPlanLimits = {
  maxHoldKoma: number;
  maxDailyKoma: number | null;
  weeklyMaxKoma: number;
  monthlyMaxKoma: number | null;
  requiresTickets: boolean;
  lateCancelConsumesQuota: boolean;
};

export function limitsForMembershipPlan(plan: MembershipPlan): MemberPlanLimits {
  if (plan === "session_60") {
    return {
      maxHoldKoma: 4,
      maxDailyKoma: 2,
      weeklyMaxKoma: 6,
      monthlyMaxKoma: null,
      requiresTickets: false,
      lateCancelConsumesQuota: false,
    };
  }
  if (plan === "monthly_10") {
    return {
      maxHoldKoma: 10,
      maxDailyKoma: 2,
      weeklyMaxKoma: 3,
      monthlyMaxKoma: 10,
      requiresTickets: false,
      lateCancelConsumesQuota: true,
    };
  }
  if (plan === "monthly_20") {
    return {
      maxHoldKoma: 20,
      maxDailyKoma: 2,
      weeklyMaxKoma: 6,
      monthlyMaxKoma: 20,
      requiresTickets: false,
      lateCancelConsumesQuota: true,
    };
  }
  if (plan === "this_month_10") {
    return {
      maxHoldKoma: 10,
      maxDailyKoma: null,
      weeklyMaxKoma: 3,
      monthlyMaxKoma: 10,
      requiresTickets: false,
      lateCancelConsumesQuota: true,
    };
  }
  if (plan === "ticket") {
    return {
      maxHoldKoma: 2,
      maxDailyKoma: null,
      weeklyMaxKoma: 3,
      monthlyMaxKoma: null,
      requiresTickets: true,
      lateCancelConsumesQuota: true,
    };
  }
  return {
    maxHoldKoma: 2,
    maxDailyKoma: 1,
    weeklyMaxKoma: 3,
    monthlyMaxKoma: null,
    requiresTickets: false,
    lateCancelConsumesQuota: false,
  };
}
