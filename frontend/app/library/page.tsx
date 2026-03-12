import type { Metadata } from "next";
import { AppShell } from "@/components/marketplace/app-shell";
import { PurchasesList } from "@/components/purchase/purchases-list";

export const metadata: Metadata = {
  title: "My Library",
  description: "Access your purchased encrypted products and manage deliveries."
};

export default function LibraryPage() {
  return (
    <AppShell>
      <PurchasesList />
    </AppShell>
  );
}
