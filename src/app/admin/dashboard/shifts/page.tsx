import { DashboardShell } from "../_components/DashboardShell";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { AdminTrainersClient } from "@/app/admin/trainers/trainersClient";
import { BookingSettingsClient } from "./bookingSettingsClient";

export default async function AdminDashboardShiftsPage() {
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
    .select("id, name, booking_cutoff_prev_day_time")
    .eq("is_active", true)
    .order("name", { ascending: true });

  return (
    <DashboardShell title="シフト">
      <BookingSettingsClient
        stores={(stores ?? []).map((s) => ({
          id: s.id,
          name: s.name,
          booking_cutoff_prev_day_time: (s as any).booking_cutoff_prev_day_time ?? null,
        }))}
      />
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
        hideTrainerSelect
        allowAllStores
      />
    </DashboardShell>
  );
}

