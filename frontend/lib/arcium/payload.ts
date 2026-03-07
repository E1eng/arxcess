export interface DepositKeyPayload {
  productIdHex: string;
  sellerWallet: string;
  metadataUri: string;
  ciphertextHashHex: string;
  contentKeyBase64: string;
  ivBase64: string;
}

export interface EvaluateAndSealRequest {
  productIdHex: string;
  purchaseIdHex: string;
  buyerDeliveryPublicKeyBase64: string;
}

export interface FinalizeDeliveryRequest {
  productIdHex: string;
  purchaseIdHex: string;
  sellerWallet: string;
  buyerDeliveryPublicKeyBase64: string;
  ciphertextHashHex: string;
  ciphertextBytes: Uint8Array;
  metadataIvBase64?: string | null;
  paymentVerified: boolean;
  productActive: boolean;
  purchaseNotRevoked: boolean;
  deliveryNotYetFinalized: boolean;
}
