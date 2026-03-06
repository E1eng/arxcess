"use client";

import { useEffect, useState } from "react";
import { fetchMarketplaceListings, hasSupabaseListingsPublicConfig } from "@/lib/marketplace/listings";
import { LocalProductListing, listStoredProducts, saveStoredProduct } from "@/lib/storage/marketplace";

export function useProducts() {
  const [products, setProducts] = useState<LocalProductListing[]>([]);

  useEffect(() => {
    let ignore = false;

    async function loadProducts() {
      if (!hasSupabaseListingsPublicConfig()) {
        if (!ignore) {
          setProducts(listStoredProducts());
        }

        return;
      }

      try {
        const listings = await fetchMarketplaceListings();

        if (!ignore) {
          listings.forEach((listing) => {
            saveStoredProduct(listing);
          });
          setProducts(listings);
        }
      } catch {
        if (!ignore) {
          setProducts(listStoredProducts());
        }
      }
    }

    void loadProducts();

    return () => {
      ignore = true;
    };
  }, []);
  return {
    products
  };
}
