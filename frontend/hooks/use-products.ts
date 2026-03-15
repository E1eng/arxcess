"use client";

import { useCallback, useEffect, useState } from "react";
import { fetchMarketplaceListings, hasSupabaseListingsPublicConfig } from "@/lib/marketplace/listings";
import { LocalProductListing, listStoredProducts, saveStoredProduct } from "@/lib/storage/marketplace";

export function useProducts() {
  const [products, setProducts] = useState<LocalProductListing[]>([]);

  const loadProducts = useCallback(async () => {
    if (!hasSupabaseListingsPublicConfig()) {
      setProducts(listStoredProducts());
      return;
    }

    try {
      const listings = await fetchMarketplaceListings();

      listings.forEach((listing) => {
        saveStoredProduct(listing);
      });
      const localListings = listStoredProducts();
      const merged = [...listings];

      localListings.forEach((listing) => {
        if (!merged.some((entry) => entry.productIdHex === listing.productIdHex)) {
          merged.push(listing);
        }
      });

      setProducts(merged);
    } catch {
      setProducts(listStoredProducts());
    }
  }, []);

  useEffect(() => {
    let ignore = false;

    async function syncProducts() {
      if (ignore) {
        return;
      }

      await loadProducts();
    }

    void syncProducts();

    const interval = window.setInterval(() => {
      void syncProducts();
    }, 10000);

    const handleFocus = () => {
      void syncProducts();
    };

    window.addEventListener("focus", handleFocus);

    return () => {
      ignore = true;
      window.clearInterval(interval);
      window.removeEventListener("focus", handleFocus);
    };
  }, [loadProducts]);

  return {
    products,
    refreshProducts: loadProducts
  };
}
