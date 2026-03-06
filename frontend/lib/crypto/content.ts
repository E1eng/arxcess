import { EncryptedAssetPayload } from "@arxcess/sdk";
import { bytesToBase64, bytesToHex } from "@/lib/utils/bytes";

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

async function sha256Bytes(input: Uint8Array): Promise<Uint8Array> {
  const digest = await crypto.subtle.digest("SHA-256", toArrayBuffer(input));
  return new Uint8Array(digest);
}

export async function sha256Hex(input: Uint8Array): Promise<string> {
  return bytesToHex(await sha256Bytes(input));
}

export async function encryptFile(file: File): Promise<EncryptedAssetPayload> {
  const contentKey = crypto.getRandomValues(new Uint8Array(32));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintextBuffer = await file.arrayBuffer();
  const cryptoKey = await crypto.subtle.importKey("raw", toArrayBuffer(contentKey), { name: "AES-GCM" }, false, ["encrypt"]);
  const ciphertextBuffer = await crypto.subtle.encrypt({ name: "AES-GCM", iv: toArrayBuffer(iv) }, cryptoKey, plaintextBuffer);
  const ciphertext = new Uint8Array(ciphertextBuffer);

  return {
    ciphertext,
    ciphertextHashHex: await sha256Hex(ciphertext),
    contentKeyBase64: bytesToBase64(contentKey),
    ivBase64: bytesToBase64(iv),
    mimeType: file.type || "application/octet-stream",
    sizeBytes: file.size
  };
}

export async function decryptCiphertext(args: {
  ciphertext: Uint8Array;
  contentKey: Uint8Array;
  iv: Uint8Array;
}): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey("raw", toArrayBuffer(args.contentKey), { name: "AES-GCM" }, false, ["decrypt"]);
  const plaintextBuffer = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: toArrayBuffer(args.iv) },
    cryptoKey,
    toArrayBuffer(args.ciphertext)
  );
  return new Uint8Array(plaintextBuffer);
}

export async function createKeyCommitmentHex(contentKeyBase64: string, ciphertextHashHex: string): Promise<string> {
  const payload = new TextEncoder().encode(`${contentKeyBase64}:${ciphertextHashHex}`);
  return sha256Hex(payload);
}
