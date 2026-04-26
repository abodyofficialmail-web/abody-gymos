import { DashboardShell } from "../_components/DashboardShell";
import { ReservationsClient } from "./reservationsClient";

export default function AdminDashboardReservationsPage() {
  return (
    <DashboardShell title="予約">
      <ReservationsClient />
    </DashboardShell>
  );
}

