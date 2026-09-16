export const MEMBERSHIP_STATUSES = ["active", "hiatus", "withdrawn"] as const;
export type MembershipStatus = (typeof MEMBERSHIP_STATUSES)[number];

export const MEMBERSHIP_STATUS_OPTIONS: Array<{ id: MembershipStatus; label: string }> = [
  { id: "active", label: "入会中" },
  { id: "hiatus", label: "休会中" },
  { id: "withdrawn", label: "退会" },
];

export function membershipStatusLabel(status: MembershipStatus): string {
  return MEMBERSHIP_STATUS_OPTIONS.find((o) => o.id === status)?.label ?? status;
}

/** 集計・案内対象の is_active。休会中も true、退会のみ false。予約可否とは別。 */
export function isActiveFromMembershipStatus(status: MembershipStatus): boolean {
  return status !== "withdrawn";
}

/** 入会中・休会・退会いずれも予約・ログイン可。会員レコードがあれば通す。 */
export function canBookOrLogin(_params: {
  membershipStatus?: MembershipStatus | string | null;
  isActive?: boolean | null;
}): boolean {
  return true;
}

export function pickBookableMember<
  T extends {
    is_active?: boolean | null;
    membership_status?: MembershipStatus | string | null;
    store_id?: string | null;
  },
>(rows: T[], storeId?: string | null): T | null {
  const bookable = rows.filter((m) =>
    canBookOrLogin({ membershipStatus: m.membership_status, isActive: m.is_active })
  );
  if (storeId) {
    const home = bookable.find((m) => String(m.store_id ?? "") === String(storeId));
    if (home) return home;
  }
  return bookable[0] ?? null;
}

export function shouldReactivateHiatus(
  status: MembershipStatus,
  hiatusEndAt: string | null | undefined,
  todayYmd: string
): boolean {
  return status === "hiatus" && typeof hiatusEndAt === "string" && hiatusEndAt < todayYmd;
}

export function formatHiatusPeriod(start: string | null | undefined, end: string | null | undefined): string {
  if (!start && !end) return "期間未設定";
  return `${formatWithdrawnAt(start)} 〜 ${formatWithdrawnAt(end)}`;
}

/** DB未移行時は is_active から推定 */
export function resolveMembershipStatus(
  membershipStatus: MembershipStatus | null | undefined,
  isActive: boolean
): MembershipStatus {
  if (membershipStatus && MEMBERSHIP_STATUSES.includes(membershipStatus)) {
    return membershipStatus;
  }
  return isActive ? "active" : "withdrawn";
}

export function membershipStatusBadgeClass(status: MembershipStatus): string {
  const base = "rounded-full border px-3 py-1 text-xs font-semibold";
  if (status === "active") return `${base} border-emerald-200 bg-emerald-50 text-emerald-800`;
  if (status === "hiatus") return `${base} border-amber-200 bg-amber-50 text-amber-800`;
  return `${base} border-slate-300 bg-slate-100 text-slate-700`;
}

export function membershipStatusButtonClass(status: MembershipStatus, selected: boolean): string {
  const base = "rounded-full border px-4 py-2 text-sm font-semibold transition-colors";
  if (!selected) return `${base} border-slate-200 bg-white text-slate-700 hover:bg-slate-50`;
  if (status === "active") return `${base} border-emerald-300 bg-emerald-50 text-emerald-900`;
  if (status === "hiatus") return `${base} border-amber-300 bg-amber-50 text-amber-900`;
  return `${base} border-slate-400 bg-slate-100 text-slate-900`;
}

export function formatWithdrawnAt(ymd: string | null | undefined): string {
  if (!ymd) return "—";
  const [y, m, d] = ymd.split("-").map((x) => Number(x));
  if (!y || !m || !d) return ymd;
  return `${y}年${m}月${d}日`;
}
