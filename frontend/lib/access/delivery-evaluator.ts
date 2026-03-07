import { PublicKey } from "@solana/web3.js";
import { createDeliveryCommitmentHex, sealDeliveryMaterial } from "@/lib/crypto/delivery";
import { type SellerDeliveryMaterial } from "@/lib/storage/marketplace";
import { base64ToBytes, bytesToHex, concatBytes, hexToBytes } from "@/lib/utils/bytes";
import { bytesToBase64 } from "@/lib/utils/bytes";

export interface DeliveryEvaluationInput {
  buyerDeliveryPublicKeyBase64: string;
  ciphertextHashHex: string;
  productIdHex: string;
  purchaseNotRevoked: boolean;
  productActive: boolean;
  paymentVerified: boolean;
  sellerWallet: string;
  deliveryNotYetFinalized: boolean;
  sellerDeliveryMaterial: SellerDeliveryMaterial;
}

export interface DeliveryEvaluationResult {
  approvalFlag: number;
  deliveryCommitmentHex: string;
  evaluatorMode: "browser_demo";
  sealedKeyBoxBase64: string;
}

const ZERO_KEY_BASE64 = bytesToBase64(new Uint8Array(32));
const ZERO_IV_BASE64 = bytesToBase64(new Uint8Array(12));

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
  const payloadBuffer = payload.buffer.slice(payload.byteOffset, payload.byteOffset + payload.byteLength) as ArrayBuffer;
  const digest = await crypto.subtle.digest("SHA-256", payloadBuffer);
  return bytesToHex(new Uint8Array(digest));
}

export async function evaluateDeliveryForFinalize(input: DeliveryEvaluationInput): Promise<DeliveryEvaluationResult> {
  if (input.sellerDeliveryMaterial.ciphertextHashHex && input.sellerDeliveryMaterial.ciphertextHashHex !== input.ciphertextHashHex) {
    throw new Error("Seller delivery material does not match the ciphertext hash for this listing.");
  }

  if (input.sellerDeliveryMaterial.keyCommitmentHex) {
    const derivedKeyCommitmentHex = await deriveListingKeyCommitmentHex({
      contentKeyBase64: input.sellerDeliveryMaterial.contentKeyBase64,
      ciphertextHashHex: input.ciphertextHashHex,
      productIdHex: input.productIdHex,
      sellerWallet: input.sellerWallet
    });

    if (derivedKeyCommitmentHex !== input.sellerDeliveryMaterial.keyCommitmentHex) {
      throw new Error("Seller delivery material no longer matches the original listing key commitment.");
    }
  }

  const approved =
    input.paymentVerified &&
    input.productActive &&
    input.purchaseNotRevoked &&
    input.deliveryNotYetFinalized;
  const sealedKeyBoxBase64 = sealDeliveryMaterial({
    buyerPublicKeyBase64: input.buyerDeliveryPublicKeyBase64,
    contentKeyBase64: approved ? input.sellerDeliveryMaterial.contentKeyBase64 : ZERO_KEY_BASE64,
    ivBase64: approved ? input.sellerDeliveryMaterial.ivBase64 : ZERO_IV_BASE64
  });
  const deliveryCommitmentHex = await createDeliveryCommitmentHex(sealedKeyBoxBase64);

  return {
    approvalFlag: approved ? 1 : 0,
    deliveryCommitmentHex,
    evaluatorMode: "browser_demo",
    sealedKeyBoxBase64
  };
}
