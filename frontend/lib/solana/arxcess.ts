import { PROTOCOL_FEE_BPS } from "@arxcess/sdk";
import { Buffer } from "buffer";
import { PublicKey, SystemProgram, Transaction, TransactionInstruction } from "@solana/web3.js";
import { getProgramId, getTreasuryPublicKey } from "@/lib/anchor/client";
import { type LocalProductListing } from "@/lib/storage/marketplace";
import { base64ToBytes, bytesToHex, concatBytes, hexToBytes } from "@/lib/utils/bytes";

const textEncoder = new TextEncoder();
const DELIVERY_PUBKEY_BYTES = 32;
const FIXED_ID_BYTES = 32;

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function requireProgramId() {
  const programId = getProgramId();

  if (!programId) {
    throw new Error("Missing NEXT_PUBLIC_PROGRAM_ID");
  }

  return programId;
}

function requireTreasuryPublicKey() {
  const treasury = getTreasuryPublicKey();

  if (!treasury) {
    throw new Error("Missing NEXT_PUBLIC_TREASURY_WALLET");
  }

  return treasury;
}

function assertFixedBytes(label: string, bytes: Uint8Array, expectedLength: number) {
  if (bytes.length !== expectedLength) {
    throw new Error(`${label} must be ${expectedLength} bytes`);
  }

  return bytes;
}

function encodeU16(value: number) {
  const output = new Uint8Array(2);
  new DataView(output.buffer).setUint16(0, value, true);
  return output;
}

function encodeU32(value: number) {
  const output = new Uint8Array(4);
  new DataView(output.buffer).setUint32(0, value, true);
  return output;
}

function encodeU64(value: bigint) {
  const output = new Uint8Array(8);
  let remainder = value;

  for (let index = 0; index < output.length; index += 1) {
    output[index] = Number(remainder & 0xffn);
    remainder >>= 8n;
  }

  return output;
}

function encodeString(value: string) {
  const bytes = textEncoder.encode(value);
  return concatBytes(encodeU32(bytes.length), bytes);
}

async function sha256Bytes(input: Uint8Array) {
  const digest = await crypto.subtle.digest("SHA-256", toArrayBuffer(input));
  return new Uint8Array(digest);
}

async function getInstructionDiscriminator(name: string) {
  return (await sha256Bytes(textEncoder.encode(`global:${name}`))).slice(0, 8);
}

export function deriveProductStateAddress(seller: PublicKey, productIdHex: string) {
  const programId = requireProgramId();
  const productIdBytes = assertFixedBytes("Product ID", hexToBytes(productIdHex), FIXED_ID_BYTES);

  return PublicKey.findProgramAddressSync([textEncoder.encode("product"), seller.toBytes(), productIdBytes], programId)[0];
}

export function derivePurchaseStateAddress(productState: PublicKey, purchaseIdHex: string) {
  const programId = requireProgramId();
  const purchaseIdBytes = assertFixedBytes("Purchase ID", hexToBytes(purchaseIdHex), FIXED_ID_BYTES);

  return PublicKey.findProgramAddressSync([textEncoder.encode("purchase"), productState.toBytes(), purchaseIdBytes], programId)[0];
}

export async function buildCreateListingTransaction(args: {
  seller: PublicKey;
  productIdHex: string;
  metadataUri: string;
  ciphertextCid: string;
  ciphertextHashHex: string;
  priceLamports: bigint;
  fileSizeBytes: bigint;
  contentKeyBase64: string;
  licenseDurationSeconds: number;
  maxAccessCount: number;
  revocable: boolean;
}) {
  const programId = requireProgramId();
  const treasury = requireTreasuryPublicKey();
  const productIdBytes = assertFixedBytes("Product ID", hexToBytes(args.productIdHex), FIXED_ID_BYTES);
  const ciphertextHashBytes = assertFixedBytes("Ciphertext hash", hexToBytes(args.ciphertextHashHex), FIXED_ID_BYTES);
  const contentKeyBytes = assertFixedBytes("Content key", base64ToBytes(args.contentKeyBase64), FIXED_ID_BYTES);
  const metadataCommitment = await sha256Bytes(textEncoder.encode(args.metadataUri));
  const vaultHandle = await sha256Bytes(concatBytes(productIdBytes, args.seller.toBytes(), ciphertextHashBytes, metadataCommitment));
  const keyCommitment = await sha256Bytes(concatBytes(productIdBytes, args.seller.toBytes(), ciphertextHashBytes, contentKeyBytes));
  const productState = deriveProductStateAddress(args.seller, args.productIdHex);
  const createProductData = concatBytes(
    await getInstructionDiscriminator("create_product"),
    productIdBytes,
    encodeString(args.metadataUri),
    encodeString(args.ciphertextCid),
    ciphertextHashBytes,
    encodeU64(args.priceLamports),
    encodeU16(PROTOCOL_FEE_BPS),
    encodeU64(args.fileSizeBytes),
    encodeU64(BigInt(args.licenseDurationSeconds)),
    encodeU32(args.maxAccessCount),
    new Uint8Array([args.revocable ? 1 : 0])
  );
  const depositProductKeyData = concatBytes(await getInstructionDiscriminator("deposit_product_key"), vaultHandle, keyCommitment);
  const activateProductData = await getInstructionDiscriminator("activate_product");
  const transaction = new Transaction().add(
    new TransactionInstruction({
      programId,
      keys: [
        { pubkey: args.seller, isSigner: true, isWritable: true },
        { pubkey: treasury, isSigner: false, isWritable: false },
        { pubkey: productState, isSigner: false, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }
      ],
      data: Buffer.from(createProductData)
    }),
    new TransactionInstruction({
      programId,
      keys: [
        { pubkey: args.seller, isSigner: true, isWritable: false },
        { pubkey: productState, isSigner: false, isWritable: true }
      ],
      data: Buffer.from(depositProductKeyData)
    }),
    new TransactionInstruction({
      programId,
      keys: [
        { pubkey: args.seller, isSigner: true, isWritable: false },
        { pubkey: productState, isSigner: false, isWritable: true }
      ],
      data: Buffer.from(activateProductData)
    })
  );

  transaction.feePayer = args.seller;

  return {
    transaction,
    productState,
    vaultHandleHex: bytesToHex(vaultHandle),
    keyCommitmentHex: bytesToHex(keyCommitment)
  };
}

export async function buildPurchaseTransaction(args: {
  buyer: PublicKey;
  listing: LocalProductListing;
  purchaseIdHex: string;
  buyerDeliveryPublicKeyBase64: string;
}) {
  if (!args.listing.sellerWallet) {
    throw new Error("Listing is missing seller wallet information");
  }

  const programId = requireProgramId();
  const treasury = requireTreasuryPublicKey();
  const seller = new PublicKey(args.listing.sellerWallet);
  const productState = deriveProductStateAddress(seller, args.listing.productIdHex);
  const purchaseState = derivePurchaseStateAddress(productState, args.purchaseIdHex);
  const purchaseIdBytes = assertFixedBytes("Purchase ID", hexToBytes(args.purchaseIdHex), FIXED_ID_BYTES);
  const buyerDeliveryPublicKey = assertFixedBytes(
    "Buyer delivery public key",
    base64ToBytes(args.buyerDeliveryPublicKeyBase64),
    DELIVERY_PUBKEY_BYTES
  );
  const purchaseProductData = concatBytes(await getInstructionDiscriminator("purchase_product"), purchaseIdBytes, buyerDeliveryPublicKey);
  const transaction = new Transaction().add(
    new TransactionInstruction({
      programId,
      keys: [
        { pubkey: args.buyer, isSigner: true, isWritable: true },
        { pubkey: seller, isSigner: false, isWritable: true },
        { pubkey: treasury, isSigner: false, isWritable: true },
        { pubkey: productState, isSigner: false, isWritable: true },
        { pubkey: purchaseState, isSigner: false, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }
      ],
      data: Buffer.from(purchaseProductData)
    })
  );

  transaction.feePayer = args.buyer;

  return {
    transaction,
    productState,
    purchaseState
  };
}

export async function buildConsumeAccessTransaction(args: {
  buyer: PublicKey;
  listing: LocalProductListing;
  purchaseIdHex: string;
}) {
  if (!args.listing.sellerWallet) {
    throw new Error("Listing is missing seller wallet information");
  }

  const programId = requireProgramId();
  const seller = new PublicKey(args.listing.sellerWallet);
  const productState = deriveProductStateAddress(seller, args.listing.productIdHex);
  const purchaseState = derivePurchaseStateAddress(productState, args.purchaseIdHex);
  const consumeAccessData = await getInstructionDiscriminator("consume_access");
  const transaction = new Transaction().add(
    new TransactionInstruction({
      programId,
      keys: [
        { pubkey: args.buyer, isSigner: true, isWritable: false },
        { pubkey: productState, isSigner: false, isWritable: false },
        { pubkey: purchaseState, isSigner: false, isWritable: true }
      ],
      data: Buffer.from(consumeAccessData)
    })
  );

  transaction.feePayer = args.buyer;

  return {
    transaction,
    productState,
    purchaseState
  };
}

export async function buildRevokePurchaseTransaction(args: {
  authority: PublicKey;
  listing: LocalProductListing;
  purchaseIdHex: string;
}) {
  if (!args.listing.sellerWallet) {
    throw new Error("Listing is missing seller wallet information");
  }

  const programId = requireProgramId();
  const seller = new PublicKey(args.listing.sellerWallet);
  const productState = deriveProductStateAddress(seller, args.listing.productIdHex);
  const purchaseState = derivePurchaseStateAddress(productState, args.purchaseIdHex);
  const revokePurchaseData = await getInstructionDiscriminator("revoke_purchase");
  const transaction = new Transaction().add(
    new TransactionInstruction({
      programId,
      keys: [
        { pubkey: args.authority, isSigner: true, isWritable: false },
        { pubkey: productState, isSigner: false, isWritable: false },
        { pubkey: purchaseState, isSigner: false, isWritable: true }
      ],
      data: Buffer.from(revokePurchaseData)
    })
  );

  transaction.feePayer = args.authority;

  return {
    transaction,
    productState,
    purchaseState
  };
}

export async function buildFinalizeDeliveryTransaction(args: {
  authority: PublicKey;
  listing: LocalProductListing;
  purchaseIdHex: string;
  approvalFlag: number;
  sealedKeyBoxBase64: string;
  deliveryCommitmentHex: string;
}) {
  if (!args.listing.sellerWallet) {
    throw new Error("Listing is missing seller wallet information");
  }

  const programId = requireProgramId();
  const seller = new PublicKey(args.listing.sellerWallet);
  const productState = deriveProductStateAddress(seller, args.listing.productIdHex);
  const purchaseState = derivePurchaseStateAddress(productState, args.purchaseIdHex);
  const sealedKeyBox = base64ToBytes(args.sealedKeyBoxBase64);
  const deliveryCommitment = assertFixedBytes("Delivery commitment", hexToBytes(args.deliveryCommitmentHex), FIXED_ID_BYTES);
  const finalizeDeliveryData = concatBytes(
    await getInstructionDiscriminator("finalize_delivery"),
    new Uint8Array([args.approvalFlag]),
    encodeU32(sealedKeyBox.length),
    sealedKeyBox,
    deliveryCommitment
  );
  const transaction = new Transaction().add(
    new TransactionInstruction({
      programId,
      keys: [
        { pubkey: args.authority, isSigner: true, isWritable: false },
        { pubkey: productState, isSigner: false, isWritable: false },
        { pubkey: purchaseState, isSigner: false, isWritable: true }
      ],
      data: Buffer.from(finalizeDeliveryData)
    })
  );

  transaction.feePayer = args.authority;

  return {
    transaction,
    productState,
    purchaseState
  };
}
