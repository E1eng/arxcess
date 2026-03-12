import fs from "fs";
import path from "path";
import * as anchor from "@coral-xyz/anchor";
import { clusterApiUrl, PublicKey, SystemProgram, AddressLookupTableProgram, Keypair, Transaction, TransactionInstruction } from "@solana/web3.js";
import {
  buildFinalizeCompDefTx,
  getArciumProgram,
  getCompDefAccAddress,
  getCompDefAccOffset,
  getLookupTableAddress,
  getMXEAccAddress,
  getRawCircuitAccAddress
} from "@arcium-hq/client";

const rootDir = "/home/eleng/arxcess";
const idlPath = path.join(rootDir, "contracts/target/idl/arxcess.json");
const buildDir = path.join(rootDir, "build");
const anchorTomlPath = path.join(rootDir, "Anchor.toml");
const arciumProgramId = new PublicKey("Arcj82pX7HxYKLR92qvgZUAd7vGS1k4hQvAFcPATFdEQ");
const MAX_REALLOC_PER_IX = 10240;
const MAX_UPLOAD_PER_TX_BYTES = 814;
const MAX_ACCOUNT_SIZE = 10485760;
const MAX_EMBIGGEN_IX_PER_TX = 18;
const RAW_ACCOUNT_OVERHEAD = 9;
const COMP_DEFINITION_CONFIGS = [
  {
    instructionName: "init_deposit_key_comp_def",
    circuitName: "deposit_key_v3"
  },
  {
    instructionName: "init_evaluate_and_seal_comp_def",
    circuitName: "evaluate_and_seal_v3"
  }
];

function getTargetCircuitNames() {
  const fromArgv = process.argv.slice(2).map((value) => value.trim()).filter(Boolean);
  if (fromArgv.length > 0) {
    return new Set(fromArgv);
  }

  const fromEnv = (process.env.ARCIUM_COMP_DEF_CIRCUITS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  return fromEnv.length > 0 ? new Set(fromEnv) : null;
}

function getUploadChunkSize() {
  const raw = Number(process.env.ARCIUM_UPLOAD_CHUNK_SIZE ?? "8");
  if (!Number.isInteger(raw) || raw <= 0) {
    return 8;
  }
  return raw;
}

function getUploadDelayMs() {
  const raw = Number(process.env.ARCIUM_UPLOAD_DELAY_MS ?? "0");
  if (!Number.isFinite(raw) || raw < 0) {
    return 0;
  }
  return raw;
}

function sleep(ms) {
  if (ms <= 0) {
    return Promise.resolve();
  }
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readIdl() {
  return JSON.parse(fs.readFileSync(idlPath, "utf8"));
}

function getInstructionDiscriminator(idl, instructionName) {
  const instruction = idl.instructions.find((entry) => entry.name === instructionName);
  if (!instruction) {
    throw new Error(`Instruction ${instructionName} was not found in local IDL.`);
  }
  return Uint8Array.from(instruction.discriminator);
}

function readAnchorToml() {
  return fs.readFileSync(anchorTomlPath, "utf8");
}

function getAnchorTomlValue(sectionName, key) {
  const source = readAnchorToml();
  const sectionPattern = new RegExp(`\\[${sectionName.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")}\\]([\\s\\S]*?)(?:\\n\\[|$)`);
  const match = source.match(sectionPattern);
  if (!match) {
    return null;
  }
  const keyPattern = new RegExp(`^${key}\\s*=\\s*\"([^\"]+)\"`, "m");
  const keyMatch = match[1].match(keyPattern);
  return keyMatch ? keyMatch[1] : null;
}

function resolveWalletPath(walletPath) {
  if (walletPath.startsWith("~/")) {
    return path.join(process.env.HOME ?? "/home/eleng", walletPath.slice(2));
  }
  return walletPath;
}

function resolveProviderUrl(clusterName) {
  const normalized = clusterName.trim().toLowerCase();
  if (normalized === "devnet") {
    return clusterApiUrl("devnet");
  }
  if (normalized === "mainnet" || normalized === "mainnet-beta") {
    return clusterApiUrl("mainnet-beta");
  }
  if (normalized === "localnet" || normalized === "localhost") {
    return "http://127.0.0.1:8899";
  }
  return clusterName;
}

function ensureAnchorEnv() {
  if (!process.env.ANCHOR_PROVIDER_URL) {
    const cluster = getAnchorTomlValue("provider", "cluster");
    if (!cluster) {
      throw new Error("Missing provider.cluster in Anchor.toml.");
    }
    process.env.ANCHOR_PROVIDER_URL = resolveProviderUrl(cluster);
  }
  if (!process.env.ANCHOR_WALLET) {
    const wallet = getAnchorTomlValue("provider", "wallet");
    if (!wallet) {
      throw new Error("Missing provider.wallet in Anchor.toml.");
    }
    process.env.ANCHOR_WALLET = resolveWalletPath(wallet);
  }
}

function buildProvider() {
  ensureAnchorEnv();
  const walletPath = process.env.ANCHOR_WALLET;
  if (!walletPath) {
    throw new Error("ANCHOR_WALLET is not configured.");
  }
  const secretKey = Uint8Array.from(JSON.parse(fs.readFileSync(walletPath, "utf8")));
  const keypair = Keypair.fromSecretKey(secretKey);
  const wallet = new anchor.Wallet(keypair);
  const connection = new anchor.web3.Connection(process.env.ANCHOR_PROVIDER_URL, "confirmed");
  return new anchor.AnchorProvider(connection, wallet, { commitment: "confirmed" });
}

function compDefOffsetNumber(circuitName) {
  const bytes = getCompDefAccOffset(circuitName);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return view.getUint32(0, true);
}

function isCompDefFinalized(compDefAccount) {
  const circuitSource = compDefAccount?.circuitSource;
  if (!circuitSource || !("onChain" in circuitSource) || !circuitSource.onChain) {
    return false;
  }
  const onChain = Array.isArray(circuitSource.onChain) ? circuitSource.onChain[0] : circuitSource.onChain[0] ?? circuitSource.onChain;
  return Boolean(onChain?.isCompleted);
}

async function buildResizeTx(arciumProgram, signerPubkey, compDefOffset, mxeProgramId, rawCircuitIndex, currentSize, requiredSize) {
  const ix = await arciumProgram.methods
    .embiggenRawCircuitAcc(compDefOffset, mxeProgramId, rawCircuitIndex)
    .accounts({
      signer: signerPubkey
    })
    .instruction();
  const resizeSize = Math.min(requiredSize - currentSize, MAX_EMBIGGEN_IX_PER_TX * MAX_REALLOC_PER_IX);
  const ixCount = Math.ceil(resizeSize / MAX_REALLOC_PER_IX);
  const tx = new anchor.web3.Transaction();
  for (let i = 0; i < ixCount; i += 1) {
    tx.add(ix);
  }
  return tx;
}

async function buildUploadCircuitTx(arciumProgram, signerPubkey, compDefOffset, mxeProgramId, bytes, circuitOffset, rawCircuitIndex) {
  let bytesInner = bytes;
  if (bytesInner.length < MAX_UPLOAD_PER_TX_BYTES) {
    const paddedBytes = Buffer.alloc(MAX_UPLOAD_PER_TX_BYTES);
    paddedBytes.set(bytesInner);
    bytesInner = paddedBytes;
  }
  return arciumProgram.methods
    .uploadCircuit(compDefOffset, mxeProgramId, rawCircuitIndex, Array.from(bytesInner), circuitOffset)
    .accounts({
      signer: signerPubkey
    })
    .transaction();
}

async function signAndSend(provider, tx) {
  const blockInfo = await provider.connection.getLatestBlockhash("confirmed");
  tx.recentBlockhash = blockInfo.blockhash;
  tx.lastValidBlockHeight = blockInfo.lastValidBlockHeight;
  return provider.sendAndConfirm(tx, []);
}

async function uploadCircuitResumable(provider, arciumProgram, circuitName, mxeProgramId, rawCircuit, chunkSize) {
  const compDefOffset = compDefOffsetNumber(circuitName);
  const compDefAccount = getCompDefAccAddress(mxeProgramId, compDefOffset);
  const decodedCompDef = await arciumProgram.account.computationDefinitionAccount.fetch(compDefAccount);
  if (isCompDefFinalized(decodedCompDef)) {
    return [];
  }

  const maxRawCircuitPartSize = MAX_ACCOUNT_SIZE - RAW_ACCOUNT_OVERHEAD;
  const numAccs = Math.ceil(rawCircuit.length / maxRawCircuitPartSize);
  const signatures = [];
  const uploadDelayMs = getUploadDelayMs();

  for (let rawCircuitIndex = 0; rawCircuitIndex < numAccs; rawCircuitIndex += 1) {
    const rawCircuitPart = rawCircuit.subarray(rawCircuitIndex * maxRawCircuitPartSize, (rawCircuitIndex + 1) * maxRawCircuitPartSize);
    const rawCircuitPda = getRawCircuitAccAddress(compDefAccount, rawCircuitIndex);
    let existingAcc = await provider.connection.getAccountInfo(rawCircuitPda, "confirmed");
    process.stdout.write(`[${circuitName}] raw circuit part ${rawCircuitIndex + 1}/${numAccs} (${rawCircuitPart.length} bytes)\n`);

    if (!existingAcc) {
      const initSig = await arciumProgram.methods
        .initRawCircuitAcc(compDefOffset, mxeProgramId, rawCircuitIndex)
        .accounts({
          signer: provider.publicKey
        })
        .rpc();
      signatures.push(initSig);
      await sleep(uploadDelayMs);
      existingAcc = await provider.connection.getAccountInfo(rawCircuitPda, "confirmed");
    }

    const requiredAccountSize = rawCircuitPart.length + RAW_ACCOUNT_OVERHEAD;
    let currentSize = existingAcc?.data.length ?? 0;

    while (currentSize < requiredAccountSize) {
      const resizeTx = await buildResizeTx(arciumProgram, provider.publicKey, compDefOffset, mxeProgramId, rawCircuitIndex, currentSize, requiredAccountSize);
      signatures.push(await signAndSend(provider, resizeTx));
      await sleep(uploadDelayMs);
      existingAcc = await provider.connection.getAccountInfo(rawCircuitPda, "confirmed");
      currentSize = existingAcc?.data.length ?? currentSize;
      if (currentSize < requiredAccountSize && currentSize === existingAcc?.data.length) {
        break;
      }
    }

    const remainingTxCount = Math.ceil(rawCircuitPart.length / MAX_UPLOAD_PER_TX_BYTES);
    for (let i = 0; i < remainingTxCount; i += chunkSize) {
      const currentChunkSize = Math.min(chunkSize, remainingTxCount - i);
      process.stdout.write(
        `[${circuitName}] uploading chunks ${i + 1}-${i + currentChunkSize} / ${remainingTxCount} for part ${rawCircuitIndex + 1}/${numAccs}\n`
      );
      for (let j = 0; j < currentChunkSize; j += 1) {
        const offset = MAX_UPLOAD_PER_TX_BYTES * (i + j);
        const tx = await buildUploadCircuitTx(
          arciumProgram,
          provider.publicKey,
          compDefOffset,
          mxeProgramId,
          Buffer.copyBytesFrom(rawCircuitPart, offset, MAX_UPLOAD_PER_TX_BYTES),
          offset,
          rawCircuitIndex
        );
        signatures.push(await signAndSend(provider, tx));
        await sleep(uploadDelayMs);
      }
    }
  }

  process.stdout.write(`[${circuitName}] finalizing computation definition\n`);
  signatures.push(await signAndSend(provider, await buildFinalizeCompDefTx(provider, compDefOffset, mxeProgramId)));
  return signatures;
}

async function initCompDef(args) {
  const { provider, program, idl, mxeAccount, addressLookupTable, instructionName, circuitName, arciumProgram } = args;
  const compDefOffset = compDefOffsetNumber(circuitName);
  const compDefAccount = getCompDefAccAddress(program.programId, compDefOffset);
  const existingCompDef = await provider.connection.getAccountInfo(compDefAccount, "confirmed");
  let txSig = null;

  if (existingCompDef) {
    const decodedCompDef = await arciumProgram.account.computationDefinitionAccount.fetch(compDefAccount);
    if (isCompDefFinalized(decodedCompDef)) {
      return {
        circuitName,
        compDefAccount: compDefAccount.toBase58(),
        initSignature: null,
        uploadSignatures: [],
        skipped: "already_finalized"
      };
    }
  }

  if (!existingCompDef) {
    const initIx = new TransactionInstruction({
      programId: program.programId,
      keys: [
        { pubkey: provider.publicKey, isSigner: true, isWritable: true },
        { pubkey: mxeAccount, isSigner: false, isWritable: true },
        { pubkey: compDefAccount, isSigner: false, isWritable: true },
        { pubkey: addressLookupTable, isSigner: false, isWritable: true },
        { pubkey: AddressLookupTableProgram.programId, isSigner: false, isWritable: false },
        { pubkey: arciumProgramId, isSigner: false, isWritable: false },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }
      ],
      data: Buffer.from(getInstructionDiscriminator(idl, instructionName))
    });
    const initTx = new Transaction().add(initIx);
    txSig = await provider.sendAndConfirm(initTx, []);
  }

  const rawCircuit = fs.readFileSync(path.join(buildDir, `${circuitName}.arcis`));
  const uploadSignatures = await uploadCircuitResumable(provider, arciumProgram, circuitName, program.programId, rawCircuit, getUploadChunkSize());
  return {
    circuitName,
    compDefAccount: compDefAccount.toBase58(),
    initSignature: txSig,
    uploadSignatures,
    skipped: null
  };
}

async function main() {
  const provider = buildProvider();
  anchor.setProvider(provider);
  if (!provider.publicKey) {
    throw new Error("Anchor provider is missing a public key.");
  }
  const idl = readIdl();
  const program = new anchor.Program(idl, provider);
  const arciumProgram = getArciumProgram(provider);
  const mxeAccount = getMXEAccAddress(program.programId);
  const mxeInfo = await arciumProgram.account.mxeAccount.fetch(mxeAccount);
  const addressLookupTable = getLookupTableAddress(program.programId, mxeInfo.lutOffsetSlot);
  const targetCircuits = getTargetCircuitNames();
  const configs = targetCircuits
    ? COMP_DEFINITION_CONFIGS.filter((config) => targetCircuits.has(config.circuitName))
    : COMP_DEFINITION_CONFIGS;

  if (configs.length === 0) {
    throw new Error("No matching computation definitions selected.");
  }

  const results = [];
  for (const config of configs) {
    process.stdout.write(`[init] processing ${config.circuitName}\n`);
    results.push(await initCompDef({
      provider,
      program,
      idl,
      arciumProgram,
      mxeAccount,
      addressLookupTable,
      instructionName: config.instructionName,
      circuitName: config.circuitName
    }));
  }

  process.stdout.write(`${JSON.stringify(results, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exit(1);
});
