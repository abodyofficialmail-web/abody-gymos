import { resolveMembershipStatus, shouldReactivateHiatus, type MembershipStatus } from "@/lib/memberMembershipStatus";
import { HIATUS_REACTIVATE_UPDATES, tokyoTodayYmd } from "@/lib/memberHiatus";
import { lineChannelLabel, normalizeLineChannelKey } from "@/lib/lineChannel";
import { DashboardShell } from "../../_components/DashboardShell";
import { MemberDetailClient } from "./memberDetailClient";
import { createSupabaseServiceClient } from "@/lib/supabase/admin";
import { isTrainerVisibilityPassActive, isTrainerVisibilityTestAccount } from "@/lib/trainerVisibilityPass";
import { isMemberMealPersonalFullEnabled } from "@/lib/memberMealPersonalPass";
import { parseMembershipPlan, type MembershipPlan } from "@/lib/memberPlans";

export default async function AdminDashboardMemberDetailPage({ params }: { params: { memberId: string } }) {
  const supabase = createSupabaseServiceClient();
  const { data: memberBase } = await supabase
    .from("members")
    .select("id, member_code, name, line_user_id, line_channel_key, is_active")
    .eq("id", params.memberId)
    .maybeSingle();

  let email: string | null = null;
  let membershipStatusRaw: MembershipStatus | null = null;
  let withdrawnAt: string | null = null;
  let withdrawnTrainerId: string | null = null;
  let withdrawnTrainerName: string | null = null;
  let hiatusStartAt: string | null = null;
  let hiatusEndAt: string | null = null;
  let joinedAt: string | null = null;
  let minCommitmentMonths: number | null = null;
  let hasEnrollmentFee: boolean | null = null;
  let enrollmentCampaign: string | null = null;
  let membershipPlan: MembershipPlan | null = null;
  let bonusTicketKoma = 0;

  {
    const { data: memberEmail, error: emailError } = await (supabase as any)
      .from("members")
      .select("email")
      .eq("id", params.memberId)
      .maybeSingle();
    if (!emailError) {
      email = (memberEmail as any)?.email ?? null;
    }
  }

  {
    const { data: memberStatus, error: statusError } = await (supabase as any)
      .from("members")
      .select("membership_status, withdrawn_at, withdrawn_trainer_id, hiatus_start_at, hiatus_end_at")
      .eq("id", params.memberId)
      .maybeSingle();
    if (statusError && String(statusError.message ?? "").includes("hiatus_")) {
      const retry = await (supabase as any)
        .from("members")
        .select("membership_status, withdrawn_at, withdrawn_trainer_id")
        .eq("id", params.memberId)
        .maybeSingle();
      if (!retry.error && retry.data) {
        membershipStatusRaw = (retry.data as { membership_status?: MembershipStatus | null }).membership_status ?? null;
        withdrawnAt = (retry.data as { withdrawn_at?: string | null }).withdrawn_at ?? null;
        withdrawnTrainerId = (retry.data as { withdrawn_trainer_id?: string | null }).withdrawn_trainer_id ?? null;
      }
    } else if (!statusError && memberStatus) {
      membershipStatusRaw = (memberStatus as { membership_status?: MembershipStatus | null }).membership_status ?? null;
      withdrawnAt = (memberStatus as { withdrawn_at?: string | null }).withdrawn_at ?? null;
      withdrawnTrainerId = (memberStatus as { withdrawn_trainer_id?: string | null }).withdrawn_trainer_id ?? null;
      hiatusStartAt = (memberStatus as { hiatus_start_at?: string | null }).hiatus_start_at ?? null;
      hiatusEndAt = (memberStatus as { hiatus_end_at?: string | null }).hiatus_end_at ?? null;
    }
  }

  {
    const { data: enrollment, error: enrollmentError } = await (supabase as any)
      .from("members")
      .select("joined_at, min_commitment_months, has_enrollment_fee, enrollment_campaign")
      .eq("id", params.memberId)
      .maybeSingle();
    if (!enrollmentError && enrollment) {
      joinedAt = (enrollment as { joined_at?: string | null }).joined_at ?? null;
      minCommitmentMonths =
        typeof (enrollment as { min_commitment_months?: number | null }).min_commitment_months === "number"
          ? (enrollment as { min_commitment_months: number }).min_commitment_months
          : null;
      hasEnrollmentFee =
        typeof (enrollment as { has_enrollment_fee?: boolean | null }).has_enrollment_fee === "boolean"
          ? (enrollment as { has_enrollment_fee: boolean }).has_enrollment_fee
          : null;
      enrollmentCampaign = (enrollment as { enrollment_campaign?: string | null }).enrollment_campaign ?? null;
    }
  }

  {
    const { data: planRow, error: planError } = await (supabase as any)
      .from("members")
      .select("membership_plan, bonus_ticket_koma")
      .eq("id", params.memberId)
      .maybeSingle();
    if (!planError && planRow) {
      membershipPlan = parseMembershipPlan(planRow.membership_plan);
      bonusTicketKoma = Math.max(0, Number(planRow.bonus_ticket_koma ?? 0) || 0);
    }
  }

  const resolvedStatus = resolveMembershipStatus(membershipStatusRaw, memberBase?.is_active ?? true);
  if (shouldReactivateHiatus(resolvedStatus, hiatusEndAt, tokyoTodayYmd())) {
    const { error: reactivateErr } = await (supabase as any)
      .from("members")
      .update({ ...HIATUS_REACTIVATE_UPDATES, updated_at: new Date().toISOString() })
      .eq("id", params.memberId);
    if (!reactivateErr) {
      membershipStatusRaw = "active";
      hiatusStartAt = null;
      hiatusEndAt = null;
      if (memberBase) (memberBase as { is_active: boolean }).is_active = true;
    }
  }

  if (withdrawnTrainerId) {
    const { data: trainer } = await supabase
      .from("trainers")
      .select("display_name")
      .eq("id", withdrawnTrainerId)
      .maybeSingle();
    withdrawnTrainerName = trainer?.display_name ?? null;
  }

  let trainerVisibilityPassActive = false;
  let trainerVisibilityPassStatus = "inactive";
  let trainerVisibilityPassEmail: string | null = null;
  let trainerVisibilityPassPeriodEnd: string | null = null;
  let trainerVisibilityStripeCustomerId: string | null = null;
  let trainerVisibilityStripeSubscriptionId: string | null = null;
  {
    const { data: passRow, error: passError } = await (supabase as any)
      .from("members")
      .select(
        "trainer_visibility_pass_status, trainer_visibility_pass_current_period_end, trainer_visibility_pass_email, trainer_visibility_stripe_customer_id, trainer_visibility_stripe_subscription_id"
      )
      .eq("id", params.memberId)
      .maybeSingle();
    if (passError && /trainer_visibility_pass_email/i.test(String(passError.message ?? ""))) {
      const second = await (supabase as any)
        .from("members")
        .select("trainer_visibility_pass_status, trainer_visibility_pass_current_period_end, trainer_visibility_stripe_customer_id, trainer_visibility_stripe_subscription_id")
        .eq("id", params.memberId)
        .maybeSingle();
      if (!second.error && second.data) {
        trainerVisibilityPassStatus = String(second.data.trainer_visibility_pass_status ?? "inactive");
        trainerVisibilityPassActive = isTrainerVisibilityPassActive(second.data);
        trainerVisibilityPassPeriodEnd = second.data.trainer_visibility_pass_current_period_end ?? null;
        trainerVisibilityStripeCustomerId = second.data.trainer_visibility_stripe_customer_id ?? null;
        trainerVisibilityStripeSubscriptionId = second.data.trainer_visibility_stripe_subscription_id ?? null;
      }
    } else if (!passError && passRow) {
      trainerVisibilityPassStatus = String(passRow.trainer_visibility_pass_status ?? "inactive");
      trainerVisibilityPassActive = isTrainerVisibilityPassActive(passRow);
      trainerVisibilityPassEmail = passRow.trainer_visibility_pass_email ?? null;
      trainerVisibilityPassPeriodEnd = passRow.trainer_visibility_pass_current_period_end ?? null;
      trainerVisibilityStripeCustomerId = passRow.trainer_visibility_stripe_customer_id ?? null;
      trainerVisibilityStripeSubscriptionId = passRow.trainer_visibility_stripe_subscription_id ?? null;
    }
    if (isTrainerVisibilityTestAccount(email, memberBase?.member_code)) {
      trainerVisibilityPassActive = true;
      trainerVisibilityPassStatus = "test";
    }
  }

  let mealPersonalPassActive = false;
  let mealPersonalPassStatus = "inactive";
  let mealPersonalPassPeriodEnd: string | null = null;
  let mealPersonalStripeCustomerId: string | null = null;
  let mealPersonalStripeSubscriptionId: string | null = null;
  {
    const { data: passRow, error: passError } = await (supabase as any)
      .from("members")
      .select(
        "member_code, meal_personal_pass_status, meal_personal_pass_current_period_end, meal_personal_stripe_customer_id, meal_personal_stripe_subscription_id"
      )
      .eq("id", params.memberId)
      .maybeSingle();
    if (!passError && passRow) {
      mealPersonalPassStatus = String(passRow.meal_personal_pass_status ?? "inactive");
      mealPersonalPassActive = isMemberMealPersonalFullEnabled({
        memberCode: passRow.member_code ?? memberBase?.member_code,
        pass: passRow,
      });
      mealPersonalPassPeriodEnd = passRow.meal_personal_pass_current_period_end ?? null;
      mealPersonalStripeCustomerId = passRow.meal_personal_stripe_customer_id ?? null;
      mealPersonalStripeSubscriptionId = passRow.meal_personal_stripe_subscription_id ?? null;
      if (mealPersonalPassActive && mealPersonalPassStatus === "inactive") mealPersonalPassStatus = "pilot";
    } else {
      mealPersonalPassActive = isMemberMealPersonalFullEnabled({ memberCode: memberBase?.member_code });
      if (mealPersonalPassActive) mealPersonalPassStatus = "pilot";
    }
  }

  return (
    <DashboardShell title="会員カルテ">
      <MemberDetailClient
        memberId={params.memberId}
        member={{
          id: memberBase?.id ?? params.memberId,
          member_code: memberBase?.member_code ?? "",
          name: memberBase?.name ?? "",
          email,
          is_active: memberBase?.is_active ?? true,
          membership_status: resolveMembershipStatus(membershipStatusRaw, memberBase?.is_active ?? true),
          withdrawn_at: withdrawnAt,
          withdrawn_trainer_id: withdrawnTrainerId,
          withdrawn_trainer_name: withdrawnTrainerName,
          hiatus_start_at: hiatusStartAt,
          hiatus_end_at: hiatusEndAt,
          joined_at: joinedAt,
          min_commitment_months: minCommitmentMonths,
          has_enrollment_fee: hasEnrollmentFee,
          enrollment_campaign: enrollmentCampaign,
          membership_plan: membershipPlan,
          bonus_ticket_koma: bonusTicketKoma,
          line_user_id: (memberBase as any)?.line_user_id ?? null,
          line_channel_key: normalizeLineChannelKey((memberBase as any)?.line_channel_key),
          line_channel_label: lineChannelLabel(normalizeLineChannelKey((memberBase as any)?.line_channel_key)),
          trainer_visibility_pass_active: trainerVisibilityPassActive,
          trainer_visibility_pass_status: trainerVisibilityPassStatus,
          trainer_visibility_pass_email: trainerVisibilityPassEmail,
          trainer_visibility_pass_period_end: trainerVisibilityPassPeriodEnd,
          trainer_visibility_stripe_customer_id: trainerVisibilityStripeCustomerId,
          trainer_visibility_stripe_subscription_id: trainerVisibilityStripeSubscriptionId,
          meal_personal_full_enabled: mealPersonalPassActive,
          meal_personal_pass_status: mealPersonalPassStatus,
          meal_personal_pass_period_end: mealPersonalPassPeriodEnd,
          meal_personal_stripe_customer_id: mealPersonalStripeCustomerId,
          meal_personal_stripe_subscription_id: mealPersonalStripeSubscriptionId,
        }}
      />
    </DashboardShell>
  );
}
