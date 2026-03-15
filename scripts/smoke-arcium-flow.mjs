import fs from "fs";
import path from "path";
import crypto from "crypto";
import * as anchor from "@coral-xyz/anchor";
import nacl from "tweetnacl";
import { Connection, Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction } from "@solana/web3.js";
import { createPacker, getMXEPublicKey, RescueCipher, x25519 } from "@arcium-hq/client";

const ROOT = "/home/eleng/arxcess";
const ENV = Object.fromEntries(fs.readFileSync(path.join(ROOT, "frontend/.env"), "utf8").split(/\r?\n/).filter(Boolean).map((line) => {
  const i = line.indexOf("=");
  return [line.slice(0, i), line.slice(i + 1)];
}));
const IDL = JSON.parse(fs.readFileSync(path.join(ROOT, "contracts/target/idl/arxcess.json"), "utf8"));
const WALLET = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(path.join(process.env.HOME ?? "/home/eleng", ".config/solana/id.json"), "utf8"))));
const RPC = ENV.NEXT_PUBLIC_SOLANA_RPC_URL;
const PROGRAM_ID = new PublicKey(ENV.NEXT_PUBLIC_PROGRAM_ID);
const TREASURY = new PublicKey(ENV.NEXT_PUBLIC_TREASURY_WALLET);
const CLUSTER_OFFSET = Number(ENV.NEXT_PUBLIC_ARCIUM_CLUSTER_OFFSET);
const ARCIUM_PROGRAM_ID = new PublicKey("Arcj82pX7HxYKLR92qvgZUAd7vGS1k4hQvAFcPATFdEQ");
const ARCIUM_FEE_POOL = new PublicKey("G2sRWJvi3xoyh5k2gY49eG9L8YhAEWQPtNb1zb1GXTtC");
const ARCIUM_CLOCK = new PublicKey("7EbMUTLo5DjdzbN7s8BXeZwXzEwNQb1hScfRvWg8a6ot");
const DEPOSIT_KEY_COMP_DEF_OFFSET = 144409244;
const EVALUATE_AND_SEAL_COMP_DEF_OFFSET = 3143075288;
const P = createPacker(Array.from({ length: 44 }, (_, i) => ({ name: `bytes[${i}]`, type: { Integer: { signed: false, width: 8 } } })), "PackedDeliveryMaterial");
const enc = new TextEncoder();

const b = (...xs) => Buffer.concat(xs.map((x) => Buffer.from(x)));
const u32 = (n) => { const x = Buffer.alloc(4); x.writeUInt32LE(n, 0); return x; };
const u16 = (n) => { const x = Buffer.alloc(2); x.writeUInt16LE(n, 0); return x; };
const u64 = (n) => { const x = Buffer.alloc(8); x.writeBigUInt64LE(BigInt(n), 0); return x; };
const u128 = (n) => { const x = Buffer.alloc(16); let v = BigInt(n); for (let i = 0; i < 16; i += 1) { x[i] = Number(v & 255n); v >>= 8n; } return x; };
const hex = (x) => Buffer.from(x).toString("hex");
const hexBytes = (x) => Buffer.from(x, "hex");
const str = (s) => b(u32(Buffer.byteLength(s)), Buffer.from(s));
const randHex = () => crypto.randomBytes(32).toString("hex");
const disc = (name) => Buffer.from(IDL.instructions.find((i) => i.name === name).discriminator);
const pda = (seeds, pid = PROGRAM_ID) => PublicKey.findProgramAddressSync(seeds, pid)[0];
const arPda = (seeds) => pda(seeds, ARCIUM_PROGRAM_ID);
const readU128 = (buf, off) => buf.readBigUInt64LE(off) | (buf.readBigUInt64LE(off + 8) << 64n);

function productState(seller, productIdHex) { return pda([enc.encode("product"), seller.toBytes(), hexBytes(productIdHex)]); }
function purchaseState(product, purchaseIdHex) { return pda([enc.encode("purchase"), product.toBytes(), hexBytes(purchaseIdHex)]); }
function arciumAccounts(offset, compDefOffset) {
  return {
    arciumProgram: ARCIUM_PROGRAM_ID,
    mxeAccount: arPda([Buffer.from("MXEAccount"), PROGRAM_ID.toBuffer()]),
    signPdaAccount: pda([Buffer.from("ArciumSignerAccount")]),
    mempoolAccount: arPda([Buffer.from("Mempool"), u32(CLUSTER_OFFSET)]),
    executingPool: arPda([Buffer.from("Execpool"), u32(CLUSTER_OFFSET)]),
    computationAccount: arPda([Buffer.from("ComputationAccount"), u32(CLUSTER_OFFSET), u64(offset)]),
    compDefAccount: arPda([Buffer.from("ComputationDefinitionAccount"), PROGRAM_ID.toBuffer(), u32(compDefOffset)]),
    clusterAccount: arPda([Buffer.from("Cluster"), u32(CLUSTER_OFFSET)]),
    poolAccount: ARCIUM_FEE_POOL,
    clockAccount: ARCIUM_CLOCK
  };
}
function decodeProduct(data) {
  let o = 8 + 1 + 32 + 32 + 32 + 8 + 2;
  const status = data[o]; o += 1;
  o += 200 + 100;
  const ciphertextHashHex = hex(data.subarray(o, o + 32)); o += 32;
  o += 8 + 32;
  const keyCommitmentHex = hex(data.subarray(o, o + 32)); o += 32;
  o += 8 + 4 + 1 + 8 + 8 + 8;
  const arciumCustodyReady = Boolean(data[o]); o += 1;
  const arciumDepositComputationOffset = Number(data.readBigUInt64LE(o)); o += 8;
  o += 8;
  const arciumKeyNonce = readU128(data, o); o += 16;
  const arciumKeyCiphertexts = [data.subarray(o, o + 32), data.subarray(o + 32, o + 64)];
  return { status, ciphertextHashHex, keyCommitmentHex, arciumCustodyReady, arciumDepositComputationOffset, arciumKeyNonce, arciumKeyCiphertexts };
}
function decodePurchase(data) {
  let o = 8 + 1 + 32 + 32 + 32 + 32 + 8 + 8 + 8;
  const status = data[o]; o += 1;
  const entitlementFlag = data[o]; o += 1;
  o += 2 + 256 + 100;
  const deliveryCommitmentHex = hex(data.subarray(o, o + 32)); o += 32;
  o += 8 + 4 + 4 + 8 + 8 + 8;
  const arciumDeliveryReady = Boolean(data[o]); o += 1;
  const arciumEvaluateComputationOffset = Number(data.readBigUInt64LE(o)); o += 8;
  o += 8;
  const arciumDeliveryEncryptionKey = data.subarray(o, o + 32); o += 32;
  const arciumDeliveryNonce = readU128(data, o); o += 16;
  const arciumDeliveryCiphertexts = [data.subarray(o, o + 32), data.subarray(o + 32, o + 64)];
  return { status, entitlementFlag, deliveryCommitmentHex, arciumDeliveryReady, arciumEvaluateComputationOffset, arciumDeliveryEncryptionKey, arciumDeliveryNonce, arciumDeliveryCiphertexts };
}
async function send(tx, label) {
  const c = new Connection(RPC, "confirmed");
  const bh = await c.getLatestBlockhash();
  tx.feePayer = WALLET.publicKey;
  tx.recentBlockhash = bh.blockhash;
  tx.sign(WALLET);
  const sig = await c.sendRawTransaction(tx.serialize(), { skipPreflight: false });
  const ok = await c.confirmTransaction({ signature: sig, blockhash: bh.blockhash, lastValidBlockHeight: bh.lastValidBlockHeight }, "confirmed");
  if (ok.value.err) throw new Error(`${label} failed: ${JSON.stringify(ok.value.err)}`);
  console.log(`${label}: ${sig}`);
}
async function waitFor(pubkey, decode, pred, label, polls = 40, ms = 5000) {
  const c = new Connection(RPC, "confirmed");
  for (let i = 0; i < polls; i += 1) {
    const acc = await c.getAccountInfo(pubkey, "confirmed");
    if (acc) {
      const state = decode(Buffer.from(acc.data));
      if (pred(state)) return state;
    }
    console.log(`${label}: waiting ${i + 1}/${polls}`);
    await new Promise((r) => setTimeout(r, ms));
  }
  throw new Error(`${label} timeout`);
}
function pack(contentKey, iv) { return P.pack({ bytes: [...contentKey, ...iv].map((x) => BigInt(x)) }); }
function unpack(chunks) { const u = P.unpack(chunks).bytes.map((x) => Number(x)); return { contentKey: Buffer.from(u.slice(0, 32)), iv: Buffer.from(u.slice(32, 44)) }; }
async function keyCommitment(productIdHex, sellerWallet, ciphertextHashHex, contentKey) { return crypto.createHash("sha256").update(b(hexBytes(productIdHex), new PublicKey(sellerWallet).toBytes(), hexBytes(ciphertextHashHex), contentKey)).digest("hex"); }

async function main() {
  const connection = new Connection(RPC, "confirmed");
  const provider = new anchor.AnchorProvider(connection, new anchor.Wallet(WALLET), {});
  const seller = WALLET.publicKey;
  const buyer = WALLET.publicKey;
  const productIdHex = randHex();
  const purchaseIdHex = randHex();
  const prod = productState(seller, productIdHex);
  const pur = purchaseState(prod, purchaseIdHex);
  const contentKey = crypto.randomBytes(32);
  const iv = crypto.randomBytes(12);
  const ciphertextHashHex = randHex();
  const keyCommitmentHex = await keyCommitment(productIdHex, seller.toBase58(), ciphertextHashHex, contentKey);
  const mxePublicKey = Buffer.from(await getMXEPublicKey(provider, PROGRAM_ID) ?? []);
  if (mxePublicKey.length !== 32) throw new Error("Missing MXE public key");

  const sellerSecret = x25519.utils.randomSecretKey();
  const sellerPub = Buffer.from(x25519.getPublicKey(sellerSecret));
  const shared = x25519.getSharedSecret(sellerSecret, mxePublicKey);
  const nonceBytes = crypto.randomBytes(16);
  const encryptedKeyNonce = readU128(Buffer.from(nonceBytes), 0);
  const encryptedKeyCiphertexts = new RescueCipher(shared).encrypt(pack(contentKey, iv), nonceBytes).map((x) => Buffer.from(x));

  await send(new Transaction().add(new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: seller, isSigner: true, isWritable: true },
      { pubkey: TREASURY, isSigner: false, isWritable: false },
      { pubkey: prod, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }
    ],
    data: b(disc("create_product"), hexBytes(productIdHex), str(`https://example.com/meta/${productIdHex.slice(0, 8)}`), str(`cid-${productIdHex.slice(0, 16)}`), hexBytes(ciphertextHashHex), u64(1_000_000n), u16(250), u64(1234n), u64(3600), u32(1), Buffer.from([1]))
  })), "create_product");

  const depOffset = BigInt(Date.now());
  const dep = arciumAccounts(depOffset, DEPOSIT_KEY_COMP_DEF_OFFSET);
  await send(new Transaction().add(new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: seller, isSigner: true, isWritable: true },
      { pubkey: prod, isSigner: false, isWritable: true },
      { pubkey: dep.mxeAccount, isSigner: false, isWritable: false },
      { pubkey: dep.signPdaAccount, isSigner: false, isWritable: true },
      { pubkey: dep.mempoolAccount, isSigner: false, isWritable: true },
      { pubkey: dep.executingPool, isSigner: false, isWritable: true },
      { pubkey: dep.computationAccount, isSigner: false, isWritable: true },
      { pubkey: dep.compDefAccount, isSigner: false, isWritable: false },
      { pubkey: dep.clusterAccount, isSigner: false, isWritable: true },
      { pubkey: dep.poolAccount, isSigner: false, isWritable: true },
      { pubkey: dep.clockAccount, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: dep.arciumProgram, isSigner: false, isWritable: false }
    ],
    data: b(disc("request_deposit_product_key"), u64(depOffset), sellerPub, u128(encryptedKeyNonce), encryptedKeyCiphertexts[0], encryptedKeyCiphertexts[1], hexBytes(keyCommitmentHex))
  })), "request_deposit_product_key");

  const prodAfterDeposit = await waitFor(prod, decodeProduct, (s) => s.arciumCustodyReady, "deposit callback");
  console.log({ prodAfterDeposit });

  await send(new Transaction().add(new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: seller, isSigner: true, isWritable: false },
      { pubkey: prod, isSigner: false, isWritable: true }
    ],
    data: disc("activate_product")
  })), "activate_product");

  await waitFor(prod, decodeProduct, (s) => s.status === 1, "product active", 10, 2000);

  const buyerDelivery = nacl.box.keyPair();
  await send(new Transaction().add(new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: buyer, isSigner: true, isWritable: true },
      { pubkey: seller, isSigner: false, isWritable: true },
      { pubkey: TREASURY, isSigner: false, isWritable: true },
      { pubkey: prod, isSigner: false, isWritable: true },
      { pubkey: pur, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }
    ],
    data: b(disc("purchase_product"), hexBytes(purchaseIdHex), Buffer.from(buyerDelivery.publicKey))
  })), "purchase_product");

  const evalOffset = BigInt(Date.now() + 7777);
  const sealNonce = readU128(crypto.randomBytes(16), 0);
  const ev = arciumAccounts(evalOffset, EVALUATE_AND_SEAL_COMP_DEF_OFFSET);
  await send(new Transaction().add(new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: seller, isSigner: true, isWritable: true },
      { pubkey: prod, isSigner: false, isWritable: true },
      { pubkey: pur, isSigner: false, isWritable: true },
      { pubkey: ev.mxeAccount, isSigner: false, isWritable: false },
      { pubkey: ev.signPdaAccount, isSigner: false, isWritable: true },
      { pubkey: ev.mempoolAccount, isSigner: false, isWritable: true },
      { pubkey: ev.executingPool, isSigner: false, isWritable: true },
      { pubkey: ev.computationAccount, isSigner: false, isWritable: true },
      { pubkey: ev.compDefAccount, isSigner: false, isWritable: false },
      { pubkey: ev.clusterAccount, isSigner: false, isWritable: true },
      { pubkey: ev.poolAccount, isSigner: false, isWritable: true },
      { pubkey: ev.clockAccount, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: ev.arciumProgram, isSigner: false, isWritable: false }
    ],
    data: b(disc("request_evaluate_and_seal"), u64(evalOffset), u128(sealNonce))
  })), "request_evaluate_and_seal");

  const purAfter = await waitFor(pur, decodePurchase, (s) => s.arciumDeliveryReady && s.status === 3, "evaluate_and_seal callback");
  console.log({ purAfter });

  const revealed = unpack(new RescueCipher(x25519.getSharedSecret(Buffer.from(buyerDelivery.secretKey), mxePublicKey)).decrypt(
    purAfter.arciumDeliveryCiphertexts.map((x) => [...x]),
    Buffer.from(u128(purAfter.arciumDeliveryNonce))
  ));
  const revealedCommitmentHex = await keyCommitment(productIdHex, seller.toBase58(), ciphertextHashHex, revealed.contentKey);

  console.log(JSON.stringify({
    productIdHex,
    purchaseIdHex,
    onchainKeyCommitmentHex: prodAfterDeposit.keyCommitmentHex,
    revealedCommitmentHex,
    contentKeyMatchesOriginal: revealed.contentKey.equals(contentKey),
    ivMatchesOriginal: revealed.iv.equals(iv),
    commitmentMatchesOnchain: revealedCommitmentHex === prodAfterDeposit.keyCommitmentHex,
    deliveryOwnerMatchesBuyer: Buffer.from(purAfter.arciumDeliveryEncryptionKey).equals(Buffer.from(buyerDelivery.publicKey))
  }, null, 2));

  if (revealedCommitmentHex !== prodAfterDeposit.keyCommitmentHex) throw new Error("Reveal commitment mismatch");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
