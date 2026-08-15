import type { SupabaseClient } from "@supabase/supabase-js";
import { DateTime } from "luxon";
import { MEMBER_BODY_PHOTO_BUCKET } from "@/lib/memberBodyPhotos";
import { linePushTokenForMemberRow } from "@/lib/lineChannel";
import { dailyReportChannelToken } from "@/lib/dailyLineRecipients";
import { pushOpsTexts } from "@/lib/trainerOpsScope";
import { isTrainerLineUserId } from "@/lib/lineRoleSeparation";
import {
  MID_MONTH_LOW_BOOKING_MAX,
  MONTHLY_SESSION_TARGET,
} from "@/lib/lowBookingMotivation";

const TZ = "Asia/Tokyo";

/** 運営・テスト・ピラティスなど、会員向け案内から常に除外 */
export const MID_MONTH_EXCLUDE_CODES = new Set(["EBI020", "UEN055"]);

export type MidMonthLowBookingMember = {
  id: string;
  member_code: string;
  name: string;
  store: string;
  count: number;
  line_user_id: string | null;
  line_channel_key: string | null;
  joined_this_month: boolean;
};

function isActiveMember(m: { membership_status?: string | null; is_active?: boolean | null }): boolean {
  const ms = String(m.membership_status ?? "").toLowerCase();
  if (ms === "active") return true;
  if (ms === "hiatus" || ms === "withdrawn") return false;
  return m.is_active === true;
}

async function fetchAll<T>(
  supabase: SupabaseClient,
  table: string,
  select: string,
  apply?: (q: any) => any
): Promise<T[]> {
  const page = 1000;
  let from = 0;
  const out: T[] = [];
  for (;;) {
    let q = supabase.from(table).select(select).range(from, from + page - 1);
    if (apply) q = apply(q);
    const { data, error } = await q;
    if (error) throw error;
    out.push(...((data ?? []) as T[]));
    if (!data || data.length < page) break;
    from += page;
  }
  return out;
}

export async function listMidMonthLowBookingMembers(
  supabase: SupabaseClient,
  now = DateTime.now().setZone(TZ)
): Promise<{
  monthKey: string;
  monthLabel: string;
  asOfLabel: string;
  members: MidMonthLowBookingMember[];
}> {
  const monthStart = now.startOf("month");
  const nextMonth = monthStart.plus({ months: 1 });
  const monthKey = now.toFormat("yyyy-MM");
  const monthLabel = now.setLocale("ja").toFormat("M月");
  const asOfLabel = now.toFormat("M/d");

  const [stores, members, reservations] = await Promise.all([
    fetchAll<{ id: string; name: string }>(supabase, "stores", "id,name"),
    fetchAll<{
      id: string;
      member_code: string;
      name: string | null;
      display_name: string | null;
      store_id: string | null;
      is_active: boolean | null;
      membership_status: string | null;
      line_user_id: string | null;
      line_channel_key: string | null;
      created_at: string;
    }>(supabase, "members", "id, member_code, name, display_name, store_id, is_active, membership_status, line_user_id, line_channel_key, created_at"),
    fetchAll<{ member_id: string | null }>(
      supabase,
      "reservations",
      "member_id",
      (q) =>
        q
          .gte("start_at", monthStart.toUTC().toISO()!)
          .lt("start_at", nextMonth.toUTC().toISO()!)
          .neq("status", "cancelled")
          .not("member_id", "is", null)
    ),
  ]);

  const storeById = new Map(stores.map((s) => [s.id, s.name]));
  const counts = new Map<string, number>();
  for (const r of reservations) {
    if (!r.member_id) continue;
    counts.set(r.member_id, (counts.get(r.member_id) ?? 0) + 1);
  }

  const list: MidMonthLowBookingMember[] = [];
  for (const m of members) {
    if (!isActiveMember(m)) continue;
    const code = String(m.member_code ?? "").toUpperCase();
    if (MID_MONTH_EXCLUDE_CODES.has(code)) continue;
    const joinedThisMonth =
      DateTime.fromISO(m.created_at).setZone(TZ).toFormat("yyyy-MM") === monthKey;
    if (joinedThisMonth) continue;
    const count = counts.get(m.id) ?? 0;
    if (count > MID_MONTH_LOW_BOOKING_MAX) continue;
    list.push({
      id: m.id,
      member_code: code,
      name: String(m.display_name || m.name || "").trim() || "(無名)",
      store: storeById.get(m.store_id ?? "") || "(未設定)",
      count,
      line_user_id: m.line_user_id,
      line_channel_key: m.line_channel_key,
      joined_this_month: joinedThisMonth,
    });
  }

  const storeRank = (s: string) =>
    s === "上野" ? 1 : s === "桜木町" ? 2 : s === "新宿" ? 3 : s === "恵比寿" ? 4 : s === "福岡" ? 5 : 9;

  list.sort(
    (a, b) =>
      a.count - b.count ||
      storeRank(a.store) - storeRank(b.store) ||
      a.member_code.localeCompare(b.member_code)
  );

  return { monthKey, monthLabel, asOfLabel, members: list };
}

export function buildMidMonthMemberLineText(monthLabel: string, withPhoto: boolean): string {
  const base = `お世話になっております！
Abodyです😊

${monthLabel}も折り返しになりましたので、ご予約のご案内です。

今月は、すでに入っているご予約も含めて合計${MONTHLY_SESSION_TARGET}コマになるよう、残りの期間でご予約をお願いいたします💪

時間が取りづらい場合は、30分と60分を組み合わせてのご予約でも大丈夫です。
（60分セッションは、30分2コマ分としてカウントいたします）

ご希望の時間が埋まっていて予約が取りづらい場合は、遠慮なくご連絡ください。
こちらで枠の確認や調整をさせていただきます！

人気の時間帯は埋まりやすいため、ご予定がお決まりでしたらお早めのご予約をお願いいたします🙇‍♂️

${monthLabel}後半もしっかりサポートしますので、一緒に${MONTHLY_SESSION_TARGET}コマ目指していきましょう😊
ご不明点はお気軽にご連絡ください！`;

  if (!withPhoto) return base;
  return `${base}

添付の写真は、提出いただいたなりたい体型です。今月${MONTHLY_SESSION_TARGET}コマで、そこに近づいていきましょう💪`;
}

export function buildMidMonthOpsListText(params: {
  monthLabel: string;
  asOfLabel: string;
  members: MidMonthLowBookingMember[];
}): string {
  const { monthLabel, asOfLabel, members } = params;
  const withLine = members.filter((m) => m.line_user_id).length;
  const noLine = members.length - withLine;
  const byStore = new Map<string, number>();
  const dist = new Map<number, number>();
  for (const m of members) {
    byStore.set(m.store, (byStore.get(m.store) ?? 0) + 1);
    dist.set(m.count, (dist.get(m.count) ?? 0) + 1);
  }
  const storeLines = ["上野", "桜木町", "新宿", "恵比寿", "福岡"]
    .filter((s) => byStore.has(s))
    .map((s) => `${s} ${byStore.get(s)}人`);
  const distLines = [0, 1, 2, 3, 4]
    .filter((n) => dist.has(n))
    .map((n) => `${n}回 ${dist.get(n)}人`);

  const memberLines = members.map(
    (m) => `${m.member_code} ${m.name}（${m.store}） ${m.count}回${m.line_user_id ? "" : " LINEなし"}`
  );

  return [
    `【${monthLabel} 予約${MID_MONTH_LOW_BOOKING_MAX}回以下リスト】${asOfLabel}時点`,
    `対象 ${members.length}人（LINE可 ${withLine} / 未連携 ${noLine}）`,
    `目標: 月末までに合計${MONTHLY_SESSION_TARGET}コマ`,
    "",
    storeLines.join(" / "),
    distLines.join(" / "),
    "",
    ...memberLines,
    "",
    "このあと対象会員へ案内LINEを送ります。",
  ].join("\n");
}

export function buildMidMonthOpsReportText(params: {
  monthLabel: string;
  sent: number;
  photo: number;
  failed: number;
  skippedNoLine: number;
  skippedAlready: number;
  failedCodes: string[];
}): string {
  const lines = [
    `【${params.monthLabel} 予約フォロー送信結果】`,
    `送信成功 ${params.sent}（うち目標写真つき ${params.photo}）`,
    `失敗 ${params.failed}`,
    `LINE未連携スキップ ${params.skippedNoLine}`,
  ];
  if (params.skippedAlready > 0) lines.push(`今月送信済みスキップ ${params.skippedAlready}`);
  if (params.failedCodes.length > 0) {
    lines.push("", "失敗:", params.failedCodes.join(", "));
  }
  return lines.join("\n");
}

async function pushTextAndOptionalImage(params: {
  token: string;
  toUserId: string;
  text: string;
  imageUrl?: string | null;
}): Promise<{ ok: boolean; status: number; body: string }> {
  const messages: Array<Record<string, unknown>> = [];
  if (params.imageUrl) {
    messages.push({
      type: "image",
      originalContentUrl: params.imageUrl,
      previewImageUrl: params.imageUrl,
    });
  }
  messages.push({ type: "text", text: params.text });
  const res = await fetch("https://api.line.me/v2/bot/message/push", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${params.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ to: params.toUserId, messages }),
  });
  const body = await res.text().catch(() => "");
  return { ok: res.ok, status: res.status, body };
}

export async function sendOpsLine(supabase: SupabaseClient, text: string): Promise<{ ok: boolean; error?: string }> {
  const token = dailyReportChannelToken();
  if (!token) return { ok: false, error: "missing_line_token" };
  const pushed = await pushOpsTexts(supabase as any, (r) => {
    if (r.kind === "trainer") return null;
    return text;
  });
  return { ok: pushed.ok, error: pushed.error };
}

export async function sendScopedLowBookingList(
  supabase: SupabaseClient,
  params: { monthLabel: string; asOfLabel: string; members: MidMonthLowBookingMember[] }
): Promise<{ ok: boolean; error?: string }> {
  const token = dailyReportChannelToken();
  if (!token) return { ok: false, error: "missing_line_token" };
  const pushed = await pushOpsTexts(supabase as any, (r) => {
    if (r.kind === "trainer") return null;
    const list = r.all_stores
      ? params.members
      : params.members.filter((m) => r.store_names.includes(m.store));
    if (!r.all_stores && list.length === 0) return null;
    return buildMidMonthOpsListText({
      monthLabel: params.monthLabel,
      asOfLabel: params.asOfLabel,
      members: list,
    });
  });
  return { ok: pushed.ok, error: pushed.error };
}

export async function sendScopedLowBookingReport(
  supabase: SupabaseClient,
  params: {
    monthLabel: string;
    members: MidMonthLowBookingMember[];
    sent: number;
    photo: number;
    failed: number;
    skippedNoLine: number;
    skippedAlready: number;
    failedCodes: string[];
  }
): Promise<{ ok: boolean; error?: string }> {
  const token = dailyReportChannelToken();
  if (!token) return { ok: false, error: "missing_line_token" };
  const full = buildMidMonthOpsReportText(params);
  const pushed = await pushOpsTexts(supabase as any, (r) => {
    if (r.kind === "trainer") return null;
    if (r.all_stores) return full;
    const list = params.members.filter((m) => r.store_names.includes(m.store));
    if (list.length === 0) return null;
    const noLine = list.filter((m) => !m.line_user_id).length;
    const failed = params.failedCodes.filter((c) => list.some((m) => m.member_code === c));
    return [
      `【${params.monthLabel} ${r.store_names.join("・")} 予約フォロー】`,
      `対象 ${list.length}人（LINE未連携 ${noLine}）`,
      failed.length > 0 ? `失敗: ${failed.join(", ")}` : "案内LINEを送りました。数字を見てフォローを続けてください。",
    ].join("\n");
  });
  return { ok: pushed.ok, error: pushed.error };
}

export async function goalPhotoSignedUrl(
  supabase: SupabaseClient,
  memberId: string
): Promise<string | null> {
  const { data } = await supabase
    .from("goal_hearing_responses")
    .select("goal_photo_paths")
    .eq("member_id", memberId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const path = Array.isArray(data?.goal_photo_paths) ? data.goal_photo_paths.find(Boolean) : null;
  if (!path) return null;
  const { data: signed, error } = await supabase.storage
    .from(MEMBER_BODY_PHOTO_BUCKET)
    .createSignedUrl(path, 60 * 60 * 24 * 7);
  if (error || !signed?.signedUrl) return null;
  return signed.signedUrl;
}

export async function sendMidMonthMemberLine(
  supabase: SupabaseClient,
  member: MidMonthLowBookingMember,
  monthLabel: string
): Promise<{ ok: boolean; photo: boolean; error?: string }> {
  if (!member.line_user_id) return { ok: false, photo: false, error: "no_line_user_id" };
  if (await isTrainerLineUserId(supabase, member.line_user_id)) {
    return { ok: false, photo: false, error: "trainer_line_excluded" };
  }
  const line = linePushTokenForMemberRow({
    member_code: member.member_code,
    line_channel_key: member.line_channel_key,
  });
  if (!line.token) return { ok: false, photo: false, error: "missing_line_token" };

  const imageUrl = await goalPhotoSignedUrl(supabase, member.id);
  const text = buildMidMonthMemberLineText(monthLabel, Boolean(imageUrl));
  const push = await pushTextAndOptionalImage({
    token: line.token,
    toUserId: member.line_user_id,
    text,
    imageUrl,
  });
  return { ok: push.ok, photo: Boolean(imageUrl), error: push.ok ? undefined : push.body.slice(0, 200) };
}

export async function alreadySentThisMonth(
  supabase: SupabaseClient,
  yearMonth: string,
  memberCode: string
): Promise<boolean> {
  const { data, error } = await (supabase as any)
    .from("mid_month_low_booking_dispatches")
    .select("id")
    .eq("year_month", yearMonth)
    .eq("member_code", memberCode)
    .maybeSingle();
  if (error) {
    const msg = String(error.message ?? "");
    if (msg.includes("does not exist") || msg.includes("schema cache")) return false;
    return false;
  }
  return Boolean(data?.id);
}

export async function markSentThisMonth(
  supabase: SupabaseClient,
  yearMonth: string,
  memberCode: string,
  withPhoto: boolean
): Promise<void> {
  const { error } = await (supabase as any).from("mid_month_low_booking_dispatches").insert({
    year_month: yearMonth,
    member_code: memberCode,
    with_photo: withPhoto,
  });
  if (error) {
    const msg = String(error.message ?? "");
    if (msg.includes("duplicate") || msg.includes("unique")) return;
    if (msg.includes("does not exist") || msg.includes("schema cache")) return;
    console.error("mid_month_low_booking_dispatches insert failed", error.message);
  }
}
