import { DashboardShell } from "../../../_components/DashboardShell";
import { createSupabaseServiceClient } from "@/lib/supabase/admin";
import { MemberOnboardingClient } from "./onboardingClient";
import { notFound } from "next/navigation";

export default async function MemberOnboardingPage({ params }: { params: { memberId: string } }) {
  const supabase = createSupabaseServiceClient();
  const { data: member } = await supabase
    .from("members")
    .select("id, member_code, name, email, store_id, is_active")
    .eq("id", params.memberId)
    .maybeSingle();

  if (!member || !member.is_active) notFound();

  return (
    <DashboardShell title="カウンセリング・体験記録">
      <MemberOnboardingClient
        memberId={params.memberId}
        member={{
          id: member.id,
          member_code: member.member_code,
          name: member.name,
          email: member.email ?? null,
          store_id: member.store_id ?? null,
        }}
      />
    </DashboardShell>
  );
}
