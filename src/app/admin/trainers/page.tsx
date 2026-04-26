import { GymShell } from "@/components/gym/GymShell";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { AdminTrainersClient } from "./trainersClient";
export default async function AdminTrainersPage() {
  const supabase = await createSupabaseServerClient();
  const { data: rows } = await supabase
    .from("trainers")
    .select(
      `
      id,
      display_name,
      email,
      hourly_rate_yen,
      is_active,
      user_id,
      store_id,
      stores ( name )
    `
    )
    .order("created_at", { ascending: true });
  const { data: stores } = await supabase
    .from("stores")
    .select("id, name")
    .eq("is_active", true)
    .order("name", { ascending: true });
  return (
    <GymShell
      title="シフト管理"
      nav={[
        { href: "/admin/dashboard", label: "ホーム" },
        { href: "/admin/stores", label: "店舗" },
        { href: "/admin/trainers", label: "トレーナー" },
        { href: "/admin/members", label: "会員" },
      ]}
    >
      <div className="mb-3">
        <a href="/admin/trainers/dashboard" className="text-sm font-medium text-teal-700 underline">
          トレーナーダッシュボード
        </a>
      </div>
      <AdminTrainersClient
        stores={(stores ?? []).map((s) => ({ id: s.id, name: s.name }))}
        trainers={(rows ?? []).map((t) => ({
          id: t.id,
          display_name: t.display_name,
          store_id: (t as any).store_id,
          store_name:
            t.stores && typeof t.stores === "object" && "name" in t.stores
              ? String((t.stores as { name: string }).name)
              : "",
          hourly_rate_yen: t.hourly_rate_yen,
          is_active: t.is_active,
          user_id: t.user_id,
          email: t.email,
        }))}
      />
    </GymShell>
  );
}

