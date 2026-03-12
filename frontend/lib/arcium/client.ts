import { AnchorProvider } from "@coral-xyz/anchor";
import { createPacker, getMXEPublicKey, RescueCipher, x25519 } from "@arcium-hq/client";
import { PublicKey } from "@solana/web3.js";
import { getProgramId } from "@/lib/anchor/client";
import { decodeDeliveryKeypair, type DeliveryKeypair } from "@/lib/crypto/delivery";
import { type DepositKeyPayload } from "@/lib/arcium/payload";
import { type ListingCustodyMode } from "@/lib/storage/marketplace";
import { base64ToBytes, bytesToHex, concatBytes, hexToBytes } from "@/lib/utils/bytes";

const FIXED_ID_BYTES = 32;
const DELIVERY_IV_BYTES = 12;
const PACKED_DELIVERY_CIPHERTEXT_COUNT = 2;
const PACKED_DELIVERY_MATERIAL_TOTAL_BYTES = 44;
const ARCIUM_FRONTEND_BLOCK_MESSAGE = "Arcium custody needs frontend runtime support that matches the current encrypted circuit shape.";
const PACKED_DELIVERY_MATERIAL_PACKER = createPacker<{ bytes: bigint[] }, { bytes: bigint[] }>(
  Array.from({ length: PACKED_DELIVERY_MATERIAL_TOTAL_BYTES }, (_, index) => ({
    name: `bytes[${index}]`,
    type: { Integer: { signed: false, width: 8 } }
  })),
  "PackedDeliveryMaterial"
);

function hasArciumClusterOffsetConfig() {
  return Boolean(process.env.NEXT_PUBLIC_ARCIUM_CLUSTER_OFFSET?.trim());
}

export interface CustodyPreparationResult {
  custodyMode: ListingCustodyMode;
  keyCommitmentHex?: string;
  arciumPublishMaterial?: {
    sellerEncryptionPublicKey: Uint8Array;
    encryptedKeyCiphertexts: Uint8Array[];
    encryptedKeyNonce: bigint;
  };
}

export function isArciumFrontendRuntimeReady() {
  return hasArciumClusterOffsetConfig();
}

export function getArciumFrontendBlockMessage(action?: "publish" | "finalize") {
  if (action === "publish") {
    if (!hasArciumClusterOffsetConfig()) {
      return "Arcium publish needs NEXT_PUBLIC_ARCIUM_CLUSTER_OFFSET before the frontend can queue request_deposit_product_key.";
    }

    return `${ARCIUM_FRONTEND_BLOCK_MESSAGE} Rebuild the frontend runtime after encrypted circuit changes before creating listings.`;
  }

  if (action === "finalize") {
    if (!hasArciumClusterOffsetConfig()) {
      return "Arcium delivery finalization needs NEXT_PUBLIC_ARCIUM_CLUSTER_OFFSET before the frontend can queue request_evaluate_and_seal.";
    }

    return `${ARCIUM_FRONTEND_BLOCK_MESSAGE} Rebuild the frontend runtime after encrypted circuit changes before finalizing this listing.`;
  }

  return ARCIUM_FRONTEND_BLOCK_MESSAGE;
}

function assertFixedBytes(label: string, bytes: Uint8Array, expectedLength: number) {
  if (bytes.length !== expectedLength) {
    throw new Error(`${label} must be ${expectedLength} bytes`);
  }

  return bytes;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function randomBytes(length: number) {
  return crypto.getRandomValues(new Uint8Array(length));
}

function bytesToBigIntLE(bytes: Uint8Array) {
  let value = 0n;

  for (let index = bytes.length - 1; index >= 0; index -= 1) {
    value = (value << 8n) | BigInt(bytes[index]);
  }

  return value;
}

function bigIntToBytesLE(value: bigint, length: number) {
  const output = new Uint8Array(length);
  let remaining = value;

  for (let index = 0; index < length; index += 1) {
    output[index] = Number(remaining & 0xffn);
    remaining >>= 8n;
  }

  if (remaining !== 0n) {
    throw new Error(`BigInt does not fit into ${length} bytes`);
  }

  return output;
}

function packDeliveryMaterial(contentKeyBytes: Uint8Array, ivBytes: Uint8Array) {
  const materialBytes = concatBytes(contentKeyBytes, ivBytes);
  if (materialBytes.length !== PACKED_DELIVERY_MATERIAL_TOTAL_BYTES) {
    throw new Error(`Packed delivery material must be ${PACKED_DELIVERY_MATERIAL_TOTAL_BYTES} bytes`);
  }

  return PACKED_DELIVERY_MATERIAL_PACKER.pack({
    bytes: Array.from(materialBytes, (value) => BigInt(value))
  });
}

function unpackDeliveryMaterial(chunks: bigint[]) {
  if (chunks.length !== PACKED_DELIVERY_CIPHERTEXT_COUNT) {
    throw new Error(`Packed delivery material must contain ${PACKED_DELIVERY_CIPHERTEXT_COUNT} field elements`);
  }

  const unpacked = PACKED_DELIVERY_MATERIAL_PACKER.unpack(chunks);
  const bytes = unpacked.bytes.map((value, index) => {
    if (value < 0n || value > 255n) {
      throw new Error(`Packed delivery material byte ${index} is out of range`);
    }

    return Number(value);
  });
  const materialBytes = Uint8Array.from(bytes);

  return {
    contentKey: materialBytes.slice(0, FIXED_ID_BYTES),
    iv: materialBytes.slice(FIXED_ID_BYTES, FIXED_ID_BYTES + DELIVERY_IV_BYTES)
  };
}

function decryptArciumDeliveryMaterial(args: {
  keypair: DeliveryKeypair;
  sharedPublicKey: Uint8Array;
  deliveryNonce: bigint;
  deliveryCiphertexts: Uint8Array[];
}) {
  if (args.deliveryCiphertexts.length !== PACKED_DELIVERY_CIPHERTEXT_COUNT) {
    throw new Error(`Arcium delivery payload must contain ${PACKED_DELIVERY_CIPHERTEXT_COUNT} ciphertext field elements`);
  }

  const { secretKey } = decodeDeliveryKeypair(args.keypair);
  const sharedSecret = x25519.getSharedSecret(
    assertFixedBytes("Buyer delivery secret key", secretKey, FIXED_ID_BYTES),
    assertFixedBytes("Arcium shared public key", args.sharedPublicKey, FIXED_ID_BYTES)
  );
  const cipher = new RescueCipher(sharedSecret);
  const plaintext = cipher.decrypt(
    args.deliveryCiphertexts.map((ciphertext, index) => {
      return Array.from(assertFixedBytes(`Arcium delivery ciphertext #${index + 1}`, ciphertext, FIXED_ID_BYTES));
    }),
    bigIntToBytesLE(args.deliveryNonce, 16)
  );

  return unpackDeliveryMaterial(plaintext);
}

async function deriveListingKeyCommitmentHex(args: {
  contentKeyBase64: string;
  ciphertextHashHex: string;
  productIdHex: string;
  sellerWallet: string;
}) {
  const payload = concatBytes(
    hexToBytes(args.productIdHex),
    new PublicKey(args.sellerWallet).toBytes(),
    hexToBytes(args.ciphertextHashHex),
    base64ToBytes(args.contentKeyBase64)
  );
  const digest = await crypto.subtle.digest("SHA-256", toArrayBuffer(payload));
  return bytesToHex(new Uint8Array(digest));
}

export async function createArciumDeliveryCommitmentHex(args: {
  deliveryEncryptionKey: Uint8Array;
  deliveryNonce: bigint;
  deliveryCiphertexts: Uint8Array[];
}) {
  const payload = concatBytes(
    assertFixedBytes("Arcium delivery encryption key", args.deliveryEncryptionKey, FIXED_ID_BYTES),
    bigIntToBytesLE(args.deliveryNonce, 16),
    ...args.deliveryCiphertexts.map((ciphertext, index) => {
      return assertFixedBytes(`Arcium delivery ciphertext #${index + 1}`, ciphertext, FIXED_ID_BYTES);
    })
  );
  const digest = await crypto.subtle.digest("SHA-256", toArrayBuffer(payload));
  return bytesToHex(new Uint8Array(digest));
}

export async function getArciumMxePublicKey(args: {
  provider: AnchorProvider;
  mxeProgramId?: PublicKey;
}) {
  const mxeProgramId = args.mxeProgramId ?? getProgramId();

  if (!mxeProgramId) {
    throw new Error("Missing NEXT_PUBLIC_PROGRAM_ID.");
  }

  const mxePublicKey = await getMXEPublicKey(args.provider, mxeProgramId);

  if (!mxePublicKey) {
    throw new Error("Unable to fetch the MXE x25519 public key for Arcium reveal.");
  }

  return mxePublicKey;
}

export async function revealArciumDeliveryMaterial(args: {
  keypair: DeliveryKeypair;
  deliveryEncryptionKey: Uint8Array;
  mxePublicKey: Uint8Array;
  deliveryNonce: bigint;
  deliveryCiphertexts: Uint8Array[];
}) {
  if (args.deliveryCiphertexts.length !== PACKED_DELIVERY_CIPHERTEXT_COUNT) {
    throw new Error(`Arcium delivery payload must contain ${PACKED_DELIVERY_CIPHERTEXT_COUNT} ciphertext field elements`);
  }

  const { publicKey } = decodeDeliveryKeypair(args.keypair);
  const deliveryOwnerPublicKey = assertFixedBytes("Arcium delivery owner public key", args.deliveryEncryptionKey, FIXED_ID_BYTES);

  if (!deliveryOwnerPublicKey.every((byte, index) => byte === publicKey[index])) {
    throw new Error("Arcium delivery owner public key does not match the buyer delivery keypair.");
  }

  return decryptArciumDeliveryMaterial({
    keypair: args.keypair,
    sharedPublicKey: args.mxePublicKey,
    deliveryNonce: args.deliveryNonce,
    deliveryCiphertexts: args.deliveryCiphertexts
  });
}

export function revealArciumDeliveryMaterialWithNonce(args: {
  keypair: DeliveryKeypair;
  mxePublicKey: Uint8Array;
  deliveryNonce: bigint;
  deliveryCiphertexts: Uint8Array[];
}) {
  return decryptArciumDeliveryMaterial({
    keypair: args.keypair,
    sharedPublicKey: args.mxePublicKey,
    deliveryNonce: args.deliveryNonce,
    deliveryCiphertexts: args.deliveryCiphertexts
  });
}

export async function prepareListingCustody(
  payload: DepositKeyPayload,
  options?: {
    mxeProgramId?: PublicKey;
    provider?: AnchorProvider;
  }
): Promise<CustodyPreparationResult> {
  const custodyMode = "arcium" satisfies ListingCustodyMode;
  const keyCommitmentHex = await deriveListingKeyCommitmentHex({
    contentKeyBase64: payload.contentKeyBase64,
    ciphertextHashHex: payload.ciphertextHashHex,
    productIdHex: payload.productIdHex,
    sellerWallet: payload.sellerWallet
  });

  if (!options?.provider) {
    throw new Error("Arcium publish requires an Anchor provider to fetch the MXE public key.");
  }

  const mxeProgramId = options.mxeProgramId ?? getProgramId();

  if (!mxeProgramId) {
    throw new Error("Missing NEXT_PUBLIC_PROGRAM_ID.");
  }

  const mxePublicKey = await getMXEPublicKey(options.provider, mxeProgramId);

  if (!mxePublicKey) {
    throw new Error("Unable to fetch the MXE x25519 public key for Arcium publish.");
  }

  const contentKeyBytes = assertFixedBytes("Content key", base64ToBytes(payload.contentKeyBase64), FIXED_ID_BYTES);
  const ivBytes = assertFixedBytes("IV", base64ToBytes(payload.ivBase64), 12);
  const plaintext = packDeliveryMaterial(contentKeyBytes, ivBytes);
  const nonce = randomBytes(16);
  const privateKey = x25519.utils.randomSecretKey();
  const publicKey = x25519.getPublicKey(privateKey);
  const sharedSecret = x25519.getSharedSecret(privateKey, mxePublicKey);
  const cipher = new RescueCipher(sharedSecret);
  const encryptedKeyCiphertexts = cipher.encrypt(plaintext, nonce).map((ciphertext) => Uint8Array.from(ciphertext));

  return {
    custodyMode,
    keyCommitmentHex,
    arciumPublishMaterial: {
      sellerEncryptionPublicKey: Uint8Array.from(publicKey),
      encryptedKeyCiphertexts,
      encryptedKeyNonce: bytesToBigIntLE(nonce)
    }
  };
}
