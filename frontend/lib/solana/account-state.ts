import { Connection, PublicKey } from "@solana/web3.js";
import { type LocalProductListing } from "@/lib/storage/marketplace";
import { deriveProductStateAddress, derivePurchaseStateAddress } from "@/lib/solana/arxcess";
import { bytesToBase64 } from "@/lib/utils/bytes";

const ACCOUNT_DISCRIMINATOR_BYTES = 8;
const PUBKEY_BYTES = 32;
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

function dataViewFromBytes(bytes: Uint8Array) {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
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
  expiresAt: number;
  accessCount: number;
  maxAccessCount: number;
  revokedAt: number;
  createdAt: number;
  deliveredAt: number;
  arciumDeliveryReady: boolean;
  arciumEvaluateComputationOffset: number;
  arciumEvaluateRequestedAt: number;
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
  const arciumCustodyReady = readU8(view, offset) === 1;
  offset += 1;
  const arciumDepositComputationOffset = readU64(view, offset);
  offset += 8;
  const arciumDepositRequestedAt = readI64(view, offset);

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
  offset += 256 + 100 + 32;
  const expiresAt = readI64(view, offset);
  offset += 8;
  const accessCount = readU32(view, offset);
  offset += 4;
  const maxAccessCount = readU32(view, offset);
  offset += 4;
  const revokedAt = readI64(view, offset);
  offset += 8;
  const createdAt = readI64(view, offset);
  offset += 8;
  const deliveredAt = readI64(view, offset);
  offset += 8;
  const arciumDeliveryReady = readU8(view, offset) === 1;
  offset += 1;
  const arciumEvaluateComputationOffset = readU64(view, offset);
  offset += 8;
  const arciumEvaluateRequestedAt = readI64(view, offset);

  return {
    status,
    statusLabel: PURCHASE_STATUS_LABELS[status] ?? "prepared",
    entitlementFlag,
    sealedKeyLen,
    sealedKeyBoxBase64: sealedKeyLen > 0 ? bytesToBase64(sealedKeyBox.slice(0, sealedKeyLen)) : null,
    expiresAt,
    accessCount,
    maxAccessCount,
    revokedAt,
    createdAt,
    deliveredAt,
    arciumDeliveryReady,
    arciumEvaluateComputationOffset,
    arciumEvaluateRequestedAt
  };
}

export async function fetchOnchainPurchaseStates(
  connection: Connection,
  purchases: Array<{ purchaseIdHex: string; listing: LocalProductListing }>
) {
  const addresses = purchases.map(({ purchaseIdHex, listing }) => {
    const seller = new PublicKey(listing.sellerWallet!);
    const productState = deriveProductStateAddress(seller, listing.productIdHex);
    return {
      purchaseIdHex,
      productState,
      purchaseState: derivePurchaseStateAddress(productState, purchaseIdHex)
    };
  });

  const accounts = await connection.getMultipleAccountsInfo(addresses.map((entry) => entry.purchaseState));
  const output: Record<string, DecodedPurchaseState> = {};

  addresses.forEach((entry, index) => {
    const account = accounts[index];
    if (!account) {
      return;
    }
    output[entry.purchaseIdHex] = decodePurchaseState(account.data);
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
