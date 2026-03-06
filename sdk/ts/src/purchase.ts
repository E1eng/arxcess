export type PurchaseStatus = "initialized" | "paid" | "pending_seal" | "delivered" | "refunded" | "revoked";

export interface PurchaseDraft {
  purchaseIdHex: string;
  productIdHex: string;
  buyerDeliveryPublicKeyBase64: string;
  amountLamports: bigint;
  protocolFeeLamports: bigint;
  sellerProceedsLamports: bigint;
  status: PurchaseStatus;
}
