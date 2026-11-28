/**
 * 2026年12月の予約公開。
 *
 * 東京4店舗の12月シフトは、11月27日18:00（日本時間）までは下書き。
 * 11月の利用が8回以下の在籍会員だけが、その下書きを予約できる。
 * 11月27日18:00以降は全員に開く。福岡は対象外。
 *
 * 回数は 2026-11-27 10:00（日本時間）より前に作られた11月予約だけ。取消は数えない。
 */

export const DECEMBER_BOOKING_MONTH = "2026-12";
export const DECEMBER_EARLY_AT_ISO = "2026-11-27T10:00:00+09:00";
export const DECEMBER_PUBLIC_AT_ISO = "2026-11-27T18:00:00+09:00";
export const DECEMBER_EARLY_AT_MS = Date.parse(DECEMBER_EARLY_AT_ISO);
export const DECEMBER_PUBLIC_AT_MS = Date.parse(DECEMBER_PUBLIC_AT_ISO);
export const NOVEMBER_USAGE_START_ISO = "2026-11-01T00:00:00+09:00";
export const NOVEMBER_USAGE_END_ISO = "2026-12-01T00:00:00+09:00";
export const DECEMBER_USAGE_CREATED_BEFORE_ISO = DECEMBER_EARLY_AT_ISO;
export const DECEMBER_LOW_USAGE_MAX = 8;

export const TOKYO_DECEMBER_STORES = ["恵比寿", "上野", "新宿", "桜木町"] as const;
const TOKYO_STORE_SET = new Set<string>(TOKYO_DECEMBER_STORES);

export type DecemberBookingPhase = "hidden" | "early" | "public";

export function decemberBookingPhase(now: Date): DecemberBookingPhase {
  const ms = now.getTime();
  if (
    !Number.isFinite(ms) ||
    !Number.isFinite(DECEMBER_EARLY_AT_MS) ||
    !Number.isFinite(DECEMBER_PUBLIC_AT_MS) ||
    ms < DECEMBER_EARLY_AT_MS
  ) {
    return "hidden";
  }
  if (ms < DECEMBER_PUBLIC_AT_MS) return "early";
  return "public";
}

export function isDecemberBookingMonth(ymdOrMonth: string): boolean {
  return ymdOrMonth === DECEMBER_BOOKING_MONTH || ymdOrMonth.startsWith(`${DECEMBER_BOOKING_MONTH}-`);
}

export function isTokyoDecemberStore(storeName: string | null | undefined): boolean {
  return TOKYO_STORE_SET.has(String(storeName ?? "").trim());
}

type QueryClient = {
  from: (table: string) => any;
};

type MemberRow = {
  name?: string | null;
  display_name?: string | null;
  membership_status?: string | null;
  is_active?: boolean | null;
};

function isActiveMember(member: MemberRow): boolean {
  const status = String(member.membership_status ?? "").toLowerCase();
  if (status === "active") return true;
  if (status === "hiatus" || status === "withdrawn") return false;
  return member.is_active === true;
}

function isExcludedName(name: string | null | undefined): boolean {
  return /テスト/.test(String(name ?? "").replace(/\s/g, ""));
}

function isLowUsageCount(count: number): boolean {
  return Number.isFinite(count) && count >= 0 && count <= DECEMBER_LOW_USAGE_MAX;
}

export async function memberHasDecemberLowUsageAccess(
  supabase: QueryClient,
  memberId: string | null | undefined,
  now: Date = new Date()
): Promise<boolean> {
  if (decemberBookingPhase(now) !== "early") return false;
  if (!memberId) return false;
  const full = await supabase
    .from("members")
    .select("name, display_name, membership_status, is_active")
    .eq("id", memberId)
    .maybeSingle();
  let member = full.data as MemberRow | null;
  if (full.error) {
    const msg = String(full.error.message ?? "");
    if (!/membership_status|display_name|does not exist|schema cache/i.test(msg)) return false;
    const slim = await supabase.from("members").select("name, is_active").eq("id", memberId).maybeSingle();
    if (slim.error || !slim.data) return false;
    member = slim.data as MemberRow;
  }
  if (!member) return false;
  if (!isActiveMember(member)) return false;
  if (isExcludedName(member.name) || isExcludedName(member.display_name)) return false;
  const counted = await supabase
    .from("reservations")
    .select("id", { count: "exact", head: true })
    .eq("member_id", memberId)
    .gte("start_at", NOVEMBER_USAGE_START_ISO)
    .lt("start_at", NOVEMBER_USAGE_END_ISO)
    .lt("created_at", DECEMBER_USAGE_CREATED_BEFORE_ISO)
    .neq("status", "cancelled");
  if (counted.error) return false;
  return isLowUsageCount(Number(counted.count ?? 0));
}

export async function shouldIncludeDecemberDrafts(params: {
  supabase: QueryClient;
  storeName: string | null | undefined;
  ymdOrMonth: string;
  memberId: string | null | undefined;
  now?: Date;
}): Promise<boolean> {
  if (!isTokyoDecemberStore(params.storeName)) return false;
  if (!isDecemberBookingMonth(params.ymdOrMonth)) return false;
  const phase = decemberBookingPhase(params.now ?? new Date());
  if (phase === "hidden") return false;
  if (phase === "public") return true;
  return memberHasDecemberLowUsageAccess(params.supabase, params.memberId, params.now ?? new Date());
}

export async function decemberBookingOpenForMember(params: {
  supabase: QueryClient;
  storeId: string;
  storeName?: string | null;
  ymd: string;
  memberId: string | null | undefined;
  now?: Date;
}): Promise<boolean> {
  if (!isDecemberBookingMonth(params.ymd)) return true;
  let storeName = params.storeName;
  if (!storeName) {
    const { data, error } = await params.supabase.from("stores").select("name").eq("id", params.storeId).maybeSingle();
    if (error || !data) return false;
    storeName = String((data as { name?: string | null }).name ?? "");
  }
  if (!isTokyoDecemberStore(storeName)) return true;
  const phase = decemberBookingPhase(params.now ?? new Date());
  if (phase === "hidden") return false;
  if (phase === "public") return true;
  return memberHasDecemberLowUsageAccess(params.supabase, params.memberId, params.now ?? new Date());
}
