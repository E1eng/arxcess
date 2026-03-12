import type { Metadata } from "next";
import { AppShell } from "@/components/marketplace/app-shell";
import { ProductCatalog } from "@/components/purchase/product-catalog";

export const metadata: Metadata = {
  title: "Explore Products",
  description: "Browse encrypted digital products. Buy with your Solana wallet."
};

export default function ExplorePage() {
  return (
    <AppShell>
      <ProductCatalog />
    </AppShell>
  );
}
