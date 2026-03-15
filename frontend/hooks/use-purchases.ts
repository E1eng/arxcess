"use client";

import { useCallback, useEffect, useState } from "react";
import { fetchMarketplacePurchases, hasSupabasePurchasesPublicConfig } from "@/lib/marketplace/purchases";
import { LocalPurchaseIntent, listStoredPurchases, saveStoredPurchase } from "@/lib/storage/marketplace";

export function usePurchases() {
  const [purchases, setPurchases] = useState<LocalPurchaseIntent[]>([]);

  const loadPurchases = useCallback(async () => {
    if (!hasSupabasePurchasesPublicConfig()) {
      setPurchases(listStoredPurchases());
      return;
    }

    try {
      const remotePurchases = await fetchMarketplacePurchases();

      remotePurchases.forEach((purchase) => {
        saveStoredPurchase(purchase);
      });

      const localPurchases = listStoredPurchases();
      const merged = [...remotePurchases];

      localPurchases.forEach((purchase) => {
        if (!merged.some((entry) => entry.purchaseIdHex === purchase.purchaseIdHex)) {
          merged.push(purchase);
        }
      });

      setPurchases(merged);
    } catch {
      setPurchases(listStoredPurchases());
    }
  }, []);

  useEffect(() => {
    let ignore = false;

    async function syncPurchases() {
      if (ignore) {
        return;
      }

      await loadPurchases();
    }

    void syncPurchases();

    function handleStorage() {
      void syncPurchases();
    }

    window.addEventListener("storage", handleStorage);

    const interval = window.setInterval(() => {
      void syncPurchases();
    }, 10000);

    return () => {
      ignore = true;
      window.clearInterval(interval);
      window.removeEventListener("storage", handleStorage);
    };
  }, [loadPurchases]);

  const refreshPurchases = useCallback(() => loadPurchases(), [loadPurchases]);

  return {
    purchases,
    refreshPurchases
  };
}
