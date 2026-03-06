import { LocalProductListing } from "@/lib/storage/marketplace";

 export function hasSupabaseListingsPublicConfig() {
   return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL);
 }

export async function fetchMarketplaceListings(): Promise<LocalProductListing[]> {
  const response = await fetch("/api/listings", {
    method: "GET",
    cache: "no-store"
  });

  if (!response.ok) {
    throw new Error(await response.text());
  }

  return (await response.json()) as LocalProductListing[];
}

export async function createMarketplaceListing(listing: LocalProductListing): Promise<LocalProductListing> {
  const response = await fetch("/api/listings", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(listing)
  });

  if (!response.ok) {
    throw new Error(await response.text());
  }

  return (await response.json()) as LocalProductListing;
}
