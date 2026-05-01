import { DashboardShell } from "../_components/DashboardShell";
import { createSupabaseServiceClient } from "@/lib/supabase/admin";
import { MembersClient } from "./membersClient";

export default async function AdminDashboardMembersPage() {
  const supabase = createSupabaseServiceClient();
  const { data: stores } = await supabase.from("stores").select("id, name").order("created_at", { ascending: true });

  // store_id / email も含めて取得（検索・店舗フィルタ用）
  // NOTE: Database 型定義にリレーションが無い場合でも JOIN できるよう any 経由で実行
  const { data: members } = await (supabase as any)
    .from("members")
    .select(
      `
        id,
        member_code,
        name,
        email,
        store_id,
        line_user_id,
        is_active,
        created_at,
        stores(
          id,
          name
        )
      `
    )
    .order("member_code", { ascending: true });

  const normalizedMembers =
    (members ?? []).map((m: any) => ({
      id: m.id,
      member_code: m.member_code ?? "",
      name: m.name ?? "",
      email: (m as any)?.email ?? null,
      store_id: (m as any)?.store_id ?? null,
      store_name: m.stores?.name ?? null,
      line_user_id: (m as any)?.line_user_id ?? null,
      is_active: Boolean((m as any)?.is_active ?? true),
    })) ?? [];

  return (
    <DashboardShell title="会員">
      <MembersClient stores={(stores ?? []) as any} members={normalizedMembers} />
    </DashboardShell>
  );
}

