import { DashboardShell } from "../_components/DashboardShell";
import { PaymentLinksClient } from "./paymentLinksClient";

export default function PaymentLinksPage() {
  return (
    <DashboardShell title="決済リンク">
      <PaymentLinksClient />
    </DashboardShell>
  );
}
