import { resolveMembershipStatus, type MembershipStatus } from "@/lib/memberMembershipStatus";
import { lineChannelLabel, normalizeLineChannelKey } from "@/lib/lineChannel";
import { DashboardShell } from "../../_components/DashboardShell";
import { MemberDetailClient } from "./memberDetailClient";
import { createSupabaseServiceClient } from "@/lib/supabase/admin";

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
      .select("membership_status, withdrawn_at, withdrawn_trainer_id")
      .eq("id", params.memberId)
      .maybeSingle();
    if (!statusError && memberStatus) {
      membershipStatusRaw = (memberStatus as { membership_status?: MembershipStatus | null }).membership_status ?? null;
      withdrawnAt = (memberStatus as { withdrawn_at?: string | null }).withdrawn_at ?? null;
      withdrawnTrainerId = (memberStatus as { withdrawn_trainer_id?: string | null }).withdrawn_trainer_id ?? null;
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
          line_user_id: (memberBase as any)?.line_user_id ?? null,
          line_channel_key: normalizeLineChannelKey((memberBase as any)?.line_channel_key),
          line_channel_label: lineChannelLabel(normalizeLineChannelKey((memberBase as any)?.line_channel_key)),
        }}
      />
    </DashboardShell>
  );
}
