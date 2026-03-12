import type { Metadata } from "next";
import { AppShell } from "@/components/marketplace/app-shell";
import { SellerWorkbench } from "@/components/upload/seller-workbench";

export const metadata: Metadata = {
  title: "Launch a Product",
  description: "Publish encrypted digital products on Solana. Your files are encrypted in the browser before upload."
};

export default function LaunchPage() {
  return (
    <AppShell>
      <SellerWorkbench />
    </AppShell>
  );
}
