"use client";

import { useEffect, useState } from "react";
import { LocalPurchaseIntent, listStoredPurchases } from "@/lib/storage/marketplace";

export function usePurchases() {
  const [purchases, setPurchases] = useState<LocalPurchaseIntent[]>([]);

  useEffect(() => {
    setPurchases(listStoredPurchases());

    function handleStorage() {
      setPurchases(listStoredPurchases());
    }

    window.addEventListener("storage", handleStorage);

    return () => {
      window.removeEventListener("storage", handleStorage);
    };
  }, []);

  function refreshPurchases() {
    setPurchases(listStoredPurchases());
  }

  return {
    purchases,
    refreshPurchases
  };
}
