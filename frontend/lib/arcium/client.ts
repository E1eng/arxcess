import { AnchorProvider } from "@coral-xyz/anchor";
import { getMXEPublicKey, RescueCipher, x25519 } from "@arcium-hq/client";
import { PublicKey } from "@solana/web3.js";
import { getProgramId } from "@/lib/anchor/client";
import { decryptCiphertext } from "@/lib/crypto/content";
import { createDeliveryCommitmentHex, createDeliveryMaterialDigestHex, decodeDeliveryKeypair, sealDeliveryMaterial, type DeliveryKeypair } from "@/lib/crypto/delivery";
import { type DepositKeyPayload, type FinalizeDeliveryRequest } from "@/lib/arcium/payload";
import { type ListingCustodyMode, type LocalProductListing, type SellerDeliveryMaterial } from "@/lib/storage/marketplace";
import { base64ToBytes, bytesToBase64, bytesToHex, concatBytes, hexToBytes } from "@/lib/utils/bytes";

const textEncoder = new TextEncoder();
const FIXED_ID_BYTES = 32;
const ZERO_KEY_BASE64 = bytesToBase64(new Uint8Array(32));
const ZERO_IV_BASE64 = bytesToBase64(new Uint8Array(12));
const DELIVERY_IV_BYTES = 12;
const PACKED_DELIVERY_CIPHERTEXT_COUNT = 2;
const PACKED_DELIVERY_MATERIAL_TOTAL_BYTES = 44;
const PACKED_DELIVERY_MATERIAL_FIRST_CHUNK_BYTES = 26;
const ARCIUM_FRONTEND_BLOCK_MESSAGE = "Arcium custody needs frontend runtime support that matches the current encrypted circuit shape.";

function hasArciumClusterOffsetConfig() {
  return Boolean(process.env.NEXT_PUBLIC_ARCIUM_CLUSTER_OFFSET?.trim());
}

export interface CustodyPreparationResult {
  custodyMode: ListingCustodyMode;
  keyCommitmentHex?: string;
  arciumPublishMaterial?: {
    encryptedKeyCiphertexts: Uint8Array[];
    encryptedKeyNonce: bigint;
  };
  sellerDeliveryMaterial?: SellerDeliveryMaterial;
  vaultHandleHex?: string;
}

export interface DeliveryFinalizationResult {
  approvalFlag: number;
  custodyMode: ListingCustodyMode;
  deliveryCommitmentHex: string;
  deliveryMaterialDigestHex: string;
  sealedKeyBoxBase64: string;
}

function getEnvCustodyMode(): string | undefined {
  const raw = process.env.NEXT_PUBLIC_ARXCESS_CUSTODY_MODE?.trim().toLowerCase();
  return raw ? raw : undefined;
}

export function getConfiguredCustodyMode(): ListingCustodyMode {
  return getEnvCustodyMode() === "arcium" ? "arcium" : "browser_demo";
}

export function isArciumFrontendRuntimeReady(action?: "publish" | "finalize") {
  if (action === "publish" || action === "finalize") {
    return hasArciumClusterOffsetConfig();
  }

  return false;
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

export function resolveListingCustodyMode(listing: Pick<LocalProductListing, "custodyMode"> | null | undefined): ListingCustodyMode {
  return listing?.custodyMode ?? getConfiguredCustodyMode();
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

  return [
    bytesToBigIntLE(materialBytes.slice(0, PACKED_DELIVERY_MATERIAL_FIRST_CHUNK_BYTES)),
    bytesToBigIntLE(materialBytes.slice(PACKED_DELIVERY_MATERIAL_FIRST_CHUNK_BYTES))
  ];
}

function unpackDeliveryMaterial(chunks: bigint[]) {
  if (chunks.length !== PACKED_DELIVERY_CIPHERTEXT_COUNT) {
    throw new Error(`Packed delivery material must contain ${PACKED_DELIVERY_CIPHERTEXT_COUNT} field elements`);
  }

  const materialBytes = concatBytes(
    bigIntToBytesLE(chunks[0], PACKED_DELIVERY_MATERIAL_FIRST_CHUNK_BYTES),
    bigIntToBytesLE(chunks[1], PACKED_DELIVERY_MATERIAL_TOTAL_BYTES - PACKED_DELIVERY_MATERIAL_FIRST_CHUNK_BYTES)
  );

  return {
    contentKey: materialBytes.slice(0, FIXED_ID_BYTES),
    iv: materialBytes.slice(FIXED_ID_BYTES, FIXED_ID_BYTES + DELIVERY_IV_BYTES)
  };
}

async function sha256Bytes(input: Uint8Array) {
  const digest = await crypto.subtle.digest("SHA-256", toArrayBuffer(input));
  return new Uint8Array(digest);
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

export async function revealArciumDeliveryMaterial(args: {
  keypair: DeliveryKeypair;
  deliveryEncryptionKey: Uint8Array;
  deliveryNonce: bigint;
  deliveryCiphertexts: Uint8Array[];
}) {
  if (args.deliveryCiphertexts.length !== PACKED_DELIVERY_CIPHERTEXT_COUNT) {
    throw new Error(`Arcium delivery payload must contain ${PACKED_DELIVERY_CIPHERTEXT_COUNT} ciphertext field elements`);
  }

  const { secretKey } = decodeDeliveryKeypair(args.keypair);
  const sharedSecret = x25519.getSharedSecret(
    assertFixedBytes("Buyer delivery secret key", secretKey, FIXED_ID_BYTES),
    assertFixedBytes("Arcium delivery encryption key", args.deliveryEncryptionKey, FIXED_ID_BYTES)
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

export async function prepareListingCustody(
  payload: DepositKeyPayload,
  options?: {
    mxeProgramId?: PublicKey;
    provider?: AnchorProvider;
  }
): Promise<CustodyPreparationResult> {
  const custodyMode = getConfiguredCustodyMode();

  if (custodyMode === "arcium") {
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
    const sharedSecret = x25519.getSharedSecret(privateKey, mxePublicKey);
    const cipher = new RescueCipher(sharedSecret);
    const encryptedKeyCiphertexts = cipher.encrypt(plaintext, nonce).map((ciphertext) => Uint8Array.from(ciphertext));

    return {
      custodyMode,
      arciumPublishMaterial: {
        encryptedKeyCiphertexts,
        encryptedKeyNonce: bytesToBigIntLE(nonce)
      }
    };
  }

  const productIdBytes = assertFixedBytes("Product ID", hexToBytes(payload.productIdHex), FIXED_ID_BYTES);
  const ciphertextHashBytes = assertFixedBytes("Ciphertext hash", hexToBytes(payload.ciphertextHashHex), FIXED_ID_BYTES);
  const contentKeyBytes = assertFixedBytes("Content key", base64ToBytes(payload.contentKeyBase64), FIXED_ID_BYTES);
  const metadataCommitment = await sha256Bytes(textEncoder.encode(payload.metadataUri));
  const sellerBytes = new PublicKey(payload.sellerWallet).toBytes();
  const vaultHandleHex = bytesToHex(await sha256Bytes(concatBytes(productIdBytes, sellerBytes, ciphertextHashBytes, metadataCommitment)));
  const keyCommitmentHex = bytesToHex(await sha256Bytes(concatBytes(productIdBytes, sellerBytes, ciphertextHashBytes, contentKeyBytes)));

  return {
    custodyMode,
    keyCommitmentHex,
    sellerDeliveryMaterial: {
      contentKeyBase64: payload.contentKeyBase64,
      ivBase64: payload.ivBase64,
      ciphertextHashHex: payload.ciphertextHashHex,
      keyCommitmentHex
    },
    vaultHandleHex
  };
}

export async function finalizeDeliveryWithCustody(args: FinalizeDeliveryRequest & {
  custodyMode?: ListingCustodyMode;
  sellerDeliveryMaterial?: SellerDeliveryMaterial | null;
}): Promise<DeliveryFinalizationResult> {
  const custodyMode = args.custodyMode ?? getConfiguredCustodyMode();

  if (custodyMode === "arcium") {
    throw new Error(getArciumFrontendBlockMessage("finalize"));
  }

  const sellerDeliveryMaterial = args.sellerDeliveryMaterial;

  if (!sellerDeliveryMaterial) {
    throw new Error("Delivery material is missing in this browser. Publish and finalize from the same environment for browser demo mode.");
  }

  if (sellerDeliveryMaterial.ciphertextHashHex && sellerDeliveryMaterial.ciphertextHashHex !== args.ciphertextHashHex) {
    throw new Error("Seller delivery material does not match the ciphertext hash for this listing.");
  }

  if (sellerDeliveryMaterial.keyCommitmentHex) {
    const derivedKeyCommitmentHex = await deriveListingKeyCommitmentHex({
      contentKeyBase64: sellerDeliveryMaterial.contentKeyBase64,
      ciphertextHashHex: args.ciphertextHashHex,
      productIdHex: args.productIdHex,
      sellerWallet: args.sellerWallet
    });

    if (derivedKeyCommitmentHex !== sellerDeliveryMaterial.keyCommitmentHex) {
      throw new Error("Seller delivery material no longer matches the original listing key commitment.");
    }
  }

  const effectiveIvBase64 = args.metadataIvBase64 || sellerDeliveryMaterial.ivBase64;
  const approved = args.paymentVerified && args.productActive && args.purchaseNotRevoked && args.deliveryNotYetFinalized;

  await decryptCiphertext({
    ciphertext: args.ciphertextBytes,
    contentKey: base64ToBytes(sellerDeliveryMaterial.contentKeyBase64),
    iv: base64ToBytes(effectiveIvBase64)
  });

  const deliveryMaterialDigestHex = await createDeliveryMaterialDigestHex({
    contentKey: base64ToBytes(sellerDeliveryMaterial.contentKeyBase64),
    iv: base64ToBytes(effectiveIvBase64)
  });

  const sealedKeyBoxBase64 = sealDeliveryMaterial({
    buyerPublicKeyBase64: args.buyerDeliveryPublicKeyBase64,
    contentKeyBase64: approved ? sellerDeliveryMaterial.contentKeyBase64 : ZERO_KEY_BASE64,
    ivBase64: approved ? effectiveIvBase64 : ZERO_IV_BASE64
  });
  const deliveryCommitmentHex = await createDeliveryCommitmentHex(sealedKeyBoxBase64);

  return {
    approvalFlag: approved ? 1 : 0,
    custodyMode,
    deliveryCommitmentHex,
    deliveryMaterialDigestHex,
    sealedKeyBoxBase64
  };
}
