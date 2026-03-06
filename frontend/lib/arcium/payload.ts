export interface DepositKeyPayload {
  productIdHex: string;
  ciphertextHashHex: string;
  contentKeyBase64: string;
  ivBase64: string;
}

export interface EvaluateAndSealRequest {
  productIdHex: string;
  purchaseIdHex: string;
  buyerDeliveryPublicKeyBase64: string;
}
