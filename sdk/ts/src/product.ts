export type ProductStatus = "draft" | "active" | "paused" | "delisted";

export interface ProductMetadata {
  name: string;
  description: string;
  category: string;
  previewCid?: string;
  ciphertextCid: string;
  ivBase64?: string;
  mimeHint: string;
  sizeBytes: number;
  version: number;
}

export interface EncryptedAssetPayload {
  ciphertext: Uint8Array;
  ciphertextHashHex: string;
  contentKeyBase64: string;
  ivBase64: string;
  mimeType: string;
  sizeBytes: number;
}

export interface CreateProductDraft {
  productIdHex: string;
  title: string;
  description: string;
  priceSol: string;
  metadataCid: string;
  ciphertextCid: string;
  ciphertextHashHex: string;
  keyCommitmentHex: string;
  ivBase64: string;
  contentKeyBase64: string;
}
