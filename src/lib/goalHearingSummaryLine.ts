import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildGoalHearingLineSummary,
  type GoalHearingFormPayload,
} from "@/lib/goalHearing";
import { pushLineTextForMember } from "@/lib/lineMessagingPush";
import { normalizeLineChannelKey } from "@/lib/lineChannel";

export async function sendGoalHearingSummaryLine(
  supabase: SupabaseClient,
  params: {
    memberId: string;
    answeredAtYmd: string;
    form: GoalHearingFormPayload;
    photoCount: number;
    storeName?: string | null;
  }
) {
  const { data: member, error } = await supabase
    .from("members")
    .select("id, member_code, name, line_user_id, line_channel_key, is_active")
    .eq("id", params.memberId)
    .maybeSingle();

  if (error) return { ok: false as const, error: "member_fetch_failed", detail: error.message };
  if (!member?.is_active || !member.line_user_id) {
    return { ok: false as const, error: "member_or_line_missing" };
  }

  const text = buildGoalHearingLineSummary({
    answeredAtYmd: params.answeredAtYmd,
    form: params.form,
    photoCount: params.photoCount,
  });

  const pushed = await pushLineTextForMember({
    toUserId: member.line_user_id,
    text,
    memberCode: member.member_code,
    lineChannelKey: normalizeLineChannelKey(member.line_channel_key),
    storeName: params.storeName ?? null,
  });

  return {
    ok: pushed.ok,
    member_code: member.member_code,
    channelKey: pushed.channelKey,
    detail: pushed.ok ? undefined : pushed.body,
    text,
  };
}

/** 既存の構造化回答から会員向けサマリーを送る（テスト・再送用） */
export async function sendGoalHearingSummaryLineForMemberCode(
  supabase: SupabaseClient,
  params: { memberCode: string; dryRun?: boolean }
) {
  const memberCode = params.memberCode.trim().toUpperCase();
  const { data: member, error: mErr } = await supabase
    .from("members")
    .select("id, member_code, name, line_user_id, line_channel_key, is_active, store_id")
    .eq("member_code", memberCode)
    .maybeSingle();
  if (mErr) return { member_code: memberCode, sent: false, error: "member_fetch_failed", detail: mErr.message };
  if (!member?.is_active || !member.line_user_id) {
    return { member_code: memberCode, sent: false, error: "member_or_line_missing" };
  }

  const { data: response, error: rErr } = await supabase
    .from("goal_hearing_responses")
    .select("*")
    .eq("member_id", member.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (rErr) return { member_code: memberCode, sent: false, error: "response_fetch_failed", detail: rErr.message };
  if (!response) return { member_code: memberCode, sent: false, error: "goal_hearing_missing" };

  let storeName: string | null = null;
  if (member.store_id) {
    const { data: store } = await supabase.from("stores").select("name").eq("id", member.store_id).maybeSingle();
    storeName = store?.name ?? null;
  }

  const answeredAtYmd = String(response.created_at).slice(0, 10);
  let weightDirection = (response as { weight_direction?: string | null }).weight_direction || "";
  if (!weightDirection) {
    if (response.current_weight_kg != null && response.target_weight_kg != null) {
      if (Number(response.target_weight_kg) < Number(response.current_weight_kg) - 0.5) weightDirection = "lose";
      else if (Number(response.target_weight_kg) > Number(response.current_weight_kg) + 0.5) weightDirection = "gain";
      else weightDirection = "maintain";
    } else if (response.primary_goal === "diet") weightDirection = "lose";
    else if (response.primary_goal === "muscle") weightDirection = "gain";
    else weightDirection = "looks";
  }

  const form: GoalHearingFormPayload = {
    primary_goal: response.primary_goal,
    secondary_goal: response.secondary_goal,
    tertiary_goal: response.tertiary_goal,
    focus_areas: response.focus_areas ?? [],
    weight_direction: weightDirection,
    current_weight_kg: response.current_weight_kg,
    target_weight_kg: response.target_weight_kg,
    current_body_fat_pct: response.current_body_fat_pct,
    target_body_fat_pct: response.target_body_fat_pct,
    current_waist_cm: response.current_waist_cm,
    target_waist_cm: response.target_waist_cm,
    numeric_goals_undecided: Boolean(response.numeric_goals_undecided),
    deadline_type: response.deadline_type,
    deadline_date: response.deadline_date,
    goal_reason: response.goal_reason,
    goal_reason_other: response.goal_reason_other,
    sex: response.sex,
    birth_date: response.birth_date,
    age_years: response.age_years,
    height_cm: Number(response.height_cm),
    weight_unknown: Boolean(response.weight_unknown),
    activity_level: response.activity_level,
    ideal_frequency: response.ideal_frequency,
    preferred_slots: response.preferred_slots ?? [],
    sleep_hours: response.sleep_hours,
    challenges: response.challenges ?? [],
    meal_change: response.meal_change,
    pain_areas: response.pain_areas ?? [],
    training_styles: response.training_styles ?? [],
    medical_restrictions: response.medical_restrictions,
    free_comment: response.free_comment,
    goal_photo_paths: response.goal_photo_paths ?? [],
  };

  const text = buildGoalHearingLineSummary({
    answeredAtYmd,
    form,
    photoCount: (response.goal_photo_paths ?? []).length,
  });

  if (params.dryRun) {
    return { member_code: memberCode, sent: false, dry_run: true, text };
  }

  const pushed = await pushLineTextForMember({
    toUserId: member.line_user_id,
    text,
    memberCode: member.member_code,
    lineChannelKey: normalizeLineChannelKey(member.line_channel_key),
    storeName,
  });

  return {
    member_code: memberCode,
    sent: pushed.ok,
    channelKey: pushed.channelKey,
    detail: pushed.ok ? undefined : pushed.body,
    text,
  };
}
