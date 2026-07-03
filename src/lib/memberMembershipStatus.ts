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

export function isActiveFromMembershipStatus(status: MembershipStatus): boolean {
  return status === "active";
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
