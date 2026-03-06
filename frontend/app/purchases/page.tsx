import { AppShell } from "@/components/marketplace/app-shell";
import { PurchasesList } from "@/components/purchase/purchases-list";

export default function PurchasesPage() {
  return (
    <AppShell>
      <PurchasesList />
    </AppShell>
  );
}
