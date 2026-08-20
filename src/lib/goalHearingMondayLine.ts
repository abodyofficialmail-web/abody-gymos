import type { SupabaseClient } from "@supabase/supabase-js";
import { DateTime } from "luxon";
import { MEMBER_BODY_PHOTO_BUCKET } from "@/lib/memberBodyPhotos";
import { linePushTokenForMemberRow } from "@/lib/lineChannel";
import { isTrainerLineUserId } from "@/lib/lineRoleSeparation";
import { pushOpsTexts } from "@/lib/trainerOpsScope";
import {
  GOAL_HEARING_MONDAY_EXCLUDE_CODES,
  buildGoalHearingMondayMessage,
  type GoalHearingMondayResponse,
} from "@/lib/goalHearingMondayMessage";

export {
  GOAL_HEARING_MONDAY_EXCLUDE_CODES,
  buildGoalHearingMondayMessage,
  openingLineForGoal,
} from "@/lib/goalHearingMondayMessage";

const TZ = "Asia/Tokyo";
const PHOTO_URL_TTL_SEC = 60 * 60 * 24 * 7;

export type GoalHearingMondayTarget = {
  id: string;
  member_code: string;
  name: string;
  store: string;
  line_user_id: string | null;
  line_channel_key: string | null;
  response: GoalHearingMondayResponse & { goal_photo_paths: string[] };
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

export function weekStartTokyo(now = DateTime.now().setZone(TZ)): DateTime {
  return now.startOf("week"); // ISO Monday
}

export function weekRangeTokyo(now = DateTime.now().setZone(TZ)) {
  const start = weekStartTokyo(now);
  return { start, end: start.plus({ days: 7 }) };
}

function responseFromRow(row: Record<string, unknown>): GoalHearingMondayTarget["response"] {
  return {
    primary_goal: String(row.primary_goal ?? ""),
    primary_goal_other: (row.primary_goal_other as string | null) ?? null,
    secondary_goal: (row.secondary_goal as string | null) ?? null,
    focus_areas: (row.focus_areas as string[] | null) ?? [],
    weight_direction: (row.weight_direction as string | null) ?? null,
    current_weight_kg: (row.current_weight_kg as number | null) ?? null,
    target_weight_kg: (row.target_weight_kg as number | null) ?? null,
    current_body_fat_pct: (row.current_body_fat_pct as number | null) ?? null,
    target_body_fat_pct: (row.target_body_fat_pct as number | null) ?? null,
    deadline_type: (row.deadline_type as string | null) ?? null,
    deadline_date: (row.deadline_date as string | null) ?? null,
    goal_reason: (row.goal_reason as string | null) ?? null,
    ideal_frequency: (row.ideal_frequency as string | null) ?? null,
    preferred_slots: (row.preferred_slots as string[] | null) ?? [],
    challenges: (row.challenges as string[] | null) ?? [],
    meal_change: (row.meal_change as string | null) ?? null,
    pain_areas: (row.pain_areas as string[] | null) ?? [],
    training_styles: (row.training_styles as string[] | null) ?? [],
    medical_restrictions: (row.medical_restrictions as string | null) ?? null,
    sleep_hours: (row.sleep_hours as string | null) ?? null,
    goal_photo_paths: Array.isArray(row.goal_photo_paths) ? (row.goal_photo_paths as string[]) : [],
  };
}

export async function listGoalHearingMondayTargets(
  supabase: SupabaseClient,
  now = DateTime.now().setZone(TZ)
): Promise<{
  weekStart: string;
  asOfLabel: string;
  targets: GoalHearingMondayTarget[];
  skippedNoPhoto: number;
  skippedNoHearing: number;
}> {
  const weekStart = weekStartTokyo(now).toISODate()!;
  const asOfLabel = now.toFormat("M/d");

  const [stores, members, responses] = await Promise.all([
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
    }>(
      supabase,
      "members",
      "id, member_code, name, display_name, store_id, is_active, membership_status, line_user_id, line_channel_key"
    ),
    fetchAll<Record<string, unknown>>(
      supabase,
      "goal_hearing_responses",
      "member_id, created_at, primary_goal, secondary_goal, focus_areas, weight_direction, current_weight_kg, target_weight_kg, current_body_fat_pct, target_body_fat_pct, deadline_type, deadline_date, goal_reason, ideal_frequency, preferred_slots, challenges, meal_change, pain_areas, training_styles, medical_restrictions, sleep_hours, goal_photo_paths",
      (q) => q.order("created_at", { ascending: false })
    ),
  ]);

  const storeById = new Map(stores.map((s) => [s.id, s.name]));
  const latestByMember = new Map<string, Record<string, unknown>>();
  for (const row of responses) {
    const memberId = String(row.member_id ?? "");
    if (!memberId || latestByMember.has(memberId)) continue;
    latestByMember.set(memberId, row);
  }

  const targets: GoalHearingMondayTarget[] = [];
  let skippedNoPhoto = 0;
  let skippedNoHearing = 0;

  for (const m of members) {
    if (!isActiveMember(m)) continue;
    const code = String(m.member_code ?? "").toUpperCase();
    if (GOAL_HEARING_MONDAY_EXCLUDE_CODES.has(code)) continue;
    const latest = latestByMember.get(m.id);
    if (!latest) {
      skippedNoHearing += 1;
      continue;
    }
    const response = responseFromRow(latest);
    if (!response.goal_photo_paths.filter(Boolean).length) {
      skippedNoPhoto += 1;
      continue;
    }
    targets.push({
      id: m.id,
      member_code: code,
      name: String(m.display_name || m.name || "").trim() || "(無名)",
      store: storeById.get(m.store_id ?? "") || "(未設定)",
      line_user_id: m.line_user_id,
      line_channel_key: m.line_channel_key,
      response,
    });
  }

  targets.sort((a, b) => a.member_code.localeCompare(b.member_code));
  return { weekStart, asOfLabel, targets, skippedNoPhoto, skippedNoHearing };
}

async function signedGoalPhotoUrl(supabase: SupabaseClient, photoPath: string): Promise<string | null> {
  const { data, error } = await supabase.storage
    .from(MEMBER_BODY_PHOTO_BUCKET)
    .createSignedUrl(photoPath, PHOTO_URL_TTL_SEC);
  if (error || !data?.signedUrl) return null;
  return data.signedUrl;
}

async function weekReservationCount(supabase: SupabaseClient, memberId: string, now = DateTime.now().setZone(TZ)) {
  const { start, end } = weekRangeTokyo(now);
  const { data, error } = await supabase
    .from("reservations")
    .select("id")
    .eq("member_id", memberId)
    .neq("status", "cancelled")
    .gte("start_at", start.toUTC().toISO()!)
    .lt("start_at", end.toUTC().toISO()!);
  if (error) return 0;
  return data?.length ?? 0;
}

async function pushTextAndImage(params: {
  token: string;
  toUserId: string;
  text: string;
  imageUrl: string;
}): Promise<{ ok: boolean; status: number; body: string }> {
  const res = await fetch("https://api.line.me/v2/bot/message/push", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${params.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      to: params.toUserId,
      messages: [
        {
          type: "image",
          originalContentUrl: params.imageUrl,
          previewImageUrl: params.imageUrl,
        },
        { type: "text", text: params.text },
      ],
    }),
  });
  const body = await res.text().catch(() => "");
  return { ok: res.ok, status: res.status, body };
}

function isMissingTable(err: { message?: string } | null | undefined): boolean {
  const m = String(err?.message ?? "");
  return m.includes("does not exist") || m.includes("schema cache") || m.includes("Could not find the table");
}

export async function alreadySentThisWeek(
  supabase: SupabaseClient,
  weekStart: string,
  memberCode: string
): Promise<boolean> {
  const { data, error } = await (supabase as any)
    .from("goal_hearing_monday_dispatches")
    .select("id")
    .eq("week_start", weekStart)
    .eq("member_code", memberCode)
    .maybeSingle();
  if (error) {
    if (isMissingTable(error)) return false;
    return false;
  }
  return Boolean(data?.id);
}

export async function markSentThisWeek(
  supabase: SupabaseClient,
  weekStart: string,
  memberCode: string,
  withPhoto: boolean
): Promise<void> {
  const { error } = await (supabase as any).from("goal_hearing_monday_dispatches").insert({
    week_start: weekStart,
    member_code: memberCode,
    with_photo: withPhoto,
  });
  if (!error) return;
  const msg = String(error.message ?? "");
  if (msg.includes("duplicate") || msg.includes("unique")) return;
  if (isMissingTable(error)) return;
  console.error("goal_hearing_monday_dispatches insert failed", error.message);
}

export async function loadMemberByCode(supabase: SupabaseClient, memberCode: string) {
  const code = memberCode.trim().toUpperCase();
  const { data, error } = await supabase
    .from("members")
    .select("id, member_code, name, display_name, line_user_id, line_channel_key, is_active, membership_status, store_id")
    .eq("member_code", code)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function sendGoalHearingMondayLine(
  supabase: SupabaseClient,
  params: {
    memberCode: string;
    dryRun?: boolean;
    deliverToMemberCode?: string;
    recordDispatch?: boolean;
    now?: DateTime;
  }
) {
  const memberCode = params.memberCode.trim().toUpperCase();
  const now = params.now ?? DateTime.now().setZone(TZ);
  const weekStart = weekStartTokyo(now).toISODate()!;

  const source = await loadMemberByCode(supabase, memberCode);
  if (!source) return { member_code: memberCode, sent: false, error: "member_not_found" };

  const { data: responseRow, error: rErr } = await supabase
    .from("goal_hearing_responses")
    .select("*")
    .eq("member_id", source.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (rErr) return { member_code: memberCode, sent: false, error: "response_fetch_failed", detail: rErr.message };
  if (!responseRow) return { member_code: memberCode, sent: false, error: "goal_hearing_missing" };

  const response = responseFromRow(responseRow as Record<string, unknown>);
  const photoPath = response.goal_photo_paths.find(Boolean);
  if (!photoPath) return { member_code: memberCode, sent: false, error: "goal_photo_missing" };

  const imageUrl = await signedGoalPhotoUrl(supabase, photoPath);
  if (!imageUrl) return { member_code: memberCode, sent: false, error: "signed_url_failed" };

  const destCode = params.deliverToMemberCode?.trim().toUpperCase();
  const dest = destCode ? await loadMemberByCode(supabase, destCode) : source;
  if (!dest) return { member_code: memberCode, sent: false, error: "deliver_to_not_found", deliver_to: destCode };
  if (!dest.line_user_id) {
    return { member_code: memberCode, sent: false, error: "member_or_line_missing", deliver_to: dest.member_code };
  }
  if (await isTrainerLineUserId(supabase, dest.line_user_id)) {
    return { member_code: memberCode, sent: false, error: "trainer_line_excluded", deliver_to: dest.member_code };
  }

  const count = await weekReservationCount(supabase, source.id, now);
  const text = buildGoalHearingMondayMessage({
    response,
    weekReservationCount: count,
  });

  const line = linePushTokenForMemberRow(dest);
  if (!line.token) {
    return {
      member_code: memberCode,
      sent: false,
      error: "line_token_missing",
      channelKey: line.channelKey,
      text,
      weekReservationCount: count,
    };
  }

  if (params.dryRun) {
    return {
      member_code: memberCode,
      sent: false,
      dry_run: true,
      deliver_to: dest.member_code,
      weekReservationCount: count,
      text,
      channelKey: line.channelKey,
    };
  }

  const push = await pushTextAndImage({
    token: line.token,
    toUserId: dest.line_user_id,
    text,
    imageUrl,
  });

  const shouldRecord = params.recordDispatch !== false && !destCode;
  if (push.ok && shouldRecord) {
    await markSentThisWeek(supabase, weekStart, memberCode, true);
  }

  return {
    member_code: memberCode,
    sent: push.ok,
    status: push.status,
    detail: push.ok ? undefined : push.body.slice(0, 300),
    deliver_to: dest.member_code,
    weekReservationCount: count,
    text,
    channelKey: line.channelKey,
  };
}

export function buildMondayOpsReportText(params: {
  asOfLabel: string;
  targets: number;
  sent: number;
  failed: number;
  skippedNoLine: number;
  skippedAlready: number;
  skippedNoPhoto: number;
  skippedNoHearing: number;
  failedCodes: string[];
  dryRun?: boolean;
}): string {
  const lines = [
    `【月曜モチベ配信】${params.asOfLabel}${params.dryRun ? "（dry-run）" : ""}`,
    `対象 ${params.targets}人（目標写真あり）`,
    `送信成功 ${params.sent}`,
    `失敗 ${params.failed}`,
    `LINE未連携スキップ ${params.skippedNoLine}`,
  ];
  if (params.skippedAlready > 0) lines.push(`今週送信済みスキップ ${params.skippedAlready}`);
  if (params.skippedNoPhoto > 0) lines.push(`写真なしスキップ ${params.skippedNoPhoto}`);
  if (params.skippedNoHearing > 0) lines.push(`ヒアリング未回答 ${params.skippedNoHearing}`);
  if (params.failedCodes.length > 0) {
    lines.push("", "失敗:", params.failedCodes.join(", "));
  }
  return lines.join("\n");
}

export async function sendMondayOpsReport(
  supabase: SupabaseClient,
  text: string
): Promise<{ ok: boolean; error?: string }> {
  const pushed = await pushOpsTexts(supabase as any, (r) => {
    if (r.kind === "trainer") return null;
    if (!r.all_stores && r.kind !== "owner") return null;
    return text;
  });
  return { ok: pushed.ok, error: pushed.error };
}
