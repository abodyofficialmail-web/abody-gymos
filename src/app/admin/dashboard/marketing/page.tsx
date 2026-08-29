import { DashboardShell } from "../_components/DashboardShell";
import { MarketingReportClient } from "./marketingClient";

export default function MarketingReportPage() {
  return (
    <DashboardShell title="広告レポート">
      <MarketingReportClient />
    </DashboardShell>
  );
}
