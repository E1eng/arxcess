import { DeliveryKeypair } from "@/lib/crypto/delivery";

export interface ListingAccessPolicy {
  licenseDurationSeconds: number;
  maxAccessCount: number;
  revocable: boolean;
}

export type ListingCustodyMode = "arcium";

export interface LocalProductListing {
  productIdHex: string;
  title: string;
  description: string;
  category: string;
  priceSol: string;
  metadataCid: string;
  metadataGatewayUrl: string;
  ciphertextCid: string;
  ciphertextGatewayUrl: string;
  ciphertextHashHex: string;
  mimeType: string;
  fileSizeBytes: number;
  sellerWallet: string | null;
  policy: ListingAccessPolicy;
  custodyMode?: "arcium";
  keyCommitmentHex?: string;
  createdAt: string;
  publishSignature?: string;
  activationSignature?: string;
}

export interface LocalPurchaseIntent {
  purchaseIdHex: string;
  productIdHex: string;
  buyerWallet: string | null;
  sellerWallet?: string | null;
  buyerDeliveryPublicKeyBase64: string;
  amountSol: string;
  status: "prepared" | "pending_seal" | "delivered" | "revoked";
  accessCount: number;
  maxAccessCount: number;
  expiresAt?: string | null;
  revokedAt?: string | null;
  createdAt: string;
  transactionSignature?: string;
  finalizeSignature?: string;
  deliveryMode?: "arcium";
}

const PRODUCT_STORAGE_KEY = "arxcess.products";
const PURCHASE_STORAGE_KEY = "arxcess.purchases";
const DELIVERY_KEY_STORAGE_KEY = "arxcess.delivery-keypairs";

function readJson<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") {
    return fallback;
  }
  const raw = window.localStorage.getItem(key);
  if (!raw) {
    return fallback;
  }
  return JSON.parse(raw) as T;
}

function writeJson<T>(key: string, value: T) {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(key, JSON.stringify(value));
}

export function listStoredProducts(): LocalProductListing[] {
  return readJson<LocalProductListing[]>(PRODUCT_STORAGE_KEY, []);
}

export function saveStoredProduct(product: LocalProductListing) {
  const current = listStoredProducts();
  writeJson(PRODUCT_STORAGE_KEY, [product, ...current.filter((entry) => entry.productIdHex !== product.productIdHex)]);
}

export function listStoredPurchases(): LocalPurchaseIntent[] {
  return readJson<LocalPurchaseIntent[]>(PURCHASE_STORAGE_KEY, []);
}

export function getStoredPurchase(purchaseIdHex: string): LocalPurchaseIntent | null {
  return listStoredPurchases().find((entry) => entry.purchaseIdHex === purchaseIdHex) ?? null;
}

export function saveStoredPurchase(purchase: LocalPurchaseIntent) {
  const current = listStoredPurchases();
  writeJson(PURCHASE_STORAGE_KEY, [purchase, ...current.filter((entry) => entry.purchaseIdHex !== purchase.purchaseIdHex)]);
}

export function getStoredDeliveryKeypair(wallet: string | null): DeliveryKeypair | null {
  if (!wallet) {
    return null;
  }

  const keypairs = readJson<Record<string, DeliveryKeypair>>(DELIVERY_KEY_STORAGE_KEY, {});
  return keypairs[wallet] ?? null;
}

export function saveStoredDeliveryKeypair(wallet: string | null, keypair: DeliveryKeypair) {
  if (!wallet) {
    return;
  }

  const keypairs = readJson<Record<string, DeliveryKeypair>>(DELIVERY_KEY_STORAGE_KEY, {});
  writeJson(DELIVERY_KEY_STORAGE_KEY, {
    ...keypairs,
    [wallet]: keypair
  });
}

export function clearStoredMarketplaceState() {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.removeItem(PRODUCT_STORAGE_KEY);
  window.localStorage.removeItem(PURCHASE_STORAGE_KEY);
  window.localStorage.removeItem(DELIVERY_KEY_STORAGE_KEY);
}
