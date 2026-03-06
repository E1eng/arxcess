import { createDeliveryCommitmentHex, sealDeliveryMaterial } from "@/lib/crypto/delivery";
import { type SellerDeliveryMaterial } from "@/lib/storage/marketplace";
import { bytesToBase64 } from "@/lib/utils/bytes";

export interface DeliveryEvaluationInput {
  buyerDeliveryPublicKeyBase64: string;
  ciphertextHashHex: string;
  purchaseNotRevoked: boolean;
  productActive: boolean;
  paymentVerified: boolean;
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

export async function evaluateDeliveryForFinalize(input: DeliveryEvaluationInput): Promise<DeliveryEvaluationResult> {
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
