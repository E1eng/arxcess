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
import { SolLogo } from "@/components/ui/SolLogo";

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

type LibraryTab = "inbox" | "purchases" | "sales" | "history";
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
  const [activeTab, setActiveTab] = useState<LibraryTab>("inbox");

  const [revealedAssets, setRevealedAssets] = useState<Record<string, RevealedAsset>>({});
  const [onchainPurchaseStates, setOnchainPurchaseStates] = useState<Record<string, DecodedPurchaseState>>({});
  const [onchainProductStates, setOnchainProductStates] = useState<Record<string, DecodedProductState>>({});

  // Show purchases relevant to the connected wallet as buyer or seller
  const myPurchases = useMemo(
    () => {
      if (!connectedWallet) {
        return [];
      }

      const relevantPurchases = purchases.filter((p) => p.buyerWallet === connectedWallet || p.sellerWallet === connectedWallet);
      const uniquePurchases = new Map<string, LocalPurchaseIntent>();

      relevantPurchases.forEach((purchase) => {
        uniquePurchases.set(purchase.purchaseIdHex, purchase);
      });

      return [...uniquePurchases.values()];
    },
    [purchases, connectedWallet]
  );

  const purchaseCards = useMemo(
    () => myPurchases.map((purchase) => ({
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
  const totalSpentSol = purchaseCards.reduce((sum, { purchase }) => {
    if (purchase.buyerWallet !== connectedWallet) {
      return sum;
    }

    return sum + Number(purchase.amountSol);
  }, 0);
  const deliveredCount = purchaseCards.filter(({ purchase }) => {
    const onchain = onchainPurchaseStates[purchase.purchaseIdHex];
    const status = resolveEffectivePurchaseStatus(onchain, purchase.status);
    return status === "delivered" || status === "delivered_arcium";
  }).length;

  const cardEntries = [...purchaseCards].map(({ purchase, product }) => {
    const onchain = onchainPurchaseStates[purchase.purchaseIdHex];
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
    const revealedAsset = revealedAssets[purchase.purchaseIdHex];
    const statusHint = effectiveStatus === "delivered" || effectiveStatus === "delivered_arcium"
      ? isPurchaseWallet ? "Ready to reveal or download from your buyer wallet." : "Delivery has settled for this buyer."
      : effectiveStatus === "pending_arcium"
        ? "Arcium delivery has been queued and is waiting for callback settlement."
        : effectiveStatus === "revoked"
          ? "Access was revoked by the seller."
          : isPublishingWallet
            ? "Buyer has purchased this listing. Finalize delivery when ready."
            : "Waiting for the seller to finalize delivery.";

    return {
      purchase,
      product,
      onchain,
      effectiveStatus,
      isPublishingWallet,
      isPurchaseWallet,
      statusLabel,
      statusBadgeVariant,
      canReveal,
      canFinalize,
      canRevoke,
      isBusy,
      normalizedCategory,
      revealedAsset,
      statusHint
    };
  }).sort((left, right) => Date.parse(right.purchase.createdAt) - Date.parse(left.purchase.createdAt));

  const inboxSellerCards = cardEntries.filter((entry) => entry.isPublishingWallet && (entry.canFinalize || entry.effectiveStatus === "pending_arcium"));
  const inboxBuyerCards = cardEntries.filter((entry) => entry.isPurchaseWallet && (entry.canReveal || Boolean(entry.revealedAsset)));
  const purchaseViewCards = cardEntries.filter((entry) => entry.isPurchaseWallet);
  const salesViewCards = cardEntries.filter((entry) => entry.isPublishingWallet);
  const historyCards = cardEntries;
  const inboxCount = inboxSellerCards.length + inboxBuyerCards.length;
  const currentAssetCards = activeTab === "inbox"
    ? [...inboxSellerCards, ...inboxBuyerCards]
    : activeTab === "purchases"
      ? purchaseViewCards
      : salesViewCards;

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
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0">
            <p className="text-[11px] font-bold uppercase tracking-widest text-[#5e5e73]">Library</p>
            <h1 className="mt-1 font-head text-[28px] font-bold tracking-tight text-white sm:text-[32px]">Track your assets and history here.</h1>
            <p className="mt-2 max-w-2xl text-[14px] leading-relaxed text-[#8b8b9d]">See assets that are ready to access, open purchase history, and review transaction trails without stacking too much detail on screen.</p>
          </div>
          <div className="flex items-center gap-3">
            <WalletAddress address={connectedWallet} shortened />
          </div>
        </div>

        {/* ── Stats bar ────────────────────────────────────────── */}
       <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {[
            { label: "Total assets", value: <span>{purchaseCards.length}</span>, icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/></svg> },
            { label: "Total spent", value: <span className="inline-flex items-baseline gap-2"><span className="text-[24px] font-bold text-white">{totalSpentSol.toFixed(3)}</span><SolLogo size={16} /></span>, icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8"/><path d="M12 18V6"/></svg> },
            { label: "Delivered", value: <span>{deliveredCount}</span>, icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.59-9.21l-5.64-5.64"/></svg> }
          ].map(({ label, value, icon }) => (
            <div key={label} className="flex flex-col gap-4 rounded-2xl border border-[#1a1a2e] bg-gradient-to-br from-[#0b0b12] to-[#131320] p-5">
              <div className="flex items-center justify-between text-[#5e5e73]">
                <span className="text-[10px] font-bold uppercase tracking-widest">{label}</span>
                {icon}
              </div>
              <div className="font-mono text-[24px] font-bold text-white">{value}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Tabs & Filters ───────────────────────────────────── */}
      <div className="mt-2 flex flex-col gap-4 border-b border-[#1a1a2e] pb-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          {([
            { id: "inbox", label: "Inbox", count: inboxCount },
            { id: "purchases", label: "Purchases", count: purchaseViewCards.length },
            { id: "sales", label: "Sales", count: salesViewCards.length },
            { id: "history", label: "History", count: historyCards.length }
          ] as { id: LibraryTab; label: string; count: number }[]).map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`rounded-lg px-5 py-2.5 text-[12px] font-bold uppercase tracking-wider transition-all ${activeTab === tab.id ? "bg-purple-500/10 text-purple-400 border border-purple-500/30" : "bg-transparent text-[#5e5e73] hover:text-white"}`}
            >
              {tab.label} ({tab.count})
            </button>
          ))}
        </div>

        <p className="text-[12px] text-[#8b8b9d]">
          {activeTab === "inbox" ? "Action-first view for pending deliveries and ready reveals." : activeTab === "purchases" ? "Everything you bought with this wallet." : activeTab === "sales" ? "Orders for listings published by this wallet." : "Full audit trail across buyer and seller roles."}
        </p>
      </div>

      {/* ── Callouts ─────────────────────────────────────────── */}
      {isArciumFinalizeBlocked ? (
        <div className="rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-[13px] text-red-400">
          <span className="font-bold uppercase tracking-wider">Finalize unavailable</span>
          <p className="mt-1 leading-relaxed opacity-90">{getArciumFrontendBlockMessage("finalize")}</p>
        </div>
      ) : null}

      {/* ── Purchase list ─────────────────────────────────────── */}
      {activeTab !== "history" ? (
      <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
        {currentAssetCards.length === 0 ? (
          <div className="col-span-full flex flex-col items-center justify-center gap-4 rounded-2xl border border-dashed border-[#2e2e48] bg-[#0b0b12] p-16 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-[#1a1a2e] text-[#5e5e73]">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg>
            </div>
            <div>
              <p className="text-[14px] font-bold text-white">{activeTab === "inbox" ? "Inbox is clear" : activeTab === "purchases" ? "No purchases yet" : "No sales yet"}</p>
              <p className="mt-1 max-w-sm text-[13px] text-[#8b8b9d]">{activeTab === "inbox" ? "New actions will appear here when buyers need delivery or purchased items are ready to reveal." : activeTab === "purchases" ? "Complete checkout from Explore to see buyer assets here." : "Orders for listings published by this wallet will appear here."}</p>
            </div>
          </div>
        ) : (
          currentAssetCards.map(({ purchase, product }) => {
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
              <div key={purchase.purchaseIdHex} className="group flex flex-col overflow-hidden rounded-2xl border border-[#1a1a2e] bg-[#0b0b12] transition-all hover:-translate-y-1 hover:border-purple-500/30 hover:shadow-[0_8px_30px_rgba(107,80,255,0.1)]">
                
                {/* Card Header (Category & Badges) */}
                <div className="flex items-center justify-between border-b border-[#1a1a2e] bg-gradient-to-r from-[#131320] to-transparent px-5 py-4">
                  <div className="flex items-center gap-2.5">
                    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-purple-500/10 text-purple-400">
                      <CategoryIcon category={normalizedCategory} className="h-4 w-4" />
                    </div>
                    <span className="text-[11px] font-bold uppercase tracking-widest text-[#8b8b9d]">{CATEGORY_LABELS[normalizedCategory]}</span>
                  </div>
                  <Badge variant={statusBadgeVariant}>{statusLabel}</Badge>
                </div>

                {/* Card Body */}
                <div className="flex-1 p-5">
                  <h3 className="truncate font-head text-[18px] font-bold leading-tight text-white group-hover:text-purple-400 transition-colors">{product?.title ?? "Unknown listing"}</h3>
                  <p className="mt-2 text-[13px] leading-relaxed text-[#8b8b9d] line-clamp-2">{statusHint}</p>
                  
                  {/* Detail list rows */}
                  <div className="mt-5 flex flex-col">
                    {[
                      ["Reveals", onchain ? `${onchain.accessCount}/${onchain.maxAccessCount}` : `${purchase.accessCount}/${purchase.maxAccessCount}`],
                      ["Price", `${Number(purchase.amountSol).toFixed(3)}`],
                      ["Purchased", formatOptionalDateTime(purchase.createdAt) ?? "Unknown"],
                      ["Expires", formatOptionalDateTime(onchain?.expiresAt ? onchain.expiresAt * 1000 : purchase.expiresAt) ?? "Never"]
                    ].map(([label, value]) => (
                      <div key={label} className="flex items-center justify-between border-b border-[#1a1a2e] py-3 last:border-0">
                        <span className="text-[12px] font-medium text-[#5e5e73]">{label}</span>
                        <span className="flex items-center gap-1 text-[12px] font-bold text-white">{label === "Price" ? <><span>{value}</span><SolLogo size={11} className="text-purple-400" /></> : value}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Card Footer (Actions) */}
                <div className="border-t border-[#1a1a2e] bg-[#131320] p-4">
                  <div className="flex flex-col gap-3">
                    {canReveal || canFinalize || canRevoke ? (
                      <div className="flex flex-wrap gap-2">
                        {canFinalize ? (
                          <button type="button" onClick={() => void finalizeDelivery(purchase.purchaseIdHex)} disabled={isBusy} className="flex-1 rounded-lg border border-[#2e2e48] bg-[#1a1a2e] px-4 py-2 text-[12px] font-bold text-white transition-colors hover:bg-[#2e2e48] disabled:opacity-50">
                            {isBusy ? "Finalizing..." : "Finalize delivery"}
                          </button>
                        ) : null}
                        {canReveal ? (
                          <button type="button" onClick={() => void revealPurchase(purchase.purchaseIdHex)} disabled={isBusy} className="flex-1 rounded-lg bg-gradient-to-r from-purple-600 to-purple-500 px-4 py-2 text-[12px] font-bold text-white shadow-[0_0_15px_rgba(168,85,247,0.4)] transition-all hover:scale-[1.02] disabled:opacity-50">
                            {isBusy ? "Revealing..." : revealedAsset ? "Reveal again" : "Reveal"}
                          </button>
                        ) : null}
                        {canRevoke ? (
                          <button type="button" onClick={() => void revokePurchase(purchase.purchaseIdHex)} disabled={isBusy} className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-2 text-[12px] font-bold text-red-400 transition-colors hover:bg-red-500/20 disabled:opacity-50">
                            {isBusy ? "Revoking..." : "Revoke"}
                          </button>
                        ) : null}
                      </div>
                    ) : null}

                    {/* Tx Details Accordion */}
                    <details className="group overflow-hidden rounded-lg border border-[#1a1a2e] bg-[#0b0b12]">
                      <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-2.5 [&::-webkit-details-marker]:hidden">
                        <span className="text-[10px] font-bold uppercase tracking-widest text-[#5e5e73] group-hover:text-purple-400 transition-colors">Transaction Details</span>
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-[#5e5e73] transition-transform group-open:rotate-180"><polyline points="6 9 12 15 18 9"/></svg>
                      </summary>
                      <div className="grid gap-2 border-t border-[#1a1a2e] bg-[#131320] p-3 text-[11px]">
                        <div className="flex items-center justify-between">
                          <span className="text-[#5e5e73]">Purchase Tx:</span>
                          {purchase.transactionSignature ? (
                            <a href={explorerTxUrl(purchase.transactionSignature)} target="_blank" rel="noreferrer" className="font-mono text-purple-400 hover:text-purple-300">
                              {truncateValue(purchase.transactionSignature, 8, 8)}
                            </a>
                          ) : <span className="text-[#8b8b9d]">Not stored</span>}
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-[#5e5e73]">Publish Tx:</span>
                          {product?.publishSignature ? (
                            <a href={explorerTxUrl(product.publishSignature)} target="_blank" rel="noreferrer" className="font-mono text-purple-400 hover:text-purple-300">
                              {truncateValue(product.publishSignature, 8, 8)}
                            </a>
                          ) : <span className="text-[#8b8b9d]">Not stored</span>}
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-[#5e5e73]">Delivery Tx:</span>
                          {purchase.finalizeSignature ? (
                            <a href={explorerTxUrl(purchase.finalizeSignature)} target="_blank" rel="noreferrer" className="font-mono text-purple-400 hover:text-purple-300">
                              {truncateValue(purchase.finalizeSignature, 8, 8)}
                            </a>
                          ) : <span className="text-[#8b8b9d]">Not sent</span>}
                        </div>
                      </div>
                    </details>
                  </div>
                </div>

                {/* Revealed Asset Preview */}
                {revealedAsset ? (
                  <div className="border-t border-[#1a1a2e] bg-black">
                    <div className="flex items-center justify-between px-4 py-3">
                      <span className="text-[10px] font-bold uppercase tracking-widest text-purple-400">Revealed Preview</span>
                      <button onClick={() => downloadRevealedAsset(revealedAsset)} className="text-[12px] font-bold text-white hover:text-purple-400 transition-colors">
                        Download ↓
                      </button>
                    </div>
                    {revealedAsset.mimeType.startsWith("image/") ? (
                      <div className="relative h-[240px] w-full border-t border-[#1a1a2e]">
                        <Image src={revealedAsset.objectUrl} alt={product?.title ?? "Revealed asset"} fill unoptimized className="object-contain p-2" />
                      </div>
                    ) : revealedAsset.mimeType.startsWith("video/") ? (
                      <div className="border-t border-[#1a1a2e] p-2">
                        <video src={revealedAsset.objectUrl} controls className="h-full w-full rounded-lg bg-black" />
                      </div>
                    ) : (
                      <div className="border-t border-[#1a1a2e] p-4 text-center text-[12px] text-[#8b8b9d]">
                        Preview unavailable. Please download the file.
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
        <div className="flex flex-col gap-4">
          {historyCards.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-4 rounded-2xl border border-dashed border-[#2e2e48] bg-[#0b0b12] p-16 text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-[#1a1a2e] text-[#5e5e73]">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
              </div>
              <div>
                <p className="text-[14px] font-bold text-white">No history yet</p>
                <p className="mt-1 max-w-sm text-[13px] text-[#8b8b9d]">Purchase activity will appear here after checkout.</p>
              </div>
            </div>
          ) : (
            historyCards.map(({ purchase, product }) => {
              const onchain = onchainPurchaseStates[purchase.purchaseIdHex];
              const effectiveStatus = resolveEffectivePurchaseStatus(onchain, purchase.status);
              const statusLabel = effectiveStatus === "prepared" ? "Prepared" : effectiveStatus === "revoked" ? "Revoked" : effectiveStatus === "delivered" || effectiveStatus === "delivered_arcium" ? "Delivered" : effectiveStatus === "pending_arcium" ? "Queued" : "Waiting";
              const statusBadgeVariant: "violet" | "red" | "amber" | "gray" | "cyan" = effectiveStatus === "revoked" ? "red" : effectiveStatus === "delivered" || effectiveStatus === "delivered_arcium" ? "cyan" : effectiveStatus === "pending_arcium" ? "violet" : "amber";

              return (
                <details key={purchase.purchaseIdHex} className="group overflow-hidden rounded-xl border border-[#1a1a2e] bg-[#0b0b12] transition-colors hover:border-purple-500/30">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-6 py-5 [&::-webkit-details-marker]:hidden">
                    <div className="flex min-w-0 flex-1 items-center gap-4">
                      <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-purple-500/10 text-purple-400">
                        <CategoryIcon category={normalizeMarketplaceCategory(product?.category ?? "other")} className="h-5 w-5" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2 mb-1">
                          <Badge variant={statusBadgeVariant}>{statusLabel}</Badge>
                          <span className="text-[11px] text-[#5e5e73]">{formatOptionalDateTime(purchase.createdAt) ?? "Unknown date"}</span>
                        </div>
                        <h3 className="truncate text-[15px] font-bold text-white">{product?.title ?? "Unknown listing"}</h3>
                        <p className="mt-1 flex items-center gap-1 font-mono text-[12px] text-[#8b8b9d]">{Number(purchase.amountSol).toFixed(3)}<SolLogo size={10} className="text-[#8b8b9d]" /></p>
                      </div>
                    </div>
                    <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#1a1a2e] text-[#5e5e73] transition-transform group-open:rotate-180 group-hover:text-white">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
                    </span>
                  </summary>
                  
                  <div className="grid gap-2 border-t border-[#1a1a2e] bg-[#131320] p-4 text-[12px]">
                    <div className="flex items-center justify-between">
                      <span className="text-[#5e5e73]">Purchase Tx</span>
                      {purchase.transactionSignature ? <a href={explorerTxUrl(purchase.transactionSignature)} target="_blank" rel="noreferrer" className="font-mono text-purple-400 hover:text-purple-300">{truncateValue(purchase.transactionSignature, 12, 12)}</a> : <span className="text-[#8b8b9d]">Not stored</span>}
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-[#5e5e73]">Publish Tx</span>
                      {product?.publishSignature ? <a href={explorerTxUrl(product?.publishSignature)} target="_blank" rel="noreferrer" className="font-mono text-purple-400 hover:text-purple-300">{truncateValue(product.publishSignature, 12, 12)}</a> : <span className="text-[#8b8b9d]">Not stored</span>}
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-[#5e5e73]">Delivery Tx</span>
                      {purchase.finalizeSignature ? <a href={explorerTxUrl(purchase.finalizeSignature)} target="_blank" rel="noreferrer" className="font-mono text-purple-400 hover:text-purple-300">{truncateValue(purchase.finalizeSignature, 12, 12)}</a> : <span className="text-[#8b8b9d]">Not sent</span>}
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
