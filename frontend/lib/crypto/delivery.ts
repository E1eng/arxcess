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

const DELIVERY_IV_BYTES = 12;
const DELIVERY_CONTENT_KEY_BYTES = 32;

export function sealDeliveryMaterial(args: {
  buyerPublicKeyBase64: string;
  contentKeyBase64: string;
  ivBase64: string;
}) {
  const buyerPublicKey = base64ToBytes(args.buyerPublicKeyBase64);
  const contentKey = base64ToBytes(args.contentKeyBase64);
  const iv = base64ToBytes(args.ivBase64);

  if (iv.length !== DELIVERY_IV_BYTES) {
    throw new Error("IV must be 12 bytes");
  }

  const ephemeralKeypair = nacl.box.keyPair();
  const nonce = nacl.randomBytes(nacl.box.nonceLength);
  const payload = new Uint8Array(contentKey.length + iv.length);

  payload.set(contentKey, 0);
  payload.set(iv, contentKey.length);

  const sealedPayload = nacl.box(payload, nonce, buyerPublicKey, ephemeralKeypair.secretKey);
  const sealedKeyBox = new Uint8Array(ephemeralKeypair.publicKey.length + nonce.length + sealedPayload.length);

  sealedKeyBox.set(ephemeralKeypair.publicKey, 0);
  sealedKeyBox.set(nonce, ephemeralKeypair.publicKey.length);
  sealedKeyBox.set(sealedPayload, ephemeralKeypair.publicKey.length + nonce.length);

  return bytesToBase64(sealedKeyBox);
}
