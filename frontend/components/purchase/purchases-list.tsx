"use client";

import { useEffect, useMemo, useState } from "react";
import { AnchorProvider } from "@coral-xyz/anchor";
import Image from "next/image";
import { useAnchorWallet, useConnection, useWallet } from "@solana/wallet-adapter-react";
import { type ProductMetadata } from "@arxcess/sdk";
import { PublicKey } from "@solana/web3.js";
import { CategoryIcon } from "@/components/marketplace/category-icon";
import { createArciumDeliveryCommitmentHex, getArciumFrontendBlockMessage, getArciumMxePublicKey, isArciumFrontendRuntimeReady, revealArciumDeliveryMaterial, revealArciumDeliveryMaterialWithNonce } from "@/lib/arcium/client";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { NoticeToast } from "@/components/ui/notice-toast";
import { WalletAddress } from "@/components/ui/WalletAddress";
import { decryptCiphertext, sha256Hex } from "@/lib/crypto/content";
import { base64ToBytes, bytesToHex, hexToBytes } from "@/lib/utils/bytes";
import { type DeliveryKeypair } from "@/lib/crypto/delivery";
import { hasConfiguredProgramId } from "@/lib/anchor/client";
import { confirmTransactionOrThrow } from "@/lib/solana/transactions";
import { useProducts } from "@/hooks/use-products";
import { useDeliveryKeys } from "@/hooks/use-delivery-keys";
import { usePurchases } from "@/hooks/use-purchases";
import { hasSupabasePurchasesPublicConfig, upsertMarketplacePurchase } from "@/lib/marketplace/purchases";
import { CATEGORY_LABELS, normalizeMarketplaceCategory } from "@/lib/marketplace/categories";
import { fetchOnchainProductStates, fetchOnchainPurchaseStates, type DecodedProductState, type DecodedPurchaseState } from "@/lib/solana/account-state";
import { buildConsumeAccessTransaction, buildRequestEvaluateAndSealTransaction, buildRevokePurchaseTransaction } from "@/lib/solana/arxcess";
import { type LocalPurchaseIntent, getStoredPurchase, saveStoredPurchase } from "@/lib/storage/marketplace";
import { formatOptionalDateTime, truncateValue } from "@/lib/utils/format";

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function pinataGatewayUrlFromCid(cid: string) {
  return `https://gateway.pinata.cloud/ipfs/${cid}`;
}

function resolveMetadataUrl(product: { metadataGatewayUrl: string }, onchainProduct: DecodedProductState | undefined) {
  return onchainProduct?.metadataUri || product.metadataGatewayUrl;
}

function resolveCiphertextUrl(
  product: { ciphertextGatewayUrl: string },
  onchainPurchase: DecodedPurchaseState | undefined,
  onchainProduct: DecodedProductState | undefined
) {
  if (onchainPurchase?.ciphertextCidSnapshot) {
    return pinataGatewayUrlFromCid(onchainPurchase.ciphertextCidSnapshot);
  }

  if (onchainProduct?.ciphertextCid) {
    return pinataGatewayUrlFromCid(onchainProduct.ciphertextCid);
  }

  return product.ciphertextGatewayUrl;
}

function resolveCiphertextHashHex(product: { ciphertextHashHex: string }, onchainProduct: DecodedProductState | undefined) {
  return onchainProduct?.ciphertextHashHex || product.ciphertextHashHex;
}

function randomBigInt(byteLength: number) {
  const bytes = crypto.getRandomValues(new Uint8Array(byteLength));
  let value = 0n;

  for (const byte of bytes) {
    value = (value << 8n) | BigInt(byte);
  }

  return value;
}

function explorerTxUrl(signature: string) {
  return `https://explorer.solana.com/tx/${signature}?cluster=devnet`;
}

async function deriveListingKeyCommitmentHex(args: {
  contentKey: Uint8Array;
  ciphertextHashHex: string;
  productIdHex: string;
  sellerWallet: string;
}) {
  const payload = new Uint8Array([
    ...hexToBytes(args.productIdHex),
    ...new PublicKey(args.sellerWallet).toBytes(),
    ...hexToBytes(args.ciphertextHashHex),
    ...args.contentKey
  ]);
  const digest = await crypto.subtle.digest("SHA-256", toArrayBuffer(payload));
  return bytesToHex(new Uint8Array(digest));
}

async function resolveVerifiedDeliveryMaterial(args: {
  deliveryKeypair: DeliveryKeypair;
  deliveryEncryptionKey: Uint8Array;
  mxePublicKey: Uint8Array;
  deliveryNonce: bigint;
  deliveryCiphertexts: Uint8Array[];
  expectedKeyCommitmentHex: string;
  ciphertextHashHex: string;
  productIdHex: string;
  sellerWallet: string;
}) {
  const attempts = [
    { label: "stored", nonce: args.deliveryNonce },
    { label: "plus_1", nonce: args.deliveryNonce + 1n },
    ...(args.deliveryNonce > 0n ? [{ label: "minus_1", nonce: args.deliveryNonce - 1n }] : [])
  ];

  for (const attempt of attempts) {
    const material = attempt.label === "stored"
      ? await revealArciumDeliveryMaterial({
          keypair: args.deliveryKeypair,
          deliveryEncryptionKey: args.deliveryEncryptionKey,
          mxePublicKey: args.mxePublicKey,
          deliveryNonce: attempt.nonce,
          deliveryCiphertexts: args.deliveryCiphertexts
        })
      : await revealArciumDeliveryMaterialWithNonce({
          keypair: args.deliveryKeypair,
          mxePublicKey: args.mxePublicKey,
          deliveryNonce: attempt.nonce,
          deliveryCiphertexts: args.deliveryCiphertexts
        });

    const derivedKeyCommitmentHex = await deriveListingKeyCommitmentHex({
      contentKey: material.contentKey,
      ciphertextHashHex: args.ciphertextHashHex,
      productIdHex: args.productIdHex,
      sellerWallet: args.sellerWallet
    });

    if (derivedKeyCommitmentHex === args.expectedKeyCommitmentHex) {
      return material;
    }
  }

  throw new Error("Arcium delivery content key does not match the on-chain product key commitment.");
}

interface RevealedAsset {
  downloadName: string;
  mimeType: string;
  objectUrl: string;
}

function downloadRevealedAsset(asset: RevealedAsset) {
  const link = document.createElement("a");

  link.href = asset.objectUrl;
  link.download = asset.downloadName;
  document.body.appendChild(link);
  link.click();
  link.remove();
}

type StatusFilter = "all" | "waiting" | "delivered" | "revoked";
type LibraryTab = "assets" | "history";
type LibraryToast = {
  title: string;
  message: string;
  variant: "info" | "success";
};

export function PurchasesList() {
  const { connection } = useConnection();
  const anchorWallet = useAnchorWallet();
  const { publicKey, sendTransaction } = useWallet();
  const { purchases, refreshPurchases } = usePurchases();
  const { products } = useProducts();
  const connectedWallet = useMemo(() => publicKey?.toBase58() ?? null, [publicKey]);
  const { keypair } = useDeliveryKeys(connectedWallet);
  const [busyPurchaseId, setBusyPurchaseId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [statusToast, setStatusToast] = useState<LibraryToast | null>(null);
  const [onchainProductStates, setOnchainProductStates] = useState<Record<string, DecodedProductState>>({});
  const [onchainPurchaseStates, setOnchainPurchaseStates] = useState<Record<string, DecodedPurchaseState>>({});
  const [revealedAssets, setRevealedAssets] = useState<Record<string, RevealedAsset>>({});
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [activeTab, setActiveTab] = useState<LibraryTab>("assets");

  // Filter purchases by connected wallet only
  const myPurchases = useMemo(
    () => connectedWallet ? purchases.filter((p) => p.buyerWallet === connectedWallet) : [],
    [purchases, connectedWallet]
  );

  const purchaseCards = useMemo(
    () =>
      myPurchases.map((purchase) => ({
        purchase,
        product: products.find((product) => product.productIdHex === purchase.productIdHex) ?? null
      })),
    [products, myPurchases]
  );
  const hasPurchases = purchaseCards.length > 0;
  const isArciumFinalizeBlocked = hasPurchases && !isArciumFrontendRuntimeReady();

  useEffect(() => {
    let ignore = false;

    async function loadOnchainStates() {
      const resolvable = purchaseCards
        .filter(({ product }) => Boolean(product?.sellerWallet))
        .map(({ purchase, product }) => ({
          purchaseIdHex: purchase.purchaseIdHex,
          listing: product!
        }));

      if (resolvable.length === 0) {
        if (!ignore) {
          setOnchainPurchaseStates({});
        }
        return;
      }

      try {
        const [purchaseStates, productStates] = await Promise.all([
          fetchOnchainPurchaseStates(connection, resolvable),
          fetchOnchainProductStates(connection, resolvable.map((entry) => entry.listing))
        ]);
        if (!ignore) {
          setOnchainPurchaseStates(purchaseStates);
          setOnchainProductStates(productStates);
        }
      } catch {
        if (!ignore) {
          setOnchainProductStates({});
          setOnchainPurchaseStates({});
        }
      }
    }

    void loadOnchainStates();

    const interval = window.setInterval(() => {
      void loadOnchainStates();
    }, 10000);

    const handleFocus = () => {
      void loadOnchainStates();
    };

    window.addEventListener("focus", handleFocus);

    return () => {
      ignore = true;
      window.clearInterval(interval);
      window.removeEventListener("focus", handleFocus);
    };
  }, [connection, purchaseCards]);

  function resolvePurchase(purchaseIdHex: string) {
    return getStoredPurchase(purchaseIdHex) ?? purchases.find((entry) => entry.purchaseIdHex === purchaseIdHex) ?? null;
  }

  async function persistPurchase(purchase: LocalPurchaseIntent) {
    saveStoredPurchase(purchase);

    if (hasSupabasePurchasesPublicConfig()) {
      try {
        await upsertMarketplacePurchase(purchase);
      } catch (cause) {
        console.error("Failed to sync purchase history", cause);
      }
    }
  }

  function showStatus(title: string, message: string, variant: LibraryToast["variant"] = "info") {
    setStatusToast({ title, message, variant });
  }

  function resolveEffectivePurchaseStatus(onchain: DecodedPurchaseState | undefined, purchaseStatus: string) {
    if (onchain?.statusLabel === "pending_seal" && onchain.arciumEvaluateComputationOffset !== 0 && !onchain.arciumDeliveryReady) {
      return "pending_arcium" as const;
    }

    if (onchain?.statusLabel === "delivered" && onchain.arciumDeliveryReady && !onchain.sealedKeyBoxBase64) {
      return "delivered_arcium" as const;
    }

    return (onchain?.statusLabel ?? purchaseStatus) as "prepared" | "pending_seal" | "delivered" | "revoked" | "delivered_arcium" | "pending_arcium";
  }

  async function finalizeDelivery(purchaseIdHex: string) {
    const purchase = resolvePurchase(purchaseIdHex);
    const product = purchase ? products.find((entry) => entry.productIdHex === purchase.productIdHex) ?? null : null;

    if (!purchase || !product) {
      setError("Purchase or listing data is missing.");
      return;
    }

    if (!publicKey || !sendTransaction) {
      setError("Connect the publishing wallet before finalizing delivery.");
      return;
    }

    if (!hasConfiguredProgramId()) {
      setError("Missing NEXT_PUBLIC_PROGRAM_ID.");
      return;
    }

    if (!product.sellerWallet || publicKey.toBase58() !== product.sellerWallet) {
      setError("Finalize delivery must be signed by the wallet that published this listing.");
      return;
    }

    if (!isArciumFrontendRuntimeReady()) {
      setError(getArciumFrontendBlockMessage("finalize"));
      return;
    }

    setBusyPurchaseId(purchaseIdHex);
    setError(null);
    showStatus("Finalize delivery", "Preparing Arcium delivery finalization...");

    try {
      const onchain = onchainPurchaseStates[purchaseIdHex];
      const effectiveStatus = resolveEffectivePurchaseStatus(onchain, purchase.status);

      if (!onchain) {
        throw new Error("On-chain purchase state is not available yet. Wait for Library to refresh, then try finalizing again.");
      }

      if (effectiveStatus === "pending_arcium") {
        showStatus("Finalize delivery", "Arcium delivery is already queued. Wait for the confidential callback to settle on-chain.");
        return;
      }

      if (effectiveStatus === "delivered_arcium" || effectiveStatus === "delivered") {
        showStatus("Finalize delivery", "Delivery is already finalized. The buyer can reveal it now.");
        return;
      }

      if (onchain.statusLabel !== "pending_seal") {
        throw new Error(`Cannot queue Arcium delivery from purchase status ${onchain.statusLabel}.`);
      }

      const computationOffset = randomBigInt(8);
      const sealNonce = randomBigInt(16);
      const { transaction } = await buildRequestEvaluateAndSealTransaction({
        authority: publicKey,
        listing: product,
        purchaseIdHex,
        computationOffset,
        sealNonce
      });
      const latestBlockhash = await connection.getLatestBlockhash();

      transaction.recentBlockhash = latestBlockhash.blockhash;
      transaction.feePayer = publicKey;

      const finalizeSignature = await sendTransaction(transaction, connection);

      await confirmTransactionOrThrow({
        connection,
        signature: finalizeSignature,
        blockhash: latestBlockhash.blockhash,
        lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
        label: "Finalize delivery"
      });

      await persistPurchase({
        ...purchase,
        finalizeSignature,
        deliveryMode: "arcium",
        status: "pending_seal"
      });
      refreshPurchases();
      showStatus("Finalize delivery", "Arcium delivery request queued. Wait for the confidential callback to settle on-chain.", "success");
    } catch (cause) {
      setStatusToast(null);
      setError(cause instanceof Error ? cause.message : "Failed to finalize delivery.");
    } finally {
      setBusyPurchaseId(null);
    }
  }

  async function revokePurchase(purchaseIdHex: string) {
    const purchase = resolvePurchase(purchaseIdHex);
    const product = purchase ? products.find((entry) => entry.productIdHex === purchase.productIdHex) ?? null : null;

    if (!purchase || !product) {
      setError("Purchase or listing data is missing.");
      return;
    }

    if (!publicKey || !sendTransaction) {
      setError("Connect the publishing wallet before revoking access.");
      return;
    }

    if (!hasConfiguredProgramId()) {
      setError("Missing NEXT_PUBLIC_PROGRAM_ID.");
      return;
    }

    if (!product.sellerWallet || publicKey.toBase58() !== product.sellerWallet) {
      setError("Revoke must be signed by the wallet that published this listing.");
      return;
    }

    if (!product.policy.revocable) {
      setError("This listing is not revocable.");
      return;
    }

    setBusyPurchaseId(purchaseIdHex);
    setError(null);
    showStatus("Revoke purchase", "Submitting revoke transaction...");

    try {
      const { transaction } = await buildRevokePurchaseTransaction({
        authority: publicKey,
        listing: product,
        purchaseIdHex
      });
      const latestBlockhash = await connection.getLatestBlockhash();

      transaction.recentBlockhash = latestBlockhash.blockhash;

      const revokeSignature = await sendTransaction(transaction, connection);

      await confirmTransactionOrThrow({
        connection,
        signature: revokeSignature,
        blockhash: latestBlockhash.blockhash,
        lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
        label: "Revoke purchase"
      });

      await persistPurchase({
        ...purchase,
        status: "revoked",
        revokedAt: new Date().toISOString(),
        finalizeSignature: purchase.finalizeSignature ?? revokeSignature
      });
      refreshPurchases();
      showStatus("Revoke purchase", "Access revoked successfully. Future reveals are now blocked for this purchase.", "success");
    } catch (cause) {
      setStatusToast(null);
      setError(cause instanceof Error ? cause.message : "Failed to revoke purchase.");
    } finally {
      setBusyPurchaseId(null);
    }
  }

  async function revealPurchase(purchaseIdHex: string) {
    const purchase = resolvePurchase(purchaseIdHex);
    const product = purchase ? products.find((entry) => entry.productIdHex === purchase.productIdHex) ?? null : null;
    const onchain = onchainPurchaseStates[purchaseIdHex];
    const onchainProduct = product ? onchainProductStates[product.productIdHex] : undefined;
    let stage = "prepare";

    if (!purchase || !product) {
      setError("Purchase or listing data is missing.");
      return;
    }

    if (!publicKey || !sendTransaction) {
      setError("Connect the purchase wallet before revealing the asset.");
      return;
    }

    if (purchase.buyerWallet && publicKey.toBase58() !== purchase.buyerWallet) {
      setError("Reveal must be signed by the wallet that purchased this item.");
      return;
    }

    if (!keypair) {
      setError("The access key for this purchase is missing in this browser. Use the same browser profile that created the purchase before revealing.");
      return;
    }

    if (keypair.publicKeyBase64 !== purchase.buyerDeliveryPublicKeyBase64) {
      setError("The current access key does not match this purchase. Restore the original key used during checkout before revealing.");
      return;
    }

    const deliveryKeypair: DeliveryKeypair = keypair;

    if (!onchain?.arciumDeliveryReady) {
      setError("Arcium delivery callback has not settled on-chain yet.");
      return;
    }

    if (onchain && onchain.statusLabel === "delivered" && onchain.entitlementFlag !== 1) {
      setError("This delivery was finalized without an approved unlock payload, so reveal is blocked.");
      return;
    }

    if (onchain?.revokedAt || purchase.revokedAt) {
      setError("Access has been revoked for this purchase.");
      return;
    }

    const effectiveExpiresAtMs = onchain?.expiresAt
      ? onchain.expiresAt * 1000
      : purchase.expiresAt
        ? new Date(purchase.expiresAt).getTime()
        : 0;

    if (effectiveExpiresAtMs && effectiveExpiresAtMs < Date.now()) {
      setError("This purchase license has expired.");
      return;
    }

    const effectiveAccessCount = onchain?.accessCount ?? purchase.accessCount;
    const effectiveMaxAccessCount = onchain?.maxAccessCount ?? purchase.maxAccessCount;

    if (effectiveAccessCount >= effectiveMaxAccessCount) {
      setError("This purchase has exhausted its reveal quota.");
      return;
    }

    if (!hasConfiguredProgramId()) {
      setError("Missing NEXT_PUBLIC_PROGRAM_ID.");
      return;
    }

    setBusyPurchaseId(purchaseIdHex);
    setError(null);
    showStatus("Reveal", "Preparing secure reveal...");

    try {
      stage = "resolve_payload";
      const expectedCommitmentHex = await createArciumDeliveryCommitmentHex({
        deliveryEncryptionKey: onchain.arciumDeliveryEncryptionKey,
        deliveryNonce: onchain.arciumDeliveryNonce,
        deliveryCiphertexts: onchain.arciumDeliveryCiphertexts
      });

      if (expectedCommitmentHex !== onchain.deliveryCommitmentHex) {
        throw new Error("Arcium delivery commitment mismatch. The on-chain callback payload does not match the stored commitment.");
      }

      if (!anchorWallet) {
        throw new Error("Connect a compatible wallet before revealing the asset.");
      }

      const anchorProvider = new AnchorProvider(connection, anchorWallet, AnchorProvider.defaultOptions());
      const mxePublicKey = await getArciumMxePublicKey({
        provider: anchorProvider
      });

      stage = "unseal_arcium";
      const deliveryMaterial = product.sellerWallet && onchainProduct?.keyCommitmentHex
        ? await resolveVerifiedDeliveryMaterial({
            deliveryKeypair,
            deliveryEncryptionKey: onchain.arciumDeliveryEncryptionKey,
            mxePublicKey,
            deliveryNonce: onchain.arciumDeliveryNonce,
            deliveryCiphertexts: onchain.arciumDeliveryCiphertexts,
            expectedKeyCommitmentHex: onchainProduct.keyCommitmentHex,
            ciphertextHashHex: onchainProduct.ciphertextHashHex,
            productIdHex: product.productIdHex,
            sellerWallet: product.sellerWallet
          })
        : await revealArciumDeliveryMaterial({
            keypair: deliveryKeypair,
            deliveryEncryptionKey: onchain.arciumDeliveryEncryptionKey,
            mxePublicKey,
            deliveryNonce: onchain.arciumDeliveryNonce,
            deliveryCiphertexts: onchain.arciumDeliveryCiphertexts
          });

      stage = "metadata";
      const metadataResponse = await fetch(resolveMetadataUrl(product, onchainProduct), {
        method: "GET",
        cache: "no-store"
      });

      if (!metadataResponse.ok) {
        throw new Error("Failed to fetch listing metadata from storage.");
      }

      const metadata = (await metadataResponse.json()) as ProductMetadata;

      if (!metadata.ivBase64) {
        throw new Error("Listing metadata is missing the published IV.");
      }

      const publishedIv = base64ToBytes(metadata.ivBase64);

      stage = "ciphertext";
      const ciphertextUrl = resolveCiphertextUrl(product, onchain, onchainProduct);
      const response = await fetch(ciphertextUrl, {
        method: "GET",
        cache: "no-store"
      });

      if (!response.ok) {
        throw new Error("Failed to fetch ciphertext from storage.");
      }

      const ciphertext = new Uint8Array(await response.arrayBuffer());
      const ciphertextHashHex = await sha256Hex(ciphertext);
      const expectedCiphertextHashHex = resolveCiphertextHashHex(product, onchainProduct);

      if (ciphertextHashHex !== expectedCiphertextHashHex) {
        throw new Error("Downloaded ciphertext does not match the listing hash for this purchase.");
      }

      stage = "decrypt";
      const plaintext = await decryptCiphertext({
        ciphertext,
        contentKey: deliveryMaterial.contentKey,
        iv: publishedIv
      });
      stage = "consume_access";
      const { transaction } = await buildConsumeAccessTransaction({
        buyer: publicKey,
        listing: product,
        purchaseIdHex
      });
      const latestBlockhash = await connection.getLatestBlockhash();

      transaction.recentBlockhash = latestBlockhash.blockhash;
      transaction.feePayer = publicKey;

      stage = "wallet_approval";
      const consumeSignature = await sendTransaction(transaction, connection);

      stage = "confirm_consume_access";
      await confirmTransactionOrThrow({
        connection,
        signature: consumeSignature,
        blockhash: latestBlockhash.blockhash,
        lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
        label: "Consume access"
      });

      const blob = new Blob([toArrayBuffer(plaintext)], { type: product.mimeType });
      const objectUrl = URL.createObjectURL(blob);
      const downloadName = `${product.title.replace(/\s+/g, "-").toLowerCase()}`;

      setRevealedAssets((current) => {
        const existing = current[purchaseIdHex];

        if (existing) {
          URL.revokeObjectURL(existing.objectUrl);
        }

        return {
          ...current,
          [purchaseIdHex]: {
            downloadName,
            mimeType: product.mimeType,
            objectUrl
          }
        };
      });
      await persistPurchase({
        ...purchase,
        accessCount: purchase.accessCount + 1
      });
      refreshPurchases();
      showStatus("Reveal", "Asset decrypted successfully. Preview is ready below.", "success");
      return;
    } catch (cause) {
      setStatusToast(null);
      const message = cause instanceof Error ? cause.message : String(cause);
      if (message.includes("Failed to unseal delivery material")) {
        setError("Reveal failed because the buyer delivery keypair in this browser does not match the one used during checkout.");
      } else if (message.includes("owner public key does not match")) {
        setError("Reveal failed because the on-chain Arcium payload belongs to a different buyer delivery keypair.");
      } else if (message.includes("Arcium delivery commitment mismatch")) {
        setError("Reveal blocked because the on-chain Arcium payload no longer matches the purchase delivery commitment.");
      } else if (message.includes("product key commitment")) {
        setError("Reveal blocked because the Arcium-delivered content key no longer matches the product key that was published on-chain.");
      } else if (message.includes("Consume access failed on-chain")) {
        setError(`Reveal decrypted successfully, but consume access failed on-chain. ${message}`);
      } else if (stage === "wallet_approval" || stage === "confirm_consume_access") {
        setError(`Reveal decrypted successfully, but failed during ${stage}. ${message}`);
      } else if (
        message.includes("Failed to decrypt ciphertext") ||
        message.includes("Downloaded ciphertext does not match") ||
        message.includes("published IV") ||
        message.includes("Unexpected error")
      ) {
        setError("Reveal failed while decrypting the downloaded ciphertext. The on-chain Arcium payload does not match this encrypted file.");
      } else {
        setError(message || "Failed to reveal asset.");
      }
    } finally {
      setBusyPurchaseId(null);
    }
  }

  // Stats derived from purchaseCards
  const totalSpentSol = purchaseCards.reduce((sum, { purchase }) => sum + Number(purchase.amountSol), 0);
  const deliveredCount = purchaseCards.filter(({ purchase }) => {
    const onchain = onchainPurchaseStates[purchase.purchaseIdHex];
    const status = resolveEffectivePurchaseStatus(onchain, purchase.status);
    return status === "delivered" || status === "delivered_arcium";
  }).length;

  // Filtered purchase cards by status
  const filteredCards = purchaseCards.filter(({ purchase }) => {
    if (statusFilter === "all") return true;
    const onchain = onchainPurchaseStates[purchase.purchaseIdHex];
    const status = resolveEffectivePurchaseStatus(onchain, purchase.status);
    if (statusFilter === "delivered") return status === "delivered" || status === "delivered_arcium";
    if (statusFilter === "revoked") return status === "revoked";
    if (statusFilter === "waiting") return status !== "delivered" && status !== "delivered_arcium" && status !== "revoked";
    return true;
  });
  const historyCards = [...purchaseCards].sort((left, right) => Date.parse(right.purchase.createdAt) - Date.parse(left.purchase.createdAt));

  // ── Wallet guard ──────────────────────────────────────────
  if (!connectedWallet) {
    return (
      <div className="flex flex-col gap-4">
        <div className="flex flex-col items-center justify-center gap-4 rounded-[24px] border border-[color:var(--border)] bg-[color:var(--surface)] px-8 py-20 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-[22px] border border-[color:var(--border2)] bg-[rgba(5,10,20,0.6)] text-[#9B8FFF]">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
          </div>
          <div>
            <p className="font-head text-[15px] font-bold text-white">Wallet required</p>
            <p className="mt-1.5 max-w-[34ch] text-[12px] leading-5 text-[color:var(--text2)]">Connect your Solana wallet to view your purchased items.</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">

      {/* ── Page header ──────────────────────────────────────── */}
      <div className="overflow-hidden rounded-[28px] border border-[color:var(--border)] bg-[linear-gradient(135deg,rgba(107,80,255,0.18),rgba(12,21,37,0.98)_54%,rgba(6,182,212,0.12))] shadow-[0_24px_80px_rgba(3,7,18,0.45)]">
        <div className="flex flex-col gap-4 p-4 lg:flex-row lg:items-start lg:justify-between lg:p-5">
          <div className="flex min-w-0 items-start gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[18px] border border-white/10 bg-[rgba(5,10,20,0.42)] text-[#9B8FFF] backdrop-blur">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
            </div>
            <div className="min-w-0">
              <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#9B8FFF]">Library</p>
              <h1 className="mt-1 font-head text-[22px] font-bold tracking-[-0.03em] text-white sm:text-[28px]">Assets and history in one place.</h1>
              <p className="mt-2 max-w-2xl text-[13px] leading-6 text-[color:var(--text2)]">See assets that are ready to access, open purchase history, and review transaction trails without stacking too much detail on screen.</p>
            </div>
          </div>
          <div className="flex flex-col items-start gap-3 lg:items-end">
            <WalletAddress address={connectedWallet} shortened />
            <div className="inline-flex rounded-[18px] border border-[color:var(--border)] bg-[rgba(5,10,20,0.78)] p-1 backdrop-blur">
              {([
                { id: "assets", label: `Assets (${filteredCards.length})` },
                { id: "history", label: `History (${historyCards.length})` }
              ] as { id: LibraryTab; label: string }[]).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  className={`rounded-[14px] px-3.5 py-2 text-[10px] font-bold uppercase tracking-[0.12em] transition ${activeTab === tab.id ? "bg-[#6B50FF] text-white shadow-[0_10px_30px_rgba(107,80,255,0.28)]" : "text-[color:var(--text2)] hover:text-white"}`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ── Stats bar ────────────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {[
          { label: "Total assets", value: <span>{purchaseCards.length}</span> },
          { label: "Total spent", value: <span className="inline-flex items-end gap-1.5"><span>{totalSpentSol.toFixed(3)}</span><span className="pb-0.5 font-mono text-[13px] font-bold uppercase tracking-[0.08em] text-[color:var(--text2)]">SOL</span></span> },
          { label: "Delivered", value: <span>{deliveredCount}</span> }
        ].map(({ label, value }) => (
          <div key={label} className="rounded-[22px] border border-[color:var(--border)] bg-[rgba(12,21,37,0.84)] px-4 py-3.5 shadow-[0_18px_40px_rgba(3,7,18,0.28)]">
            <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-[color:var(--text3)]">{label}</span>
            <span className="mt-1.5 block font-head text-[22px] font-bold text-white">{value}</span>
          </div>
        ))}
      </div>

      {/* ── Callouts ─────────────────────────────────────────── */}
      {isArciumFinalizeBlocked ? (
        <div className="rounded-[20px] border border-[color:rgba(107,80,255,0.24)] bg-[rgba(13,16,27,0.84)] px-4 py-3 text-[12px] text-[color:var(--text2)]">
          <span className="font-bold uppercase tracking-[0.12em] text-[#9B8FFF]">Finalize unavailable</span>
          <p className="mt-1 leading-6">{getArciumFrontendBlockMessage("finalize")}</p>
        </div>
      ) : null}

      {/* ── Status filter pills ───────────────────────────────── */}
      {activeTab === "assets" ? (
        <div className="flex flex-wrap gap-1.5">
          {(["all", "waiting", "delivered", "revoked"] as StatusFilter[]).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setStatusFilter(f)}
              className={`rounded-full border px-3.5 py-1.5 text-[10px] font-bold uppercase tracking-[0.12em] transition ${
                statusFilter === f
                  ? "border-[#6B50FF] bg-[#6B50FF] text-white shadow-[0_10px_30px_rgba(107,80,255,0.24)]"
                  : "border-[color:var(--border2)] bg-transparent text-[color:var(--text2)] hover:border-white hover:text-white"
              }`}
            >
              {f}
              {f === "all" ? ` (${purchaseCards.length})` : null}
            </button>
          ))}
        </div>
      ) : null}

      {/* ── Purchase list ─────────────────────────────────────── */}
      {activeTab === "assets" ? (
      <div className="flex flex-col gap-px border border-[color:var(--border)] bg-[color:var(--border)]">
        {filteredCards.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 bg-[color:var(--surface)] p-16 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-[18px] border border-[color:var(--border2)] bg-[rgba(5,10,20,0.6)] text-[color:var(--text3)]">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg>
            </div>
            <div>
              <p className="text-[12px] font-bold text-white">{purchaseCards.length === 0 ? "No purchases yet" : "No items match this filter"}</p>
              <p className="mt-1 max-w-xs text-[12px] text-[color:var(--text2)]">{purchaseCards.length === 0 ? "Complete checkout from Explore to see items here." : "Try switching to a different filter."}</p>
            </div>
          </div>
        ) : (
          filteredCards.map(({ purchase, product }) => {
            const onchain = onchainPurchaseStates[purchase.purchaseIdHex];
            const onchainProduct = product ? onchainProductStates[product.productIdHex] : undefined;
            const effectiveStatus = resolveEffectivePurchaseStatus(onchain, purchase.status);
            const isPublishingWallet = Boolean(product?.sellerWallet && connectedWallet && product.sellerWallet === connectedWallet);
            const isPurchaseWallet = Boolean(purchase.buyerWallet && connectedWallet && purchase.buyerWallet === connectedWallet);
            const statusLabel = effectiveStatus === "prepared" ? "Prepared" : effectiveStatus === "revoked" ? "Revoked" : effectiveStatus === "delivered" || effectiveStatus === "delivered_arcium" ? "Delivered" : effectiveStatus === "pending_arcium" ? "Queued" : "Waiting";
            const statusBadgeVariant: "violet" | "red" | "amber" | "gray" | "cyan" = effectiveStatus === "revoked" ? "red" : effectiveStatus === "delivered" || effectiveStatus === "delivered_arcium" ? "cyan" : effectiveStatus === "pending_arcium" ? "violet" : "amber";
            const canReveal = isPurchaseWallet && (effectiveStatus === "delivered" || effectiveStatus === "delivered_arcium");
            const canFinalize = isPublishingWallet && effectiveStatus === "pending_seal";
            const canRevoke = isPublishingWallet && effectiveStatus !== "revoked" && product?.policy.revocable;
            const isBusy = busyPurchaseId === purchase.purchaseIdHex;
            const normalizedCategory = normalizeMarketplaceCategory(product?.category ?? "other");
            const hasStoredPublishQueueTx = Boolean(product?.publishSignature);
            const revealedAsset = revealedAssets[purchase.purchaseIdHex];
            const publishProofLabel = onchainProduct?.arciumCustodyReady || Boolean(purchase.transactionSignature) ? hasStoredPublishQueueTx ? "Stored" : "Legacy" : product?.publishSignature ? "Stored" : "Unavailable";
            const deliveryProofLabel = onchain?.arciumDeliveryReady ? "Settled" : purchase.finalizeSignature ? "Queued" : "Waiting";
            const statusHint = effectiveStatus === "delivered" || effectiveStatus === "delivered_arcium"
              ? "Ready to reveal from the frontend or download after preview." 
              : effectiveStatus === "pending_arcium"
                ? "Seller queued Arcium delivery."
                : effectiveStatus === "revoked"
                  ? "Access revoked by publisher."
                  : "Waiting for seller delivery.";

            return (
              <div key={purchase.purchaseIdHex} className="flex flex-col gap-3 bg-[color:var(--surface)] px-5 py-5 transition-colors hover:bg-[color:var(--surface2)]">
                <div className="flex items-start justify-between gap-4">
                  {/* Left: icon + content */}
                  <div className="flex min-w-0 flex-1 gap-4">
                    <div className="flex h-[72px] w-[72px] shrink-0 flex-col items-center justify-center gap-1.5 rounded-[22px] border border-[#2e254f] bg-[linear-gradient(180deg,#151225,#100d1d)] text-[#9B8FFF] shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
                      <CategoryIcon category={normalizedCategory} className="h-7 w-7" />
                      <span className="text-[7px] font-bold uppercase tracking-[0.12em] text-[color:var(--text3)]">{CATEGORY_LABELS[normalizedCategory]}</span>
                    </div>
                    <div className="min-w-0 flex-1 pt-0.5">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Badge variant={statusBadgeVariant}>{statusLabel}</Badge>
                      </div>
                      <h3 className="mt-2 truncate font-head text-[17px] font-bold leading-tight text-white">{product?.title ?? "Unknown listing"}</h3>
                      <p className="mt-1.5 text-[12px] leading-5 text-[color:var(--text2)]">{statusHint}</p>
                      <div className="mt-4 flex flex-wrap gap-x-6 gap-y-3 border-t border-[color:var(--border)] pt-4">
                        <div>
                          <p className="text-[9px] font-bold uppercase tracking-[0.12em] text-[color:var(--text3)]">Reveals</p>
                          <p className="mt-1 font-mono text-[13px] font-bold text-white">{onchain ? `${onchain.accessCount}/${onchain.maxAccessCount}` : `${purchase.accessCount}/${purchase.maxAccessCount}`}</p>
                        </div>
                        <div>
                          <p className="text-[9px] font-bold uppercase tracking-[0.12em] text-[color:var(--text3)]">Purchased</p>
                          <p className="mt-1 text-[12px] text-[color:var(--text2)]">{formatOptionalDateTime(purchase.createdAt) ?? "Unknown"}</p>
                        </div>
                        <div>
                          <p className="text-[9px] font-bold uppercase tracking-[0.12em] text-[color:var(--text3)]">Expires</p>
                          <p className="mt-1 text-[12px] text-[color:var(--text2)]">{formatOptionalDateTime(onchain?.expiresAt ? onchain.expiresAt * 1000 : purchase.expiresAt) ?? "Never"}</p>
                        </div>
                      </div>
                    </div>
                  </div>
                  {/* Right: price panel */}
                  <div className="shrink-0 text-right">
                    <p className="inline-flex items-baseline gap-1 font-mono text-[14px] font-bold text-white">
                      <span>{Number(purchase.amountSol).toFixed(3)}</span>
                      <span className="text-[11px] text-[color:var(--text2)]">SOL</span>
                    </p>
                  </div>
                </div>

                <details className="group mt-1 overflow-hidden rounded-[18px] border border-[color:var(--border)] bg-[rgba(5,10,20,0.45)]">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 [&::-webkit-details-marker]:hidden">
                    <div className="flex items-center gap-2">
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#6B50FF" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
                      <div>
                        <p className="text-[9px] font-bold uppercase tracking-[0.14em] text-[#9B8FFF]">Transaction details</p>
                      </div>
                    </div>
                    <span className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-[color:var(--border2)] text-[color:var(--text2)] transition group-hover:border-white group-hover:text-white">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>
                    </span>
                  </summary>
                  <div className="grid gap-3 border-t border-[color:var(--border)] p-4 sm:grid-cols-2 xl:grid-cols-3">
                    <div className="rounded-[16px] border border-[color:var(--border)] bg-[rgba(12,21,37,0.82)] p-3">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[9px] font-bold uppercase tracking-[0.12em] text-[color:var(--text3)]">Purchase tx</span>
                        <Badge variant={purchase.transactionSignature ? "green" : "gray"}>{purchase.transactionSignature ? "Stored" : "Missing"}</Badge>
                      </div>
                      <div className="mt-2 text-[11px] text-[color:var(--text2)]">
                        {purchase.transactionSignature ? (
                          <a href={explorerTxUrl(purchase.transactionSignature)} target="_blank" rel="noreferrer" className="font-mono text-[#9B8FFF] underline-offset-2 hover:underline">
                            {truncateValue(purchase.transactionSignature, 10, 10)}
                          </a>
                        ) : "Purchase signature not stored."}
                      </div>
                      <p className="mt-2 text-[11px] text-[color:var(--text3)]">This is the original buyer payment transaction used to create the purchase on-chain.</p>
                    </div>
                    <div className="rounded-[16px] border border-[color:var(--border)] bg-[rgba(12,21,37,0.82)] p-3">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[9px] font-bold uppercase tracking-[0.12em] text-[color:var(--text3)]">Publish tx</span>
                        <Badge variant={publishProofLabel === "Stored" ? "green" : publishProofLabel === "Legacy" ? "cyan" : "gray"}>{publishProofLabel}</Badge>
                      </div>
                      <div className="mt-2 text-[11px] text-[color:var(--text2)]">
                        {product?.publishSignature ? (
                          <a href={explorerTxUrl(product.publishSignature)} target="_blank" rel="noreferrer" className="font-mono text-[#9B8FFF] underline-offset-2 hover:underline">
                            {truncateValue(product.publishSignature, 10, 10)}
                          </a>
                        ) : onchainProduct?.arciumCustodyReady || purchase.transactionSignature ? "Legacy listing / publish tx not stored" : "Publish transaction not available yet."}
                      </div>
                      <p className="mt-2 text-[11px] text-[color:var(--text3)]">
                        {onchainProduct?.arciumCustodyReady && !hasStoredPublishQueueTx
                          ? "Listing custody is already settled on-chain, but the original publish signature was never persisted."
                          : product?.publishSignature
                            ? "This is the listing publish transaction. Buyer reveal depends on the delivery row, not this row."
                            : "This row tracks the listing publish transaction, not buyer delivery readiness."}
                      </p>
                    </div>
                    <div className="rounded-[16px] border border-[color:var(--border)] bg-[rgba(12,21,37,0.82)] p-3">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[9px] font-bold uppercase tracking-[0.12em] text-[color:var(--text3)]">Delivery tx</span>
                        <Badge variant={deliveryProofLabel === "Settled" ? "green" : deliveryProofLabel === "Queued" ? "violet" : "gray"}>{deliveryProofLabel}</Badge>
                      </div>
                      <div className="mt-2 text-[11px] text-[color:var(--text2)]">
                        {purchase.finalizeSignature ? (
                          <a href={explorerTxUrl(purchase.finalizeSignature)} target="_blank" rel="noreferrer" className="font-mono text-[#9B8FFF] underline-offset-2 hover:underline">
                            {truncateValue(purchase.finalizeSignature, 10, 10)}
                          </a>
                        ) : "Delivery transaction not sent yet."}
                      </div>
                      <p className="mt-2 text-[11px] text-[color:var(--text3)]">This is the seller delivery transaction. Reveal becomes available after this delivery settles on-chain.</p>
                    </div>
                  </div>
                </details>

                {canReveal || canFinalize || canRevoke ? (
                  <div className="flex flex-wrap gap-2 border-t border-[color:var(--border)] pt-3">
                    {canFinalize ? (
                      <Button variant="secondary" size="sm" type="button" onClick={() => void finalizeDelivery(purchase.purchaseIdHex)} disabled={isBusy} loading={isBusy}>
                        {isBusy ? "Finalizing..." : "Finalize delivery"}
                      </Button>
                    ) : null}
                    {canReveal ? (
                      <Button variant="violet" size="sm" type="button" onClick={() => void revealPurchase(purchase.purchaseIdHex)} disabled={isBusy} loading={isBusy}>
                        {isBusy ? "Revealing..." : revealedAsset ? "Reveal again" : "Reveal"}
                      </Button>
                    ) : null}
                    {canRevoke ? (
                      <Button variant="danger" size="sm" type="button" onClick={() => void revokePurchase(purchase.purchaseIdHex)} disabled={isBusy} loading={isBusy}>
                        {isBusy ? "Revoking..." : "Revoke"}
                      </Button>
                    ) : null}
                  </div>
                ) : null}

                {revealedAsset ? (
                  <div className="overflow-hidden rounded-[20px] border border-[color:var(--border)] bg-[rgba(5,10,20,0.45)]">
                    <div className="flex items-center justify-between gap-3 border-b border-[color:var(--border)] px-3 py-2">
                      <div>
                        <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#9B8FFF]">Revealed preview</p>
                        <p className="mt-1 text-[11px] text-[color:var(--text2)]">Rendered locally from the decrypted frontend payload.</p>
                      </div>
                      <Button variant="secondary" size="sm" type="button" onClick={() => downloadRevealedAsset(revealedAsset)}>
                        Download
                      </Button>
                    </div>
                    {revealedAsset.mimeType.startsWith("image/") ? (
                      <div className="bg-black/30 p-3">
                        <div className="relative mx-auto h-[360px] w-full overflow-hidden rounded-[16px] lg:h-[420px]">
                          <Image src={revealedAsset.objectUrl} alt={product?.title ?? "Revealed asset"} fill unoptimized className="object-contain" />
                        </div>
                      </div>
                    ) : revealedAsset.mimeType.startsWith("video/") ? (
                      <div className="bg-black/30 p-3">
                        <video src={revealedAsset.objectUrl} controls className="max-h-[420px] w-full rounded-[16px] bg-black object-contain" />
                      </div>
                    ) : revealedAsset.mimeType.startsWith("audio/") ? (
                      <div className="p-4">
                        <audio src={revealedAsset.objectUrl} controls className="w-full" />
                      </div>
                    ) : (
                      <div className="p-4">
                        <p className="text-[12px] text-[color:var(--text2)]">Preview is not available for this file type yet. Use Download to open the decrypted file.</p>
                      </div>
                    )}
                  </div>
                ) : null}
              </div>
            );
          })
        )}
      </div>
      ) : (
        <div className="flex flex-col gap-3">
          {historyCards.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 rounded-[24px] border border-[color:var(--border)] bg-[color:var(--surface)] p-16 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-[18px] border border-[color:var(--border2)] bg-[rgba(5,10,20,0.6)] text-[color:var(--text3)]">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
              </div>
              <div>
                <p className="text-[12px] font-bold text-white">No history yet</p>
                <p className="mt-1 max-w-xs text-[12px] text-[color:var(--text2)]">Purchase activity will appear here after checkout.</p>
              </div>
            </div>
          ) : (
            historyCards.map(({ purchase, product }) => {
              const onchain = onchainPurchaseStates[purchase.purchaseIdHex];
              const onchainProduct = product ? onchainProductStates[product.productIdHex] : undefined;
              const effectiveStatus = resolveEffectivePurchaseStatus(onchain, purchase.status);
              const statusLabel = effectiveStatus === "prepared" ? "Prepared" : effectiveStatus === "revoked" ? "Revoked" : effectiveStatus === "delivered" || effectiveStatus === "delivered_arcium" ? "Delivered" : effectiveStatus === "pending_arcium" ? "Queued" : "Waiting";
              const statusBadgeVariant: "violet" | "red" | "amber" | "gray" | "cyan" = effectiveStatus === "revoked" ? "red" : effectiveStatus === "delivered" || effectiveStatus === "delivered_arcium" ? "cyan" : effectiveStatus === "pending_arcium" ? "violet" : "amber";
              const publishHistoryLabel = onchainProduct?.arciumCustodyReady || Boolean(purchase.transactionSignature) ? (product?.publishSignature ? "Stored" : "Legacy") : product?.publishSignature ? "Stored" : "Unavailable";

              return (
                <details key={purchase.purchaseIdHex} className="group overflow-hidden rounded-[18px] border border-[color:var(--border)] bg-[color:var(--surface)] transition-colors hover:bg-[color:var(--surface2)]">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-4 [&::-webkit-details-marker]:hidden">
                    <div className="flex min-w-0 flex-1 items-center gap-3">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[14px] border border-[#2e254f] bg-[linear-gradient(180deg,#151225,#100d1d)] text-[#9B8FFF]">
                        <CategoryIcon category={normalizeMarketplaceCategory(product?.category ?? "other")} className="h-5 w-5" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <Badge variant={statusBadgeVariant}>{statusLabel}</Badge>
                        </div>
                        <h3 className="mt-1 truncate font-head text-[14px] font-bold text-white">{product?.title ?? "Unknown listing"}</h3>
                        <p className="mt-0.5 font-mono text-[11px] text-[color:var(--text2)]">{Number(purchase.amountSol).toFixed(3)} SOL · {formatOptionalDateTime(purchase.createdAt) ?? "Unknown"}</p>
                      </div>
                    </div>
                    <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-[color:var(--border2)] text-[color:var(--text2)] transition group-open:rotate-180 group-hover:border-white group-hover:text-white">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>
                    </span>
                  </summary>
                  <div className="grid gap-3 border-t border-[color:var(--border)] p-4 sm:grid-cols-2 xl:grid-cols-4">
                    <div className="rounded-[16px] border border-[color:var(--border)] bg-[rgba(12,21,37,0.82)] p-3">
                      <p className="text-[9px] font-bold uppercase tracking-[0.12em] text-[color:var(--text3)]">Purchase tx</p>
                      <div className="mt-2 text-[11px] text-[color:var(--text2)]">{purchase.transactionSignature ? <a href={explorerTxUrl(purchase.transactionSignature)} target="_blank" rel="noreferrer" className="font-mono text-[#9B8FFF] underline-offset-2 hover:underline">{truncateValue(purchase.transactionSignature, 10, 10)}</a> : "Not stored"}</div>
                      <p className="mt-2 text-[11px] text-[color:var(--text3)]">Original buyer payment transaction.</p>
                    </div>
                    <div className="rounded-[16px] border border-[color:var(--border)] bg-[rgba(12,21,37,0.82)] p-3">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-[9px] font-bold uppercase tracking-[0.12em] text-[color:var(--text3)]">Publish tx</p>
                        <Badge variant={publishHistoryLabel === "Stored" ? "green" : publishHistoryLabel === "Legacy" ? "cyan" : "gray"}>{publishHistoryLabel}</Badge>
                      </div>
                      <div className="mt-2 text-[11px] text-[color:var(--text2)]">{product?.publishSignature ? <a href={explorerTxUrl(product.publishSignature)} target="_blank" rel="noreferrer" className="font-mono text-[#9B8FFF] underline-offset-2 hover:underline">{truncateValue(product.publishSignature, 10, 10)}</a> : onchainProduct?.arciumCustodyReady ? "Legacy listing already settled" : "Not stored"}</div>
                    </div>
                    <div className="rounded-[16px] border border-[color:var(--border)] bg-[rgba(12,21,37,0.82)] p-3">
                      <p className="text-[9px] font-bold uppercase tracking-[0.12em] text-[color:var(--text3)]">Delivery tx</p>
                      <div className="mt-2 text-[11px] text-[color:var(--text2)]">{purchase.finalizeSignature ? <a href={explorerTxUrl(purchase.finalizeSignature)} target="_blank" rel="noreferrer" className="font-mono text-[#9B8FFF] underline-offset-2 hover:underline">{truncateValue(purchase.finalizeSignature, 10, 10)}</a> : "Not sent"}</div>
                      <p className="mt-2 text-[11px] text-[color:var(--text3)]">Seller delivery transaction for this purchase.</p>
                    </div>
                    <div className="rounded-[16px] border border-[color:var(--border)] bg-[rgba(12,21,37,0.82)] p-3">
                      <p className="text-[9px] font-bold uppercase tracking-[0.12em] text-[color:var(--text3)]">Purchase id</p>
                      <div className="mt-2 font-mono text-[11px] text-[color:var(--text2)]">{truncateValue(purchase.purchaseIdHex, 12, 12)}</div>
                    </div>
                  </div>
                </details>
              );
            })
          )}
        </div>
      )}

      <NoticeToast message={error} open={Boolean(error)} onClose={() => setError(null)} />
      <NoticeToast message={statusToast?.message ?? null} title={statusToast?.title} variant={statusToast?.variant ?? "info"} open={Boolean(statusToast)} onClose={() => setStatusToast(null)} />
    </div>
  );
}
