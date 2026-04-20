import { redirect } from "next/navigation";
import { GymShell } from "@/components/gym/GymShell";
import { getProfileRole } from "@/lib/gym/context";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { AdminTrainersClient } from "./trainersClient";

export default async function AdminTrainersPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const profile = await getProfileRole(supabase, user.id);
  if (profile?.role !== "admin") redirect("/login/role");

  const { data: rows } = await supabase
    .from("trainers")
    .select("id, display_name, email, hourly_rate_yen, is_active, user_id, store_id, stores ( name )")
    .order("created_at", { ascending: true });

  const { data: stores } = await supabase
    .from("stores")
    .select("id, name")
    .eq("is_active", true)
    .order("name", { ascending: true });

  return (
    <GymShell title="トレーナー" nav={[{ href: "/admin/trainers", label: "トレーナー" }]}>
      <AdminTrainersClient
        stores={(stores ?? []).map((s) => ({ id: s.id, name: s.name }))}
        trainers={(rows ?? []).map((t) => ({
          id: t.id,
          display_name: t.display_name,
          email: t.email,
          hourly_rate_yen: t.hourly_rate_yen,
          is_active: t.is_active,
          user_id: t.user_id,
          store_id: (t as any).store_id,
          store_name:
            t.stores && typeof t.stores === "object" && "name" in t.stores ? String((t.stores as any).name) : "",
        }))}
      />
    </GymShell>
  );
}

