import { DashboardShell } from "../../_components/DashboardShell";
import { MemberDetailClient } from "./memberDetailClient";
import { createSupabaseServiceClient } from "@/lib/supabase/admin";

export default async function AdminDashboardMemberDetailPage({ params }: { params: { memberId: string } }) {
  const supabase = createSupabaseServiceClient();
  const { data: memberBase } = await supabase
    .from("members")
    // email カラムが未追加の環境でも表示が壊れないように、まず基本情報だけ取得する
    .select("id, member_code, name, line_user_id, is_active")
    .eq("id", params.memberId)
    .maybeSingle();

  // email は存在しないDBもあるため別クエリで試す（失敗しても無視）
  let email: string | null = null;
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
          line_user_id: (memberBase as any)?.line_user_id ?? null,
        }}
      />
    </DashboardShell>
  );
}

