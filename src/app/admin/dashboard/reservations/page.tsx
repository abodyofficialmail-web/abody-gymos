import { unstable_noStore as noStore } from "next/cache";
import { DashboardShell } from "../_components/DashboardShell";
import { createSupabaseServiceClient } from "@/lib/supabase/admin";
import { ReservationsClient } from "./reservationsClient";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

export default async function AdminDashboardReservationsPage() {
  noStore();
  const supabase = createSupabaseServiceClient();
  const { data: stores } = await supabase.from("stores").select("id, name").order("created_at", { ascending: true });

  return (
    <DashboardShell title="予約">
      <ReservationsClient initialStores={(stores ?? []).map((s) => ({ id: s.id, name: s.name }))} />
    </DashboardShell>
  );
}
