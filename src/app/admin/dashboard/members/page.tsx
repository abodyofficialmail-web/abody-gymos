import { unstable_noStore as noStore } from "next/cache";
import { DashboardShell } from "../_components/DashboardShell";
import { createSupabaseServiceClient } from "@/lib/supabase/admin";
import { MembersClient } from "./membersClient";
import { isTrainerVisibilityPassActive, isTrainerVisibilityTestAccount } from "@/lib/trainerVisibilityPass";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

export default async function AdminDashboardMembersPage() {
  noStore();
  const supabase = createSupabaseServiceClient();
  const { data: stores } = await supabase.from("stores").select("id, name").order("created_at", { ascending: true });

  // store_id / email も含めて取得（検索・店舗フィルタ用）
  // NOTE: Database 型定義にリレーションが無い場合でも JOIN できるよう any 経由で実行
  const memberSelectWithPass = `
        id,
        member_code,
        name,
        email,
        store_id,
        line_user_id,
        is_active,
        membership_status,
        membership_plan,
        created_at,
        trainer_visibility_pass_status,
        trainer_visibility_pass_current_period_end,
        trainer_visibility_pass_email,
        stores(
          id,
          name
        )
      `;
  const memberSelectWithPassStatus = `
        id,
        member_code,
        name,
        email,
        store_id,
        line_user_id,
        is_active,
        membership_status,
        membership_plan,
        created_at,
        trainer_visibility_pass_status,
        trainer_visibility_pass_current_period_end,
        stores(
          id,
          name
        )
      `;
  const memberSelectWithStatus = `
        id,
        member_code,
        name,
        email,
        store_id,
        line_user_id,
        is_active,
        membership_status,
        membership_plan,
        created_at,
        stores(
          id,
          name
        )
      `;
  const memberSelectLegacy = `
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
      `;

  let members: any[] | null = null;
  {
    const first = await (supabase as any).from("members").select(memberSelectWithPass).order("member_code", { ascending: true });
    if (!first.error) {
      members = first.data ?? [];
    } else if (/membership_plan/i.test(String(first.error.message ?? ""))) {
      const retry = await (supabase as any)
        .from("members")
        .select(memberSelectWithPass.replace(/\s*membership_plan,\n/, "\n"))
        .order("member_code", { ascending: true });
      if (!retry.error) members = retry.data ?? [];
      else {
        const second = await (supabase as any).from("members").select(memberSelectLegacy).order("member_code", { ascending: true });
        members = second.data ?? [];
      }
    } else if (/trainer_visibility_pass_email/i.test(String(first.error.message ?? ""))) {
      const retry = await (supabase as any).from("members").select(memberSelectWithPassStatus).order("member_code", { ascending: true });
      if (!retry.error) members = retry.data ?? [];
      else if (String(retry.error.message ?? "").includes("membership_status")) {
        const second = await (supabase as any).from("members").select(memberSelectLegacy).order("member_code", { ascending: true });
        members = second.data ?? [];
      } else {
        members = retry.data ?? [];
      }
    } else if (/trainer_visibility_/i.test(String(first.error.message ?? ""))) {
      const retry = await (supabase as any).from("members").select(memberSelectWithStatus).order("member_code", { ascending: true });
      if (!retry.error) {
        members = retry.data ?? [];
      } else if (String(retry.error.message ?? "").includes("membership_status")) {
        const second = await (supabase as any).from("members").select(memberSelectLegacy).order("member_code", { ascending: true });
        members = second.data ?? [];
      } else {
        members = retry.data ?? [];
      }
    } else if (String(first.error.message ?? "").includes("membership_status")) {
      const second = await (supabase as any).from("members").select(memberSelectLegacy).order("member_code", { ascending: true });
      members = second.data ?? [];
    } else {
      members = first.data ?? [];
    }
  }

  const normalizedMembers =
    (members ?? []).map((m: any) => {
      const passActive =
        isTrainerVisibilityPassActive(m) || isTrainerVisibilityTestAccount(m?.email, m?.member_code);
      return {
        id: m.id,
        member_code: m.member_code ?? "",
        name: m.name ?? "",
        email: (m as any)?.email ?? null,
        store_id: (m as any)?.store_id ?? null,
        store_name: m.stores?.name ?? null,
        line_user_id: (m as any)?.line_user_id ?? null,
        is_active: (m as any)?.is_active !== false,
        membership_status: (m as any)?.membership_status ?? null,
        membership_plan: (m as any)?.membership_plan ?? null,
        trainer_visibility_pass_active: passActive,
        trainer_visibility_pass_email: (m as any)?.trainer_visibility_pass_email ?? null,
      };
    }) ?? [];

  return (
    <DashboardShell title="会員">
      <MembersClient stores={(stores ?? []) as any} members={normalizedMembers} />
    </DashboardShell>
  );
}

