"use client";

import { useEffect, useState } from "react";
import { DeliveryKeypair, generateDeliveryKeypair } from "@/lib/crypto/delivery";
import { getStoredDeliveryKeypair, saveStoredDeliveryKeypair } from "@/lib/storage/marketplace";

export function useDeliveryKeys(wallet: string | null) {
  const [keypair, setKeypair] = useState<DeliveryKeypair | null>(() => getStoredDeliveryKeypair(wallet));

  useEffect(() => {
    if (!wallet) {
      setKeypair(null);
      return;
    }

    const stored = getStoredDeliveryKeypair(wallet);

    if (stored) {
      setKeypair(stored);
      return;
    }

    const created = generateDeliveryKeypair();
    saveStoredDeliveryKeypair(wallet, created);
    setKeypair(created);
  }, [wallet]);

  function ensureKeypair() {
    if (keypair) {
      return keypair;
    }

    const created = generateDeliveryKeypair();
    saveStoredDeliveryKeypair(wallet, created);
    setKeypair(created);
    return created;
  }

  return {
    keypair,
    ensureKeypair
  };
}
