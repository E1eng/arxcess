"use client";

import { useEffect, useMemo, useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { type ProductMetadata } from "@arxcess/sdk";
import { evaluateDeliveryForFinalize } from "@/lib/access/delivery-evaluator";
import { NoticeToast } from "@/components/ui/notice-toast";
import { decryptCiphertext, sha256Hex } from "@/lib/crypto/content";
import { createDeliveryMaterialDigestHex, unsealDeliveryMaterial } from "@/lib/crypto/delivery";
import { hasConfiguredProgramId } from "@/lib/anchor/client";
import { confirmTransactionOrThrow } from "@/lib/solana/transactions";
import { useProducts } from "@/hooks/use-products";
import { useDeliveryKeys } from "@/hooks/use-delivery-keys";
import { usePurchases } from "@/hooks/use-purchases";
import { fetchOnchainPurchaseStates, type DecodedPurchaseState } from "@/lib/solana/account-state";
import { buildConsumeAccessTransaction, buildFinalizeDeliveryTransaction, buildRevokePurchaseTransaction } from "@/lib/solana/arxcess";
import { clearStoredMarketplaceState, getStoredPurchase, getStoredSellerDeliveryMaterial, saveStoredPurchase } from "@/lib/storage/marketplace";
import { base64ToBytes } from "@/lib/utils/bytes";
import { formatOptionalDateTime, truncateValue } from "@/lib/utils/format";

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

export function PurchasesList() {
  const { connection } = useConnection();
  const { publicKey, sendTransaction } = useWallet();
  const { purchases, refreshPurchases } = usePurchases();
  const { products } = useProducts();
  const buyerWallet = useMemo(() => publicKey?.toBase58() ?? null, [publicKey]);
  const { keypair } = useDeliveryKeys(buyerWallet);
  const [busyPurchaseId, setBusyPurchaseId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
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
        const states = await fetchOnchainPurchaseStates(connection, resolvable);
        if (!ignore) {
          setOnchainPurchaseStates(states);
        }
      } catch {
        if (!ignore) {
          setOnchainPurchaseStates({});
        }
      }
    }

    void loadOnchainStates();

    return () => {
      ignore = true;
    };
  }, [connection, purchaseCards]);

  function resolvePurchase(purchaseIdHex: string) {
    return getStoredPurchase(purchaseIdHex) ?? purchases.find((entry) => entry.purchaseIdHex === purchaseIdHex) ?? null;
  }

  async function finalizeDelivery(purchaseIdHex: string) {
    const purchase = resolvePurchase(purchaseIdHex);
    const product = purchase ? products.find((entry) => entry.productIdHex === purchase.productIdHex) ?? null : null;

    if (!purchase || !product) {
      setError("Purchase or listing data is missing.");
      return;
    }

    if (!publicKey || !sendTransaction) {
      setError("Connect the seller wallet before finalizing delivery.");
      return;
    }

    if (!hasConfiguredProgramId()) {
      setError("Missing NEXT_PUBLIC_PROGRAM_ID.");
      return;
    }

    if (!product.sellerWallet || publicKey.toBase58() !== product.sellerWallet) {
      setError("Finalize delivery must be signed by the seller wallet that published the listing.");
      return;
    }

    const deliveryMaterial = getStoredSellerDeliveryMaterial(product.productIdHex);

    if (!deliveryMaterial) {
      setError("Seller-side delivery material is missing in this browser. Publish and finalize from the same seller environment for this demo.");
      return;
    }

    setBusyPurchaseId(purchaseIdHex);
    setError(null);
    setStatusMessage("Preparing seller delivery finalization...");

    try {
      const onchain = onchainPurchaseStates[purchaseIdHex];
      const metadataResponse = await fetch(product.metadataGatewayUrl, {
        method: "GET",
        cache: "no-store"
      });

      if (!metadataResponse.ok) {
        throw new Error("Failed to fetch listing metadata before finalize.");
      }

      const metadata = (await metadataResponse.json()) as ProductMetadata;
      const finalizeIv = metadata.ivBase64 ? base64ToBytes(metadata.ivBase64) : base64ToBytes(deliveryMaterial.ivBase64);
      const ciphertextResponse = await fetch(product.ciphertextGatewayUrl, {
        method: "GET",
        cache: "no-store"
      });

      if (!ciphertextResponse.ok) {
        throw new Error("Failed to fetch ciphertext before finalize.");
      }

      const ciphertext = new Uint8Array(await ciphertextResponse.arrayBuffer());
      const ciphertextHashHex = await sha256Hex(ciphertext);

      if (ciphertextHashHex !== product.ciphertextHashHex) {
        throw new Error("Finalize blocked because the downloaded ciphertext does not match the listing hash.");
      }

      await decryptCiphertext({
        ciphertext,
        contentKey: base64ToBytes(deliveryMaterial.contentKeyBase64),
        iv: finalizeIv
      });
      const deliveryMaterialDigestHex = await createDeliveryMaterialDigestHex({
        contentKey: base64ToBytes(deliveryMaterial.contentKeyBase64),
        iv: finalizeIv
      });

      const deliveryEvaluation = await evaluateDeliveryForFinalize({
        buyerDeliveryPublicKeyBase64: purchase.buyerDeliveryPublicKeyBase64,
        ciphertextHashHex: product.ciphertextHashHex,
        productIdHex: product.productIdHex,
        purchaseNotRevoked: !(onchain?.revokedAt || purchase.revokedAt),
        productActive: true,
        paymentVerified: Boolean(purchase.transactionSignature),
        sellerWallet: product.sellerWallet,
        deliveryNotYetFinalized: (onchain?.statusLabel ?? purchase.status) !== "delivered",
        sellerDeliveryMaterial: deliveryMaterial
      });
      const { transaction } = await buildFinalizeDeliveryTransaction({
        authority: publicKey,
        listing: product,
        purchaseIdHex,
        approvalFlag: deliveryEvaluation.approvalFlag,
        sealedKeyBoxBase64: deliveryEvaluation.sealedKeyBoxBase64,
        deliveryCommitmentHex: deliveryEvaluation.deliveryCommitmentHex
      });
      const latestBlockhash = await connection.getLatestBlockhash();

      transaction.recentBlockhash = latestBlockhash.blockhash;

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
        status: "delivered",
        finalizeSignature,
        sealedKeyBoxBase64: deliveryEvaluation.sealedKeyBoxBase64,
        deliveryCommitmentHex: deliveryEvaluation.deliveryCommitmentHex,
        deliveryMaterialDigestHex
      });
      refreshPurchases();
      setStatusMessage("Delivery finalized successfully. The buyer can now reveal and download the asset from the library.");
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
      setError("Connect the seller wallet before revoking access.");
      return;
    }

    if (!hasConfiguredProgramId()) {
      setError("Missing NEXT_PUBLIC_PROGRAM_ID.");
      return;
    }

    if (!product.sellerWallet || publicKey.toBase58() !== product.sellerWallet) {
      setError("Revoke must be signed by the seller wallet that published the listing.");
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
    let stage = "prepare";

    if (!purchase || !product) {
      setError("Purchase or listing data is missing.");
      return;
    }

    if (!publicKey || !sendTransaction) {
      setError("Connect the buyer wallet before revealing the asset.");
      return;
    }

    if (purchase.buyerWallet && publicKey.toBase58() !== purchase.buyerWallet) {
      setError("Reveal must be signed by the buyer wallet that purchased this asset.");
      return;
    }

    if (!keypair) {
      setError("Buyer delivery keypair is missing in this browser. Use the same browser profile that created the purchase, or import the original delivery keypair before revealing.");
      return;
    }

    if (keypair.publicKeyBase64 !== purchase.buyerDeliveryPublicKeyBase64) {
      setError("The current buyer delivery keypair does not match this purchase. Restore the original delivery keypair used during checkout before revealing.");
      return;
    }

    const deliveryKeypair = keypair;

    if (!purchase.sealedKeyBoxBase64 && !onchain?.sealedKeyBoxBase64) {
      setError("Sealed delivery is not ready yet.");
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
      if (purchase.sealedKeyBoxBase64 && onchain?.sealedKeyBoxBase64 && purchase.sealedKeyBoxBase64 !== onchain.sealedKeyBoxBase64) {
        setStatusMessage("The latest local finalized payload differs from the decoded on-chain payload. Using the local payload for this reveal.");
      }

      const sealedKeyBoxBase64 = purchase.sealedKeyBoxBase64 ?? onchain?.sealedKeyBoxBase64;

      if (!sealedKeyBoxBase64) {
        throw new Error("Sealed delivery payload is missing from both local state and on-chain purchase state.");
      }

      stage = "unseal";
      const deliveryMaterial = unsealDeliveryMaterial({
        sealedKeyBoxBase64,
        keypair: deliveryKeypair
      });
      stage = "metadata";
      const metadataResponse = await fetch(product.metadataGatewayUrl, {
        method: "GET",
        cache: "no-store"
      });

      if (!metadataResponse.ok) {
        throw new Error("Failed to fetch listing metadata from storage.");
      }

      const metadata = (await metadataResponse.json()) as ProductMetadata;
      const iv = metadata.ivBase64 ? base64ToBytes(metadata.ivBase64) : deliveryMaterial.iv;
      const deliveryMaterialDigestHex = await createDeliveryMaterialDigestHex({
        contentKey: deliveryMaterial.contentKey,
        iv
      });

      if (purchase.deliveryMaterialDigestHex && purchase.deliveryMaterialDigestHex !== deliveryMaterialDigestHex) {
        throw new Error("Buyer unsealed delivery material does not match the material the seller validated during finalize.");
      }

      stage = "ciphertext";
      const response = await fetch(product.ciphertextGatewayUrl, {
        method: "GET",
        cache: "no-store"
      });

      if (!response.ok) {
        throw new Error("Failed to fetch ciphertext from storage.");
      }

      const ciphertext = new Uint8Array(await response.arrayBuffer());
      const ciphertextHashHex = await sha256Hex(ciphertext);

      if (ciphertextHashHex !== product.ciphertextHashHex) {
        throw new Error("Downloaded ciphertext does not match the listing hash for this purchase.");
      }

      stage = "decrypt";
      const plaintext = await decryptCiphertext({
        ciphertext,
        contentKey: deliveryMaterial.contentKey,
        iv
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
        accessCount: purchase.accessCount + 1,
        sealedKeyBoxBase64
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
      } else if (message.includes("does not match the material the seller validated")) {
        setError("Reveal failed because the buyer opened a different delivery payload than the one the seller validated during finalize.");
      } else if (message.includes("invalid payload shape")) {
        setError("Reveal failed because the finalized delivery payload is malformed. The seller likely finalized with mismatched delivery material.");
      } else if (message.includes("Consume access failed on-chain")) {
        setError(`Reveal decrypted successfully, but consume access failed on-chain. ${message}`);
      } else if (stage === "wallet_approval" || stage === "confirm_consume_access" || stage === "download") {
        setError(`Reveal decrypted successfully, but failed during ${stage}. ${message}`);
      } else if (
        message.includes("Failed to decrypt ciphertext") ||
        message.includes("Downloaded ciphertext does not match") ||
        message.includes("Unexpected error")
      ) {
        setError("Reveal failed while decrypting the downloaded ciphertext. The sealed delivery material or encrypted file may not match this purchase.");
      } else {
        setError(message || "Failed to reveal asset.");
      }
    } finally {
      setBusyPurchaseId(null);
    }
  }

  function resetLocalState() {
    clearStoredMarketplaceState();
    setError(null);
    setStatusMessage(null);
    setBusyPurchaseId(null);
    setRevealedPurchaseId(null);
    setOnchainPurchaseStates({});
    window.location.reload();
  }

  return (
    <div className="grid">
      <section className="card surface page-intro">
        <div className="page-intro__top">
          <div>
            <span className="eyebrow">Purchases</span>
            <h2 className="section-title">Your purchased products</h2>
            <p className="muted">Wait for delivery, then reveal and download your asset from here.</p>
          </div>
          <div className="page-intro__meta">
            <span className="badge badge--neutral">Buyer wallet: {buyerWallet ? truncateValue(buyerWallet, 12, 10) : "not connected"}</span>
          </div>
        </div>
      </section>

      {statusMessage ? (
        <div className="callout callout--success">
          <strong>Status</strong>
          <span className="muted">{statusMessage}</span>
        </div>
      ) : null}

      <div className="card surface">
        <div className="title-with-action">
          <div>
            <h2 className="section-title">Library</h2>
            <p className="muted">Everything you bought appears here.</p>
          </div>
          <button className="button secondary" type="button" onClick={resetLocalState}>
            Reset demo data
          </button>
        </div>
        {purchaseCards.length === 0 ? (
          <span className="muted">No purchase intents prepared yet. Go to the catalog and start a checkout flow.</span>
        ) : (
          <div className="catalog-grid">
            {purchaseCards.map(({ purchase, product }) => {
              const onchain = onchainPurchaseStates[purchase.purchaseIdHex];
              const effectiveStatus = onchain?.statusLabel ?? purchase.status;

              return (
                <div key={purchase.purchaseIdHex} className="card surface product-card">
                  <div className="asset-stage__media product-card__media">
                    <div className="row">
                      <span className="badge">{product?.category ?? "purchase"}</span>
                      <span className="badge badge--neutral">{effectiveStatus === "prepared" ? "Prepared" : effectiveStatus === "revoked" ? "Revoked" : effectiveStatus === "delivered" ? "Delivered" : "Waiting delivery"}</span>
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
                            : "Waiting for seller delivery."}
                    </span>
                  </div>
                  <div className="detail-list">
                    <div className="detail-row">
                      <span className="muted">Amount</span>
                      <strong>{purchase.amountSol} SOL</strong>
                    </div>
                    <div className="detail-row">
                      <span className="muted">Access count</span>
                      <strong>{onchain ? `${onchain.accessCount}/${onchain.maxAccessCount}` : `${purchase.accessCount}/${purchase.maxAccessCount}`}</strong>
                    </div>
                    <div className="detail-row">
                      <span className="muted">Expires</span>
                      <strong>{formatOptionalDateTime(onchain?.expiresAt ? onchain.expiresAt * 1000 : purchase.expiresAt) ?? "No expiry"}</strong>
                    </div>
                    <div className="detail-row">
                      <span className="muted">Revoked</span>
                      <strong>{formatOptionalDateTime(onchain?.revokedAt ? onchain.revokedAt * 1000 : purchase.revokedAt) ?? "Active"}</strong>
                    </div>
                  </div>
                  <div className="row">
                    <button className="button secondary" type="button" onClick={() => void finalizeDelivery(purchase.purchaseIdHex)} disabled={busyPurchaseId === purchase.purchaseIdHex || effectiveStatus !== "pending_seal"}>
                      {busyPurchaseId === purchase.purchaseIdHex && effectiveStatus !== "delivered" ? "Finalizing..." : "Finalize"}
                    </button>
                    <button className="button" type="button" onClick={() => void revealPurchase(purchase.purchaseIdHex)} disabled={busyPurchaseId === purchase.purchaseIdHex || effectiveStatus !== "delivered"}>
                      {busyPurchaseId === purchase.purchaseIdHex && effectiveStatus === "delivered" ? "Revealing..." : revealedPurchaseId === purchase.purchaseIdHex ? "Download again" : "Reveal & download"}
                    </button>
                    <button className="button secondary" type="button" onClick={() => void revokePurchase(purchase.purchaseIdHex)} disabled={busyPurchaseId === purchase.purchaseIdHex || effectiveStatus === "revoked" || !product?.policy.revocable}>
                      {busyPurchaseId === purchase.purchaseIdHex && effectiveStatus === "revoked" ? "Revoking..." : "Revoke access"}
                    </button>
                  </div>
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
