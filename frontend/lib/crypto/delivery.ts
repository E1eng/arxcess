import nacl from "tweetnacl";
import { base64ToBytes, bytesToBase64, bytesToHex, concatBytes } from "@/lib/utils/bytes";

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

export function unsealDeliveryMaterial(args: {
  sealedKeyBoxBase64: string;
  keypair: DeliveryKeypair;
}) {
  const sealedKeyBox = base64ToBytes(args.sealedKeyBoxBase64);
  const { secretKey } = decodeDeliveryKeypair(args.keypair);
  const publicKeyLength = nacl.box.publicKeyLength;
  const nonceLength = nacl.box.nonceLength;

  if (sealedKeyBox.length <= publicKeyLength + nonceLength) {
    throw new Error("Sealed key box is too short");
  }

  const senderPublicKey = sealedKeyBox.slice(0, publicKeyLength);
  const nonce = sealedKeyBox.slice(publicKeyLength, publicKeyLength + nonceLength);
  const payload = sealedKeyBox.slice(publicKeyLength + nonceLength);
  const opened = nacl.box.open(payload, nonce, senderPublicKey, secretKey);

  if (!opened) {
    throw new Error("Failed to unseal delivery material");
  }

  if (opened.length !== DELIVERY_CONTENT_KEY_BYTES + DELIVERY_IV_BYTES) {
    throw new Error("Unsealed delivery material has an invalid payload shape");
  }

  return {
    contentKey: opened.slice(0, DELIVERY_CONTENT_KEY_BYTES),
    iv: opened.slice(DELIVERY_CONTENT_KEY_BYTES)
  };
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

export async function createDeliveryMaterialDigestHex(args: { contentKey: Uint8Array; iv: Uint8Array }) {
  const payload = concatBytes(args.contentKey, args.iv);
  const digest = await crypto.subtle.digest("SHA-256", toArrayBuffer(payload));
  return bytesToHex(new Uint8Array(digest));
}

export async function createDeliveryCommitmentHex(sealedKeyBoxBase64: string) {
  const sealedKeyBox = base64ToBytes(sealedKeyBoxBase64);
  const digest = await crypto.subtle.digest("SHA-256", toArrayBuffer(sealedKeyBox));
  return bytesToHex(new Uint8Array(digest));
}
