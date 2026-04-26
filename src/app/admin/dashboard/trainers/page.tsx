import { DashboardShell } from "../_components/DashboardShell";
import { TrainersListClient } from "./trainersListClient";

export default function AdminDashboardTrainersPage() {
  return (
    <DashboardShell title="トレーナー">
      <TrainersListClient />
    </DashboardShell>
  );
}

