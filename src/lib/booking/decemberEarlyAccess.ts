/**
 * 2026年12月の先行予約。
 *
 * 12月のシフトは下書きのままにする。確定にすると、この一覧以外の会員にも見える。
 * 2026年11月26日21:00（日本時間）から、一覧の会員だけが下書きを見て予約できる。
 * それ以外の会員には12月を出さない。
 */

export const DECEMBER_BOOKING_MONTH = "2026-12";
export const DECEMBER_EARLY_AT_ISO = "2026-11-26T21:00:00+09:00";
export const DECEMBER_EARLY_AT_MS = Date.parse(DECEMBER_EARLY_AT_ISO);

/** 11月の予約が8コマ以下の在籍者から、休会・退会・11月入会・個別除外を引いた44名。 */
export const DECEMBER_EARLY_ACCESS_CODES = [
  "UEN013",
  "SAK063",
  "SHI003",
  "SHI032",
  "FUK001",
  "EBI034",
  "UEN038",
  "EBI016",
  "UEN010",
  "SAK060",
  "SHI013",
  "EBI004",
  "EBI026",
  "SAK065",
  "SAK036",
  "EBI009",
  "FUK009",
  "EBI008",
  "UEN033",
  "UEN039",
  "SHI028",
  "SHI030",
  "EBI010",
  "EBI012",
  "UEN034",
  "SAK009",
  "SAK018",
  "SAK044",
  "SAK062",
  "SAK066",
  "SHI019",
  "SHI023",
  "SHI024",
  "SHI029",
  "FUK006",
  "EBI005",
  "UEN001",
  "UEN003",
  "UEN026",
  "UEN040",
  "SAK061",
  "SHI020",
  "FUK007",
  "FUK008",
] as const;

const CODE_SET = new Set<string>(DECEMBER_EARLY_ACCESS_CODES);

export type DecemberBookingPhase = "hidden" | "early";

type QueryClient = {
  from: (table: string) => any;
};

export function normalizeMemberCode(code: string | null | undefined): string {
  return String(code ?? "")
    .trim()
    .toUpperCase()
    .replace(/[０-９]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0));
}

export function isDecemberEarlyAccessCode(memberCode: string | null | undefined): boolean {
  return CODE_SET.has(normalizeMemberCode(memberCode));
}

export function isDecemberBookingMonth(ymdOrMonth: string): boolean {
  return ymdOrMonth === DECEMBER_BOOKING_MONTH || ymdOrMonth.startsWith(`${DECEMBER_BOOKING_MONTH}-`);
}

export function decemberBookingPhase(now: Date): DecemberBookingPhase {
  const ms = now.getTime();
  if (!Number.isFinite(ms) || !Number.isFinite(DECEMBER_EARLY_AT_MS) || ms < DECEMBER_EARLY_AT_MS) {
    return "hidden";
  }
  return "early";
}

async function memberCodeForAccess(
  supabase: QueryClient,
  params: { memberId?: string | null; email?: string | null }
): Promise<string> {
  const memberId = String(params.memberId ?? "").trim();
  if (memberId) {
    const { data, error } = await supabase.from("members").select("member_code").eq("id", memberId).maybeSingle();
    if (!error && data?.member_code) return String(data.member_code);
  }
  const email = String(params.email ?? "").trim();
  if (!email) return "";
  const { data, error } = await supabase.from("members").select("member_code").ilike("email", email).limit(10);
  if (error || !Array.isArray(data)) return "";
  const listed = data.find((row) => isDecemberEarlyAccessCode(row?.member_code));
  return listed?.member_code ? String(listed.member_code) : "";
}

/** 予約カレンダーに、12月の下書きを足すか。全店舗。 */
export async function shouldIncludeDecemberDrafts(params: {
  supabase: QueryClient;
  ymdOrMonth: string;
  memberId?: string | null;
  email?: string | null;
  now?: Date;
}): Promise<boolean> {
  if (!isDecemberBookingMonth(params.ymdOrMonth)) return false;
  if (decemberBookingPhase(params.now ?? new Date()) !== "early") return false;
  const code = await memberCodeForAccess(params.supabase, params);
  return isDecemberEarlyAccessCode(code);
}

/** 会員の予約作成・日時変更。12月は一覧の会員だけ、21:00以降に true。 */
export async function decemberBookingOpenForMember(params: {
  supabase: QueryClient;
  ymd: string;
  memberId?: string | null;
  email?: string | null;
  now?: Date;
}): Promise<boolean> {
  if (!isDecemberBookingMonth(params.ymd)) return true;
  if (decemberBookingPhase(params.now ?? new Date()) !== "early") return false;
  const code = await memberCodeForAccess(params.supabase, params);
  return isDecemberEarlyAccessCode(code);
}
