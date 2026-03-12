"use client";

import { useEffect, useMemo, useState } from "react";
import { AnchorProvider } from "@coral-xyz/anchor";
import { useAnchorWallet, useConnection, useWallet } from "@solana/wallet-adapter-react";
import { type ProductMetadata } from "@arxcess/sdk";
import { PublicKey } from "@solana/web3.js";
import { createArciumDeliveryCommitmentHex, getArciumFrontendBlockMessage, getArciumMxePublicKey, isArciumFrontendRuntimeReady, revealArciumDeliveryMaterial } from "@/lib/arcium/client";
import { NoticeToast } from "@/components/ui/notice-toast";
import { decryptCiphertext, sha256Hex } from "@/lib/crypto/content";
import { base64ToBytes, bytesToHex, hexToBytes } from "@/lib/utils/bytes";
import { type DeliveryKeypair } from "@/lib/crypto/delivery";
import { hasConfiguredProgramId } from "@/lib/anchor/client";
import { confirmTransactionOrThrow } from "@/lib/solana/transactions";
import { useProducts } from "@/hooks/use-products";
import { useDeliveryKeys } from "@/hooks/use-delivery-keys";
import { usePurchases } from "@/hooks/use-purchases";
import { fetchOnchainProductStates, fetchOnchainPurchaseStates, type DecodedProductState, type DecodedPurchaseState } from "@/lib/solana/account-state";
import { buildConsumeAccessTransaction, buildRequestEvaluateAndSealTransaction, buildRevokePurchaseTransaction } from "@/lib/solana/arxcess";
import { getStoredPurchase, saveStoredPurchase } from "@/lib/storage/marketplace";
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
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [onchainProductStates, setOnchainProductStates] = useState<Record<string, DecodedProductState>>({});
  const [onchainPurchaseStates, setOnchainPurchaseStates] = useState<Record<string, DecodedPurchaseState>>({});
  const [revealedPurchaseId, setRevealedPurchaseId] = useState<string | null>(null);
  const purchaseCards = useMemo(
    () =>
      purchases.map((purchase) => ({
        purchase,
        product: products.find((product) => product.productIdHex === purchase.productIdHex) ?? null
      })),
    [products, purchases]
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
    setStatusMessage("Preparing Arcium delivery finalization...");

    try {
      const onchain = onchainPurchaseStates[purchaseIdHex];
      const effectiveStatus = resolveEffectivePurchaseStatus(onchain, purchase.status);

      if (!onchain) {
        throw new Error("On-chain purchase state is not available yet. Wait for Library to refresh, then try finalizing again.");
      }

      if (effectiveStatus === "pending_arcium") {
        setStatusMessage("Arcium delivery is already queued. Wait for the confidential callback to settle on-chain.");
        return;
      }

      if (effectiveStatus === "delivered_arcium" || effectiveStatus === "delivered") {
        setStatusMessage("Delivery is already finalized. The buyer can reveal it now.");
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

      saveStoredPurchase({
        ...purchase,
        finalizeSignature,
        deliveryMode: "arcium",
        status: "pending_seal"
      });
      refreshPurchases();
      setStatusMessage("Arcium delivery request queued. Wait for the confidential callback to settle on-chain.");
    } catch (cause) {
      setStatusMessage(null);
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
    setStatusMessage("Submitting revoke transaction...");

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

      saveStoredPurchase({
        ...purchase,
        status: "revoked",
        revokedAt: new Date().toISOString(),
        finalizeSignature: purchase.finalizeSignature ?? revokeSignature
      });
      refreshPurchases();
      setStatusMessage("Access revoked successfully. Future reveals are now blocked for this purchase.");
    } catch (cause) {
      setStatusMessage(null);
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
    setStatusMessage("Preparing secure reveal...");

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
      const deliveryMaterial = await revealArciumDeliveryMaterial({
        keypair: deliveryKeypair,
        deliveryEncryptionKey: onchain.arciumDeliveryEncryptionKey,
        mxePublicKey,
        deliveryNonce: onchain.arciumDeliveryNonce,
        deliveryCiphertexts: onchain.arciumDeliveryCiphertexts
      });

      if (product.sellerWallet && onchainProduct?.keyCommitmentHex) {
        const derivedKeyCommitmentHex = await deriveListingKeyCommitmentHex({
          contentKey: deliveryMaterial.contentKey,
          ciphertextHashHex: onchainProduct.ciphertextHashHex,
          productIdHex: product.productIdHex,
          sellerWallet: product.sellerWallet
        });

        if (derivedKeyCommitmentHex !== onchainProduct.keyCommitmentHex) {
          throw new Error("Arcium delivery content key does not match the on-chain product key commitment.");
        }
      }

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

      stage = "download";
      const blob = new Blob([toArrayBuffer(plaintext)], { type: product.mimeType });
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");

      link.href = objectUrl;
      link.download = `${product.title.replace(/\s+/g, "-").toLowerCase()}`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(objectUrl);
      saveStoredPurchase({
        ...purchase,
        accessCount: purchase.accessCount + 1
      });
      refreshPurchases();
      setRevealedPurchaseId(purchaseIdHex);
      setStatusMessage("Asset decrypted successfully. Secure download started automatically.");
      return;
    } catch (cause) {
      setStatusMessage(null);
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
      } else if (stage === "wallet_approval" || stage === "confirm_consume_access" || stage === "download") {
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

  return (
    <div className="grid">
      <section className="card surface page-intro">
        <div className="page-intro__top">
          <div>
            <span className="eyebrow">Library</span>
            <h2 className="section-title">Open delivered purchases</h2>
            <p className="muted">When delivery is ready, reveal and download your item from here.</p>
          </div>
          <div className="page-intro__meta">
            <span className="badge badge--neutral">Connected wallet: {connectedWallet ? truncateValue(connectedWallet, 12, 10) : "not connected"}</span>
            <span className="badge badge--neutral">Custody: {hasPurchases ? "Arcium" : "No purchases yet"}</span>
          </div>
        </div>
      </section>

      {isArciumFinalizeBlocked ? (
        <div className="callout callout--info">
          <strong>Arcium delivery queue is unavailable</strong>
          <span className="muted">{getArciumFrontendBlockMessage("finalize")}</span>
        </div>
      ) : null}

      {statusMessage ? (
        <div className="callout callout--success">
          <strong>Status</strong>
          <span className="muted">{statusMessage}</span>
        </div>
      ) : null}

      <div className="card surface">
        <div>
          <div>
            <h2 className="section-title">Library</h2>
            <p className="muted">Everything you bought appears here.</p>
          </div>
        </div>
        {purchaseCards.length === 0 ? (
          <span className="muted">No purchases yet. Complete checkout from Explore to see items here.</span>
        ) : (
          <div className="catalog-grid">
            {purchaseCards.map(({ purchase, product }) => {
              const onchain = onchainPurchaseStates[purchase.purchaseIdHex];
              const effectiveStatus = resolveEffectivePurchaseStatus(onchain, purchase.status);
              const isPublishingWallet = Boolean(product?.sellerWallet && connectedWallet && product.sellerWallet === connectedWallet);
              const isPurchaseWallet = Boolean(purchase.buyerWallet && connectedWallet && purchase.buyerWallet === connectedWallet);

              return (
                <div key={purchase.purchaseIdHex} className="card surface product-card">
                  <div className="asset-stage__media product-card__media">
                    <div className="row">
                      <span className="badge">{product?.category ?? "purchase"}</span>
                      <span className="badge badge--neutral">{effectiveStatus === "prepared" ? "Prepared" : effectiveStatus === "revoked" ? "Revoked" : effectiveStatus === "delivered" ? "Delivered" : effectiveStatus === "delivered_arcium" ? "Delivered on-chain" : effectiveStatus === "pending_arcium" ? "Arcium queued" : "Waiting delivery"}</span>
                    </div>
                    <strong>{product?.title ?? "Unknown listing"}</strong>
                    <span className="muted">{product?.description ?? "The matching product data is not available in local storage."}</span>
                    <span className="asset-stage__lock">
                      {effectiveStatus === "prepared"
                        ? "Payment has not been executed yet."
                        : effectiveStatus === "revoked"
                          ? "Access was revoked."
                        : effectiveStatus === "delivered"
                            ? "Ready to reveal and download."
                          : effectiveStatus === "pending_arcium"
                            ? "Seller queued confidential delivery and is waiting for the callback to settle on-chain."
                          : effectiveStatus === "delivered_arcium"
                            ? "Delivery callback completed on-chain. Reveal now decrypts the Arcium payload directly from purchase state."
                            : "Waiting for publisher delivery."}
                    </span>
                  </div>
                  <div className="detail-list">
                    <div className="detail-row">
                      <span className="muted">Amount</span>
                      <strong>{purchase.amountSol} SOL</strong>
                    </div>
                    <div className="detail-row">
                      <span className="muted">Publisher</span>
                      <strong>{product?.sellerWallet ? truncateValue(product.sellerWallet) : "Unknown"}</strong>
                    </div>
                    <div className="detail-row">
                      <span className="muted">Access used</span>
                      <strong>{onchain ? `${onchain.accessCount}/${onchain.maxAccessCount}` : `${purchase.accessCount}/${purchase.maxAccessCount}`}</strong>
                    </div>
                    <div className="detail-row">
                      <span className="muted">Expires</span>
                      <strong>{formatOptionalDateTime(onchain?.expiresAt ? onchain.expiresAt * 1000 : purchase.expiresAt) ?? "No expiry"}</strong>
                    </div>
                    <div className="detail-row">
                      <span className="muted">Revocable</span>
                      <strong>{product?.policy.revocable ? "Yes" : "No"}</strong>
                    </div>
                    <div className="detail-row">
                      <span className="muted">Custody</span>
                      <strong>Arcium</strong>
                    </div>
                  </div>
                  {isPublishingWallet || isPurchaseWallet ? (
                    <div className="row">
                      {isPublishingWallet && effectiveStatus === "pending_seal" ? (
                        <button className="button secondary" type="button" onClick={() => void finalizeDelivery(purchase.purchaseIdHex)} disabled={busyPurchaseId === purchase.purchaseIdHex}>
                          {busyPurchaseId === purchase.purchaseIdHex ? "Finalizing..." : "Finalize delivery"}
                        </button>
                      ) : null}
                      {isPurchaseWallet && (effectiveStatus === "delivered" || effectiveStatus === "delivered_arcium") ? (
                        <button className="button" type="button" onClick={() => void revealPurchase(purchase.purchaseIdHex)} disabled={busyPurchaseId === purchase.purchaseIdHex}>
                          {busyPurchaseId === purchase.purchaseIdHex ? "Revealing..." : revealedPurchaseId === purchase.purchaseIdHex ? "Download again" : "Reveal & download"}
                        </button>
                      ) : null}
                      {isPublishingWallet && effectiveStatus !== "revoked" && product?.policy.revocable ? (
                        <button className="button secondary" type="button" onClick={() => void revokePurchase(purchase.purchaseIdHex)} disabled={busyPurchaseId === purchase.purchaseIdHex}>
                          {busyPurchaseId === purchase.purchaseIdHex ? "Revoking..." : "Revoke access"}
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                  {!isPublishingWallet && !isPurchaseWallet ? (
                    <span className="muted">Open this item with the publishing wallet to manage delivery, or with the purchase wallet to reveal it.</span>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </div>
      <NoticeToast message={error} open={Boolean(error)} onClose={() => setError(null)} />
    </div>
  );
}
