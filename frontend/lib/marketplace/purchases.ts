import { LocalPurchaseIntent } from "@/lib/storage/marketplace";

export function hasSupabasePurchasesPublicConfig() {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL);
}

export async function fetchMarketplacePurchases(): Promise<LocalPurchaseIntent[]> {
  const response = await fetch("/api/purchases", {
    method: "GET",
    cache: "no-store"
  });

  if (!response.ok) {
    throw new Error(await response.text());
  }

  return (await response.json()) as LocalPurchaseIntent[];
}

export async function upsertMarketplacePurchase(purchase: LocalPurchaseIntent): Promise<LocalPurchaseIntent> {
  const response = await fetch("/api/purchases", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(purchase)
  });

  if (!response.ok) {
    throw new Error(await response.text());
  }

  return (await response.json()) as LocalPurchaseIntent;
}
