import { AppShell } from "@/components/marketplace/app-shell";
import { ProductCatalog } from "@/components/purchase/product-catalog";

export default function ProductsPage() {
  return (
    <AppShell>
      <ProductCatalog />
    </AppShell>
  );
}
