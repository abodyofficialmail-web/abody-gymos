/**
 * 2026年11月の予約公開。
 *
 * 東京4店舗のシフトは、10月27日18:00（日本時間）までは下書き。
 * 現行の予約画面は下書きを出さないので、このコードが本番に載るまでは誰にも11月が見えない。
 *
 * - 10月26日18:00以降: 10月の利用が8回以下の在籍会員だけが下書きを見られる。チケット2枚は台帳 reason で同じ人に1回。
 * - 10月27日18:00以降: 下書きも全員に見せる。cron が下書きを確定に変えると、このコードが無い画面でも見える。
 *
 * 福岡は対象外。確定済みの福岡シフトはそのまま。
 */

export const NOVEMBER_BOOKING_MONTH = "2026-11";
export const NOVEMBER_EARLY_AT_ISO = "2026-10-26T18:00:00+09:00";
export const NOVEMBER_PUBLIC_AT_ISO = "2026-10-27T18:00:00+09:00";
export const NOVEMBER_EARLY_AT_MS = Date.parse(NOVEMBER_EARLY_AT_ISO);
export const NOVEMBER_PUBLIC_AT_MS = Date.parse(NOVEMBER_PUBLIC_AT_ISO);

/** 10月1日0:00から11月1日0:00の前まで。1予約=1回。取消は数えない。 */
export const OCTOBER_USAGE_START_ISO = "2026-10-01T00:00:00+09:00";
export const OCTOBER_USAGE_END_ISO = "2026-11-01T00:00:00+09:00";
/** この時刻より前に作られた10月予約だけを数える。付与ジョブが遅れても、26日18時の人数で固定する。 */
export const NOVEMBER_USAGE_CREATED_BEFORE_ISO = NOVEMBER_EARLY_AT_ISO;

export const NOVEMBER_LOW_USAGE_MAX = 8;
export const NOVEMBER_TICKET_KOMA = 2;
export const NOVEMBER_LOW_USAGE_LEDGER_REASON = "november_2026_low_usage_tickets";
export const NOVEMBER_LOW_USAGE_LEDGER_NOTE = "10月の利用が8回以下のため、11月の先行予約に2枚";

export const TOKYO_NOVEMBER_STORES = ["恵比寿", "上野", "新宿", "桜木町"] as const;
const TOKYO_STORE_SET = new Set<string>(TOKYO_NOVEMBER_STORES);

export type NovemberBookingPhase = "hidden" | "early" | "public";

export function novemberBookingPhase(now: Date): NovemberBookingPhase {
  const ms = now.getTime();
  if (!Number.isFinite(ms) || !Number.isFinite(NOVEMBER_EARLY_AT_MS) || !Number.isFinite(NOVEMBER_PUBLIC_AT_MS)) {
    return "hidden";
  }
  if (ms < NOVEMBER_EARLY_AT_MS) return "hidden";
  if (ms < NOVEMBER_PUBLIC_AT_MS) return "early";
  return "public";
}

export function isNovemberBookingMonth(ymdOrMonth: string): boolean {
  return ymdOrMonth === NOVEMBER_BOOKING_MONTH || ymdOrMonth.startsWith(`${NOVEMBER_BOOKING_MONTH}-`);
}

export function isTokyoNovemberStore(storeName: string | null | undefined): boolean {
  return TOKYO_STORE_SET.has(String(storeName ?? "").trim());
}

export function isActiveForNovemberGrant(member: {
  membership_status?: string | null;
  is_active?: boolean | null;
}): boolean {
  const status = String(member.membership_status ?? "").toLowerCase();
  if (status === "active") return true;
  if (status === "hiatus" || status === "withdrawn") return false;
  return member.is_active === true;
}

/** 名前に「テスト」と入っている会員にはチケットを出さない。 */
export function isExcludedNovemberGrantName(name: string | null | undefined): boolean {
  return /テスト/.test(String(name ?? "").replace(/\s/g, ""));
}

export function isNovemberLowUsageCount(count: number): boolean {
  return Number.isFinite(count) && count >= 0 && count <= NOVEMBER_LOW_USAGE_MAX;
}

export type NovemberLowUsageCandidate = {
  id: string;
  member_code?: string | null;
  name?: string | null;
  display_name?: string | null;
  membership_status?: string | null;
  is_active?: boolean | null;
};

export type NovemberLowUsageMember = {
  id: string;
  memberCode: string;
  count: number;
};

export function selectNovemberLowUsageMembers(
  members: NovemberLowUsageCandidate[],
  counts: Map<string, number>
): NovemberLowUsageMember[] {
  const selected: NovemberLowUsageMember[] = [];
  for (const member of members) {
    if (!member.id) continue;
    if (!isActiveForNovemberGrant(member)) continue;
    if (isExcludedNovemberGrantName(member.name) || isExcludedNovemberGrantName(member.display_name)) continue;
    const count = counts.get(member.id) ?? 0;
    if (!isNovemberLowUsageCount(count)) continue;
    selected.push({
      id: member.id,
      memberCode: String(member.member_code ?? "").trim().toUpperCase(),
      count,
    });
  }
  selected.sort((a, b) => a.count - b.count || a.memberCode.localeCompare(b.memberCode));
  return selected;
}

type QueryClient = {
  from: (table: string) => any;
};

export async function memberHasNovemberLowUsageGrant(
  supabase: QueryClient,
  memberId: string | null | undefined
): Promise<boolean> {
  if (!memberId) return false;
  const { data, error } = await supabase
    .from("member_ticket_ledger")
    .select("id")
    .eq("member_id", memberId)
    .eq("reason", NOVEMBER_LOW_USAGE_LEDGER_REASON)
    .limit(1);
  if (error) return false;
  return Array.isArray(data) && data.length > 0;
}

/** 予約カレンダーに、東京4店舗の11月下書きを足すか。 */
export async function shouldIncludeNovemberDrafts(params: {
  supabase: QueryClient;
  storeName: string | null | undefined;
  ymdOrMonth: string;
  memberId: string | null | undefined;
  now?: Date;
}): Promise<boolean> {
  if (!isTokyoNovemberStore(params.storeName)) return false;
  if (!isNovemberBookingMonth(params.ymdOrMonth)) return false;
  const phase = novemberBookingPhase(params.now ?? new Date());
  if (phase === "hidden") return false;
  if (phase === "public") return true;
  return memberHasNovemberLowUsageGrant(params.supabase, params.memberId);
}

/**
 * 会員の予約作成・日時変更。東京4店舗の11月は、公開時刻と対象者を満たすときだけ true。
 * 福岡など東京4店舗以外はここでは止めない。
 */
export async function novemberBookingOpenForMember(params: {
  supabase: QueryClient;
  storeId: string;
  storeName?: string | null;
  ymd: string;
  memberId: string | null | undefined;
  now?: Date;
}): Promise<boolean> {
  if (!isNovemberBookingMonth(params.ymd)) return true;
  let storeName = params.storeName;
  if (!storeName) {
    const { data, error } = await params.supabase.from("stores").select("name").eq("id", params.storeId).maybeSingle();
    if (error || !data) return false;
    storeName = String((data as { name?: string | null }).name ?? "");
  }
  if (!isTokyoNovemberStore(storeName)) return true;
  const phase = novemberBookingPhase(params.now ?? new Date());
  if (phase === "hidden") return false;
  if (phase === "public") return true;
  return memberHasNovemberLowUsageGrant(params.supabase, params.memberId);
}
