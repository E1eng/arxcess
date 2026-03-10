import { Connection, PublicKey } from "@solana/web3.js";
import { type LocalProductListing } from "@/lib/storage/marketplace";
import { deriveProductStateAddress, derivePurchaseStateAddress } from "@/lib/solana/arxcess";
import { bytesToBase64, bytesToHex } from "@/lib/utils/bytes";

const ACCOUNT_DISCRIMINATOR_BYTES = 8;
const PUBKEY_BYTES = 32;
const ARCIUM_DELIVERY_CIPHERTEXT_COUNT = 2;
const PRODUCT_STATUS_LABELS: Record<number, string> = {
  0: "draft",
  1: "active",
  2: "paused",
  3: "delisted"
};
const PURCHASE_STATUS_LABELS: Record<number, "prepared" | "pending_seal" | "delivered" | "revoked"> = {
  0: "prepared",
  1: "prepared",
  2: "pending_seal",
  3: "delivered",
  4: "prepared",
  5: "revoked"
};

function readU8(view: DataView, offset: number) {
  return view.getUint8(offset);
}

function readU16(view: DataView, offset: number) {
  return view.getUint16(offset, true);
}

function readU32(view: DataView, offset: number) {
  return view.getUint32(offset, true);
}

function readI64(view: DataView, offset: number) {
  return Number(view.getBigInt64(offset, true));
}

function readU64(view: DataView, offset: number) {
  return Number(view.getBigUint64(offset, true));
}

function readU128(view: DataView, offset: number) {
  const low = view.getBigUint64(offset, true);
  const high = view.getBigUint64(offset + 8, true);
  return low | (high << 64n);
}

function dataViewFromBytes(bytes: Uint8Array) {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function hasReadableRange(bytes: Uint8Array, offset: number, length: number) {
  return offset + length <= bytes.length;
}

export interface DecodedProductState {
  status: number;
  statusLabel: string;
  licenseDurationSeconds: number;
  maxAccessCount: number;
  revocable: boolean;
  totalSales: number;
  arciumCustodyReady: boolean;
  arciumDepositComputationOffset: number;
  arciumDepositRequestedAt: number;
}

export interface DecodedPurchaseState {
  status: number;
  statusLabel: "prepared" | "pending_seal" | "delivered" | "revoked";
  entitlementFlag: number;
  sealedKeyLen: number;
  sealedKeyBoxBase64: string | null;
  deliveryCommitmentHex: string;
  expiresAt: number;
  accessCount: number;
  maxAccessCount: number;
  revokedAt: number;
  createdAt: number;
  deliveredAt: number;
  arciumDeliveryReady: boolean;
  arciumEvaluateComputationOffset: number;
  arciumEvaluateRequestedAt: number;
  arciumDeliveryEncryptionKey: Uint8Array;
  arciumDeliveryNonce: bigint;
  arciumDeliveryCiphertexts: Uint8Array[];
}

export function decodeProductState(data: Uint8Array): DecodedProductState {
  const view = dataViewFromBytes(data);
  let offset = ACCOUNT_DISCRIMINATOR_BYTES;
  offset += 1 + 32 + PUBKEY_BYTES + PUBKEY_BYTES + 8 + 2;
  const status = readU8(view, offset);
  offset += 1 + 200 + 100 + 32 + 8 + 32 + 32;
  const licenseDurationSeconds = readI64(view, offset);
  offset += 8;
  const maxAccessCount = readU32(view, offset);
  offset += 4;
  const revocable = readU8(view, offset) === 1;
  offset += 1;
  const totalSales = readU64(view, offset);
  offset += 8 + 8 + 8;
  const arciumCustodyReady = hasReadableRange(data, offset, 1) ? readU8(view, offset) === 1 : false;
  offset += hasReadableRange(data, offset, 1) ? 1 : 0;
  const arciumDepositComputationOffset = hasReadableRange(data, offset, 8) ? readU64(view, offset) : 0;
  offset += hasReadableRange(data, offset, 8) ? 8 : 0;
  const arciumDepositRequestedAt = hasReadableRange(data, offset, 8) ? readI64(view, offset) : 0;

  return {
    status,
    statusLabel: PRODUCT_STATUS_LABELS[status] ?? `unknown-${status}`,
    licenseDurationSeconds,
    maxAccessCount,
    revocable,
    totalSales,
    arciumCustodyReady,
    arciumDepositComputationOffset,
    arciumDepositRequestedAt
  };
}

export function decodePurchaseState(data: Uint8Array): DecodedPurchaseState {
  const view = dataViewFromBytes(data);
  let offset = ACCOUNT_DISCRIMINATOR_BYTES;
  offset += 1 + 32 + PUBKEY_BYTES + PUBKEY_BYTES + 32 + 8 + 8 + 8;
  const status = readU8(view, offset);
  offset += 1;
  const entitlementFlag = readU8(view, offset);
  offset += 1;
  const sealedKeyLen = readU16(view, offset);
  offset += 2;
  const sealedKeyBox = data.slice(offset, offset + 256);
  offset += 256;
  offset += 100;
  const deliveryCommitment = data.slice(offset, offset + 32);
  offset += 32;
  const expiresAt = readI64(view, offset);
  offset += 8;
  const accessCount = readU32(view, offset);
  offset += 4;
  const maxAccessCount = hasReadableRange(data, offset, 4) ? readU32(view, offset) : 0;
  offset += hasReadableRange(data, offset, 4) ? 4 : 0;
  const revokedAt = hasReadableRange(data, offset, 8) ? readI64(view, offset) : 0;
  offset += hasReadableRange(data, offset, 8) ? 8 : 0;
  const createdAt = hasReadableRange(data, offset, 8) ? readI64(view, offset) : 0;
  offset += hasReadableRange(data, offset, 8) ? 8 : 0;
  const deliveredAt = hasReadableRange(data, offset, 8) ? readI64(view, offset) : 0;
  offset += hasReadableRange(data, offset, 8) ? 8 : 0;
  const arciumDeliveryReady = hasReadableRange(data, offset, 1) ? readU8(view, offset) === 1 : false;
  offset += hasReadableRange(data, offset, 1) ? 1 : 0;
  const arciumEvaluateComputationOffset = hasReadableRange(data, offset, 8) ? readU64(view, offset) : 0;
  offset += hasReadableRange(data, offset, 8) ? 8 : 0;
  const arciumEvaluateRequestedAt = hasReadableRange(data, offset, 8) ? readI64(view, offset) : 0;
  offset += hasReadableRange(data, offset, 8) ? 8 : 0;
  const arciumDeliveryEncryptionKey = hasReadableRange(data, offset, 32) ? data.slice(offset, offset + 32) : new Uint8Array(32);
  offset += hasReadableRange(data, offset, 32) ? 32 : 0;
  const arciumDeliveryNonce = hasReadableRange(data, offset, 16) ? readU128(view, offset) : 0n;
  offset += hasReadableRange(data, offset, 16) ? 16 : 0;
  const arciumDeliveryCiphertexts = Array.from({ length: ARCIUM_DELIVERY_CIPHERTEXT_COUNT }, (_, index) => {
    const start = offset + (index * 32);
    return hasReadableRange(data, start, 32) ? data.slice(start, start + 32) : new Uint8Array(32);
  });

  return {
    status,
    statusLabel: PURCHASE_STATUS_LABELS[status] ?? "prepared",
    entitlementFlag,
    sealedKeyLen,
    sealedKeyBoxBase64: sealedKeyLen > 0 ? bytesToBase64(sealedKeyBox.slice(0, sealedKeyLen)) : null,
    deliveryCommitmentHex: bytesToHex(deliveryCommitment),
    expiresAt,
    accessCount,
    maxAccessCount,
    revokedAt,
    createdAt,
    deliveredAt,
    arciumDeliveryReady,
    arciumEvaluateComputationOffset,
    arciumEvaluateRequestedAt,
    arciumDeliveryEncryptionKey,
    arciumDeliveryNonce,
    arciumDeliveryCiphertexts
  };
}

export async function fetchOnchainPurchaseStates(
  connection: Connection,
  purchases: Array<{ purchaseIdHex: string; listing: LocalProductListing }>
) {
  const addresses = purchases.flatMap(({ purchaseIdHex, listing }) => {
    if (!listing.sellerWallet) {
      return [];
    }

    try {
      const seller = new PublicKey(listing.sellerWallet);
      const productState = deriveProductStateAddress(seller, listing.productIdHex);
      return [{
        purchaseIdHex,
        productState,
        purchaseState: derivePurchaseStateAddress(productState, purchaseIdHex)
      }];
    } catch {
      return [];
    }
  });

  const accounts = await connection.getMultipleAccountsInfo(addresses.map((entry) => entry.purchaseState));
  const output: Record<string, DecodedPurchaseState> = {};

  addresses.forEach((entry, index) => {
    const account = accounts[index];
    if (!account) {
      return;
    }

    try {
      output[entry.purchaseIdHex] = decodePurchaseState(account.data);
    } catch {}
  });

  return output;
}

export async function fetchOnchainProductStates(connection: Connection, listings: LocalProductListing[]) {
  const resolvable = listings.filter((listing) => Boolean(listing.sellerWallet));
  const addresses = resolvable.map((listing) => {
    const seller = new PublicKey(listing.sellerWallet!);
    return {
      productIdHex: listing.productIdHex,
      productState: deriveProductStateAddress(seller, listing.productIdHex)
    };
  });
  const accounts = await connection.getMultipleAccountsInfo(addresses.map((entry) => entry.productState));
  const output: Record<string, DecodedProductState> = {};

  addresses.forEach((entry, index) => {
    const account = accounts[index];
    if (!account) {
      return;
    }
    output[entry.productIdHex] = decodeProductState(account.data);
  });

  return output;
}
