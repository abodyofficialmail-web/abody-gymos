import { GymShell } from "@/components/gym/GymShell";
import { createSupabaseServiceClient } from "@/lib/supabase/admin";
import { ShiftDayClient } from "./shiftDayClient";

export default async function AdminTrainerShiftDayPage({ params }: { params: { date: string } }) {
  const date = params.date;
  const supabase = createSupabaseServiceClient();

  const { data: stores } = await supabase
    .from("stores")
    .select("id, name")
    .eq("is_active", true)
    .order("name", { ascending: true });

  const { data: trainers } = await supabase
    .from("trainers")
    .select("id, display_name, store_id, is_active")
    .eq("is_active", true)
    .order("created_at", { ascending: true });

  return (
    <GymShell
      title="シフト詳細"
      nav={[
        { href: "/admin/dashboard", label: "ホーム" },
        { href: "/admin/stores", label: "店舗" },
        { href: "/admin/trainers", label: "トレーナー" },
        { href: "/admin/members", label: "会員" },
      ]}
    >
      <ShiftDayClient
        date={date}
        stores={(stores ?? []).map((s) => ({ id: s.id, name: s.name }))}
        trainers={(trainers ?? []).map((t) => ({
          id: t.id,
          display_name: t.display_name,
          store_id: (t as any).store_id as string,
        }))}
      />
    </GymShell>
  );
}

