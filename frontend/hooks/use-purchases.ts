"use client";

import { useEffect, useState } from "react";
import { LocalPurchaseIntent, listStoredPurchases } from "@/lib/storage/marketplace";

export function usePurchases() {
  const [purchases, setPurchases] = useState<LocalPurchaseIntent[]>([]);

  useEffect(() => {
    setPurchases(listStoredPurchases());
  }, []);
  function refreshPurchases() {
    setPurchases(listStoredPurchases());
  }

  return {
    purchases,
    refreshPurchases
  };
}
