import { DashboardShell } from "../_components/DashboardShell";
import { SessionSurveysClient } from "./sessionSurveysClient";

export default function SessionSurveysPage() {
  return (
    <DashboardShell title="セッション評価・要ヒアリング">
      <SessionSurveysClient />
    </DashboardShell>
  );
}
