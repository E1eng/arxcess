import { DeliveryKeypair } from "@/lib/crypto/delivery";

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
  createdAt: string;
}

export interface LocalPurchaseIntent {
  purchaseIdHex: string;
  productIdHex: string;
  buyerWallet: string | null;
  buyerDeliveryPublicKeyBase64: string;
  amountSol: string;
  status: "prepared" | "pending_seal";
  createdAt: string;
}

const PRODUCT_STORAGE_KEY = "arxcess.products";
const PURCHASE_STORAGE_KEY = "arxcess.purchases";
const DELIVERY_KEY_STORAGE_KEY = "arxcess.delivery-keypair";

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

export function saveStoredPurchase(purchase: LocalPurchaseIntent) {
  const current = listStoredPurchases();
  writeJson(PURCHASE_STORAGE_KEY, [purchase, ...current.filter((entry) => entry.purchaseIdHex !== purchase.purchaseIdHex)]);
}

export function getStoredDeliveryKeypair(): DeliveryKeypair | null {
  return readJson<DeliveryKeypair | null>(DELIVERY_KEY_STORAGE_KEY, null);
}

export function saveStoredDeliveryKeypair(keypair: DeliveryKeypair) {
  writeJson(DELIVERY_KEY_STORAGE_KEY, keypair);
}
