import nacl from "tweetnacl";
import { base64ToBytes, bytesToBase64 } from "@/lib/utils/bytes";

export interface DeliveryKeypair {
  publicKeyBase64: string;
  secretKeyBase64: string;
}

export function generateDeliveryKeypair(): DeliveryKeypair {
  const keypair = nacl.box.keyPair();
  return {
    publicKeyBase64: bytesToBase64(keypair.publicKey),
    secretKeyBase64: bytesToBase64(keypair.secretKey)
  };
}

export function decodeDeliveryKeypair(keypair: DeliveryKeypair) {
  return {
    publicKey: base64ToBytes(keypair.publicKeyBase64),
    secretKey: base64ToBytes(keypair.secretKeyBase64)
  };
}
