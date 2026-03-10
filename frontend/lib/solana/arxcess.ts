import { PROTOCOL_FEE_BPS } from "@arxcess/sdk";
import { BN } from "@coral-xyz/anchor";
import { Buffer } from "buffer";
import { PublicKey, SystemProgram, Transaction, TransactionInstruction } from "@solana/web3.js";
import { getProgramId, getTreasuryPublicKey } from "@/lib/anchor/client";
import { type LocalProductListing } from "@/lib/storage/marketplace";
import { base64ToBytes, bytesToHex, concatBytes, hexToBytes } from "@/lib/utils/bytes";

const textEncoder = new TextEncoder();
const DELIVERY_PUBKEY_BYTES = 32;
const FIXED_ID_BYTES = 32;
const ARCIUM_PROGRAM_ID = new PublicKey("Arcj82pX7HxYKLR92qvgZUAd7vGS1k4hQvAFcPATFdEQ");
const ARCIUM_FEE_POOL_ACCOUNT = new PublicKey("G2sRWJvi3xoyh5k2gY49eG9L8YhAEWQPtNb1zb1GXTtC");
const ARCIUM_CLOCK_ACCOUNT = new PublicKey("7EbMUTLo5DjdzbN7s8BXeZwXzEwNQb1hScfRvWg8a6ot");
const DEPOSIT_KEY_COMP_DEF_OFFSET = 192477128;
const EVALUATE_AND_SEAL_COMP_DEF_OFFSET = 424405835;
const OFFSET_BUFFER_SIZE = 4;
const CLUSTER_ACC_SEED = "Cluster";
const COMP_DEF_ACC_SEED = "ComputationDefinitionAccount";
const COMPUTATION_ACC_SEED = "ComputationAccount";
const EXEC_POOL_ACC_SEED = "Execpool";
const MEMPOOL_ACC_SEED = "Mempool";
const MXE_ACCOUNT_SEED = "MXEAccount";

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

function requireArciumClusterOffset() {
  const raw = process.env.NEXT_PUBLIC_ARCIUM_CLUSTER_OFFSET?.trim();

  if (!raw) {
    throw new Error("Missing NEXT_PUBLIC_ARCIUM_CLUSTER_OFFSET");
  }

  const value = Number(raw);

  if (!Number.isInteger(value) || value < 0) {
    throw new Error("NEXT_PUBLIC_ARCIUM_CLUSTER_OFFSET must be a non-negative integer");
  }

  return value;
}

function encodeU32Buffer(value: number) {
  const buffer = Buffer.alloc(OFFSET_BUFFER_SIZE);
  buffer.writeUInt32LE(value, 0);
  return buffer;
}

function encodeU64Buffer(value: bigint) {
  const buffer = Buffer.alloc(8);
  let remainder = value;

  for (let index = 0; index < buffer.length; index += 1) {
    buffer[index] = Number(remainder & 0xffn);
    remainder >>= 8n;
  }

  return buffer;
}

function deriveArciumPda(seeds: Buffer[]) {
  return PublicKey.findProgramAddressSync(seeds, ARCIUM_PROGRAM_ID)[0];
}

function getClusterAccAddress(clusterOffset: number) {
  return deriveArciumPda([Buffer.from(CLUSTER_ACC_SEED), encodeU32Buffer(clusterOffset)]);
}

function getCompDefAccAddress(mxeProgramId: PublicKey, compDefOffset: number) {
  return deriveArciumPda([Buffer.from(COMP_DEF_ACC_SEED), mxeProgramId.toBuffer(), encodeU32Buffer(compDefOffset)]);
}

function getComputationAccAddress(clusterOffset: number, computationOffset: BN) {
  return deriveArciumPda([
    Buffer.from(COMPUTATION_ACC_SEED),
    encodeU32Buffer(clusterOffset),
    encodeU64Buffer(BigInt(computationOffset.toString()))
  ]);
}

function getExecutingPoolAccAddress(clusterOffset: number) {
  return deriveArciumPda([Buffer.from(EXEC_POOL_ACC_SEED), encodeU32Buffer(clusterOffset)]);
}

function getMXEAccAddress(mxeProgramId: PublicKey) {
  return deriveArciumPda([Buffer.from(MXE_ACCOUNT_SEED), mxeProgramId.toBuffer()]);
}

function getMempoolAccAddress(clusterOffset: number) {
  return deriveArciumPda([Buffer.from(MEMPOOL_ACC_SEED), encodeU32Buffer(clusterOffset)]);
}

function deriveArciumSignPda() {
  return PublicKey.findProgramAddressSync([Buffer.from("ArciumSignerAccount")], requireProgramId())[0];
}

function deriveArciumAccounts(computationOffset: bigint, compDefOffset: number) {
  const programId = requireProgramId();
  const clusterOffset = requireArciumClusterOffset();
  const mxeAccount = getMXEAccAddress(programId);

  return {
    arciumProgram: ARCIUM_PROGRAM_ID,
    clockAccount: ARCIUM_CLOCK_ACCOUNT,
    clusterAccount: getClusterAccAddress(clusterOffset),
    compDefAccount: getCompDefAccAddress(programId, compDefOffset),
    computationAccount: getComputationAccAddress(clusterOffset, new BN(computationOffset.toString())),
    executingPool: getExecutingPoolAccAddress(clusterOffset),
    mempoolAccount: getMempoolAccAddress(clusterOffset),
    mxeAccount,
    poolAccount: ARCIUM_FEE_POOL_ACCOUNT,
    signPdaAccount: deriveArciumSignPda()
  };
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

function encodeU128(value: bigint) {
  const output = new Uint8Array(16);
  let remainder = value;

  for (let index = 0; index < output.length; index += 1) {
    output[index] = Number(remainder & 0xffn);
    remainder >>= 8n;
  }

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
  vaultHandleHex: string;
  keyCommitmentHex: string;
  licenseDurationSeconds: number;
  maxAccessCount: number;
  revocable: boolean;
}) {
  const programId = requireProgramId();
  const treasury = requireTreasuryPublicKey();
  const productIdBytes = assertFixedBytes("Product ID", hexToBytes(args.productIdHex), FIXED_ID_BYTES);
  const ciphertextHashBytes = assertFixedBytes("Ciphertext hash", hexToBytes(args.ciphertextHashHex), FIXED_ID_BYTES);
  const vaultHandle = assertFixedBytes("Vault handle", hexToBytes(args.vaultHandleHex), FIXED_ID_BYTES);
  const keyCommitment = assertFixedBytes("Key commitment", hexToBytes(args.keyCommitmentHex), FIXED_ID_BYTES);
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
    vaultHandleHex: args.vaultHandleHex,
    keyCommitmentHex: args.keyCommitmentHex
  };
}

export async function buildCreateProductTransaction(args: {
  seller: PublicKey;
  productIdHex: string;
  metadataUri: string;
  ciphertextCid: string;
  ciphertextHashHex: string;
  priceLamports: bigint;
  fileSizeBytes: bigint;
  licenseDurationSeconds: number;
  maxAccessCount: number;
  revocable: boolean;
}) {
  const programId = requireProgramId();
  const treasury = requireTreasuryPublicKey();
  const productIdBytes = assertFixedBytes("Product ID", hexToBytes(args.productIdHex), FIXED_ID_BYTES);
  const ciphertextHashBytes = assertFixedBytes("Ciphertext hash", hexToBytes(args.ciphertextHashHex), FIXED_ID_BYTES);
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
    })
  );

  transaction.feePayer = args.seller;

  return {
    productState,
    transaction
  };
}

export async function buildRequestDepositProductKeyTransaction(args: {
  seller: PublicKey;
  productIdHex: string;
  computationOffset: bigint;
}) {
  const programId = requireProgramId();
  const productState = deriveProductStateAddress(args.seller, args.productIdHex);
  const arcium = deriveArciumAccounts(args.computationOffset, DEPOSIT_KEY_COMP_DEF_OFFSET);
  const requestData = concatBytes(await getInstructionDiscriminator("request_deposit_product_key"), encodeU64(args.computationOffset));
  const transaction = new Transaction().add(
    new TransactionInstruction({
      programId,
      keys: [
        { pubkey: args.seller, isSigner: true, isWritable: true },
        { pubkey: productState, isSigner: false, isWritable: true },
        { pubkey: arcium.mxeAccount, isSigner: false, isWritable: false },
        { pubkey: arcium.signPdaAccount, isSigner: false, isWritable: false },
        { pubkey: arcium.mempoolAccount, isSigner: false, isWritable: true },
        { pubkey: arcium.executingPool, isSigner: false, isWritable: true },
        { pubkey: arcium.computationAccount, isSigner: false, isWritable: true },
        { pubkey: arcium.compDefAccount, isSigner: false, isWritable: false },
        { pubkey: arcium.clusterAccount, isSigner: false, isWritable: true },
        { pubkey: arcium.poolAccount, isSigner: false, isWritable: true },
        { pubkey: arcium.clockAccount, isSigner: false, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        { pubkey: arcium.arciumProgram, isSigner: false, isWritable: false }
      ],
      data: Buffer.from(requestData)
    })
  );

  transaction.feePayer = args.seller;

  return {
    arcium,
    productState,
    transaction
  };
}

export async function buildStageProductArciumMaterialTransaction(args: {
  seller: PublicKey;
  productIdHex: string;
  encryptedKeyNonce: bigint;
  encryptedKeyCiphertexts: Uint8Array[];
}) {
  if (args.encryptedKeyCiphertexts.length !== 2) {
    throw new Error("Encrypted key ciphertexts must contain exactly 2 packed field elements");
  }

  const programId = requireProgramId();
  const productState = deriveProductStateAddress(args.seller, args.productIdHex);
  const ciphertextBytes = args.encryptedKeyCiphertexts.map((ciphertext, index) => {
    return assertFixedBytes(`Encrypted key ciphertext #${index + 1}`, ciphertext, FIXED_ID_BYTES);
  });
  const stageData = concatBytes(
    await getInstructionDiscriminator("stage_product_arcium_material"),
    encodeU128(args.encryptedKeyNonce),
    ...ciphertextBytes
  );
  const transaction = new Transaction().add(
    new TransactionInstruction({
      programId,
      keys: [
        { pubkey: args.seller, isSigner: true, isWritable: false },
        { pubkey: productState, isSigner: false, isWritable: true }
      ],
      data: Buffer.from(stageData)
    })
  );

  transaction.feePayer = args.seller;

  return {
    productState,
    transaction
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

export async function buildRequestEvaluateAndSealTransaction(args: {
  authority: PublicKey;
  listing: LocalProductListing;
  purchaseIdHex: string;
  computationOffset: bigint;
  sealNonce: bigint;
}) {
  if (!args.listing.sellerWallet) {
    throw new Error("Listing is missing seller wallet information");
  }

  const programId = requireProgramId();
  const seller = new PublicKey(args.listing.sellerWallet);
  const productState = deriveProductStateAddress(seller, args.listing.productIdHex);
  const purchaseState = derivePurchaseStateAddress(productState, args.purchaseIdHex);
  const arcium = deriveArciumAccounts(args.computationOffset, EVALUATE_AND_SEAL_COMP_DEF_OFFSET);
  const requestData = concatBytes(
    await getInstructionDiscriminator("request_evaluate_and_seal"),
    encodeU64(args.computationOffset),
    encodeU128(args.sealNonce)
  );
  const transaction = new Transaction().add(
    new TransactionInstruction({
      programId,
      keys: [
        { pubkey: args.authority, isSigner: true, isWritable: true },
        { pubkey: productState, isSigner: false, isWritable: true },
        { pubkey: purchaseState, isSigner: false, isWritable: true },
        { pubkey: arcium.mxeAccount, isSigner: false, isWritable: false },
        { pubkey: arcium.signPdaAccount, isSigner: false, isWritable: false },
        { pubkey: arcium.mempoolAccount, isSigner: false, isWritable: true },
        { pubkey: arcium.executingPool, isSigner: false, isWritable: true },
        { pubkey: arcium.computationAccount, isSigner: false, isWritable: true },
        { pubkey: arcium.compDefAccount, isSigner: false, isWritable: false },
        { pubkey: arcium.clusterAccount, isSigner: false, isWritable: true },
        { pubkey: arcium.poolAccount, isSigner: false, isWritable: true },
        { pubkey: arcium.clockAccount, isSigner: false, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        { pubkey: arcium.arciumProgram, isSigner: false, isWritable: false }
      ],
      data: Buffer.from(requestData)
    })
  );

  transaction.feePayer = args.authority;

  return {
    arcium,
    productState,
    purchaseState,
    transaction
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
