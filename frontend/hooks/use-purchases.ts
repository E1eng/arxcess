"use client";

import { useEffect, useState } from "react";
import { LocalPurchaseIntent, listStoredPurchases, saveStoredPurchase } from "@/lib/storage/marketplace";

export function usePurchases() {
  const [purchases, setPurchases] = useState<LocalPurchaseIntent[]>([]);

  useEffect(() => {
    setPurchases(listStoredPurchases());
  }, []);

  function addPurchase(purchase: LocalPurchaseIntent) {
    saveStoredPurchase(purchase);
    setPurchases(listStoredPurchases());
  }

  return {
    purchases,
    addPurchase
  };
}
