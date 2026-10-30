import { DashboardShell } from "../_components/DashboardShell";
import { StaffManual } from "./staffManual";

export default function StaffManualPage() {
  return (
    <DashboardShell title="使い方" wide>
      <StaffManual />
    </DashboardShell>
  );
}
