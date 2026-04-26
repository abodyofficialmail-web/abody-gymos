import { GymShell } from "@/components/gym/GymShell";
import { createSupabaseServiceClient } from "@/lib/supabase/admin";
import { TrainersDashboardClient } from "./dashboardClient";

export default async function AdminTrainersDashboardPage() {
  const supabase = createSupabaseServiceClient();
  const { data: trainers } = await supabase
    .from("trainers")
    .select("id, display_name, store_id, is_active")
    .eq("is_active", true)
    .order("created_at", { ascending: true });
  const { data: stores } = await supabase.from("stores").select("id, name");
  const storeName = new Map((stores ?? []).map((s) => [s.id, s.name]));
  const rows = (trainers ?? []).map((t) => ({
    id: t.id,
    display_name: t.display_name,
    store_id: (t as { store_id: string }).store_id,
    store_name: storeName.get((t as { store_id: string }).store_id) ?? "",
  }));

  return (
    <GymShell
      title="トレーナーダッシュボード"
      nav={[
        { href: "/admin/dashboard", label: "ホーム" },
        { href: "/admin/stores", label: "店舗" },
        { href: "/admin/trainers", label: "トレーナー" },
        { href: "/admin/members", label: "会員" },
      ]}
    >
      <div className="mb-4">
        <a href="/admin/trainers" className="text-sm text-slate-600 underline">
          ← シフト管理
        </a>
      </div>
      <TrainersDashboardClient trainers={rows} />
    </GymShell>
  );
}
