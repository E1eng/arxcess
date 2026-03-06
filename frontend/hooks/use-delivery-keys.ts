"use client";

import { useMemo, useState } from "react";
import { DeliveryKeypair, generateDeliveryKeypair } from "@/lib/crypto/delivery";
import { getStoredDeliveryKeypair, saveStoredDeliveryKeypair } from "@/lib/storage/marketplace";

export function useDeliveryKeys() {
  const [keypair, setKeypair] = useState<DeliveryKeypair | null>(() => getStoredDeliveryKeypair());

  const hasKeypair = useMemo(() => keypair !== null, [keypair]);

  function ensureKeypair() {
    if (keypair) {
      return keypair;
    }

    const created = generateDeliveryKeypair();
    saveStoredDeliveryKeypair(created);
    setKeypair(created);
    return created;
  }

  return {
    keypair,
    hasKeypair,
    ensureKeypair
  };
}
