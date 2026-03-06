"use client";

import { useEffect, useMemo, useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { evaluateDeliveryForFinalize } from "@/lib/access/delivery-evaluator";
import { decryptCiphertext } from "@/lib/crypto/content";
import { unsealDeliveryMaterial } from "@/lib/crypto/delivery";
import { hasConfiguredProgramId } from "@/lib/anchor/client";
import { useProducts } from "@/hooks/use-products";
import { useDeliveryKeys } from "@/hooks/use-delivery-keys";
import { usePurchases } from "@/hooks/use-purchases";
import { fetchOnchainPurchaseStates, type DecodedPurchaseState } from "@/lib/solana/account-state";
import { buildConsumeAccessTransaction, buildFinalizeDeliveryTransaction, buildRevokePurchaseTransaction } from "@/lib/solana/arxcess";
import { getStoredSellerDeliveryMaterial, saveStoredPurchase } from "@/lib/storage/marketplace";

 function truncateValue(value: string, head = 12, tail = 8) {
   if (value.length <= head + tail + 3) {
     return value;
   }

   return `${value.slice(0, head)}...${value.slice(-tail)}`;
 }

 function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
   return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
 }

export function PurchasesList() {
  const { connection } = useConnection();
  const { publicKey, sendTransaction } = useWallet();
  const { purchases, refreshPurchases } = usePurchases();
  const { products } = useProducts();
  const { keypair, ensureKeypair } = useDeliveryKeys();
  const [busyPurchaseId, setBusyPurchaseId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
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

  async function finalizeDelivery(purchaseIdHex: string) {
    const purchase = purchases.find((entry) => entry.purchaseIdHex === purchaseIdHex) ?? null;
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

    try {
      const onchain = onchainPurchaseStates[purchaseIdHex];
      const deliveryEvaluation = await evaluateDeliveryForFinalize({
        buyerDeliveryPublicKeyBase64: purchase.buyerDeliveryPublicKeyBase64,
        ciphertextHashHex: product.ciphertextHashHex,
        purchaseNotRevoked: !(onchain?.revokedAt || purchase.revokedAt),
        productActive: true,
        paymentVerified: Boolean(purchase.transactionSignature),
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

      await connection.confirmTransaction(
        {
          signature: finalizeSignature,
          blockhash: latestBlockhash.blockhash,
          lastValidBlockHeight: latestBlockhash.lastValidBlockHeight
        },
        "confirmed"
      );

      saveStoredPurchase({
        ...purchase,
        status: "delivered",
        finalizeSignature,
        sealedKeyBoxBase64: deliveryEvaluation.sealedKeyBoxBase64,
        deliveryCommitmentHex: deliveryEvaluation.deliveryCommitmentHex
      });
      refreshPurchases();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to finalize delivery.");
    } finally {
      setBusyPurchaseId(null);
    }
  }

  async function revokePurchase(purchaseIdHex: string) {
    const purchase = purchases.find((entry) => entry.purchaseIdHex === purchaseIdHex) ?? null;
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

    try {
      const { transaction } = await buildRevokePurchaseTransaction({
        authority: publicKey,
        listing: product,
        purchaseIdHex
      });
      const latestBlockhash = await connection.getLatestBlockhash();

      transaction.recentBlockhash = latestBlockhash.blockhash;

      const revokeSignature = await sendTransaction(transaction, connection);

      await connection.confirmTransaction(
        {
          signature: revokeSignature,
          blockhash: latestBlockhash.blockhash,
          lastValidBlockHeight: latestBlockhash.lastValidBlockHeight
        },
        "confirmed"
      );

      saveStoredPurchase({
        ...purchase,
        status: "revoked",
        revokedAt: new Date().toISOString(),
        finalizeSignature: purchase.finalizeSignature ?? revokeSignature
      });
      refreshPurchases();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to revoke purchase.");
    } finally {
      setBusyPurchaseId(null);
    }
  }

  async function revealPurchase(purchaseIdHex: string) {
    const purchase = purchases.find((entry) => entry.purchaseIdHex === purchaseIdHex) ?? null;
    const product = purchase ? products.find((entry) => entry.productIdHex === purchase.productIdHex) ?? null : null;

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

    const deliveryKeypair = keypair ?? ensureKeypair();

    if (!purchase.sealedKeyBoxBase64) {
      setError("Sealed delivery is not ready yet.");
      return;
    }

    if (purchase.revokedAt) {
      setError("Access has been revoked for this purchase.");
      return;
    }

    if (purchase.expiresAt && new Date(purchase.expiresAt).getTime() < Date.now()) {
      setError("This purchase license has expired.");
      return;
    }

    if (purchase.accessCount >= purchase.maxAccessCount) {
      setError("This purchase has exhausted its reveal quota.");
      return;
    }

    if (!hasConfiguredProgramId()) {
      setError("Missing NEXT_PUBLIC_PROGRAM_ID.");
      return;
    }

    setBusyPurchaseId(purchaseIdHex);
    setError(null);

    try {
      const { transaction } = await buildConsumeAccessTransaction({
        buyer: publicKey,
        listing: product,
        purchaseIdHex
      });
      const latestBlockhash = await connection.getLatestBlockhash();

      transaction.recentBlockhash = latestBlockhash.blockhash;

      const consumeSignature = await sendTransaction(transaction, connection);

      await connection.confirmTransaction(
        {
          signature: consumeSignature,
          blockhash: latestBlockhash.blockhash,
          lastValidBlockHeight: latestBlockhash.lastValidBlockHeight
        },
        "confirmed"
      );

      const deliveryMaterial = unsealDeliveryMaterial({
        sealedKeyBoxBase64: purchase.sealedKeyBoxBase64,
        keypair: deliveryKeypair
      });
      const response = await fetch(product.ciphertextGatewayUrl, {
        method: "GET",
        cache: "no-store"
      });

      if (!response.ok) {
        throw new Error("Failed to fetch ciphertext from storage.");
      }

      const ciphertext = new Uint8Array(await response.arrayBuffer());
      const plaintext = await decryptCiphertext({
        ciphertext,
        contentKey: deliveryMaterial.contentKey,
        iv: deliveryMaterial.iv
      });
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
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to reveal asset.");
    } finally {
      setBusyPurchaseId(null);
    }
  }

  return (
    <div className="grid">
      <div className="card">
        <div>
          <h2 className="section-title">Buyer delivery keys</h2>
          <p className="muted">This keypair becomes the buyer-side identity for sealed delivery. Once payment is confirmed, the reveal step should use this key to unlock the purchased asset.</p>
        </div>
        <div className="row">
          <button className="button" type="button" onClick={() => ensureKeypair()}>
            {keypair ? "Rotate later manually" : "Generate delivery keypair"}
          </button>
          <span className="badge">{keypair ? "Keypair ready" : "Keypair missing"}</span>
        </div>
        {keypair ? (
          <div className="detail-list">
            <div className="detail-row">
              <span className="muted">Delivery public key</span>
              <strong>{truncateValue(keypair.publicKeyBase64, 16, 12)}</strong>
            </div>
            <div className="detail-row">
              <span className="muted">Role in the flow</span>
              <strong>Receives the sealed content key after payment</strong>
            </div>
          </div>
        ) : null}
      </div>
      <div className="card">
        <div>
          <h2 className="section-title">Buyer library</h2>
          <p className="muted">This area should become the post-checkout home for every purchase: waiting for payment, waiting for key delivery, and eventually reveal/download.</p>
        </div>
        {error ? <span className="badge">{error}</span> : null}
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
                    <span className="badge">{effectiveStatus === "prepared" ? "Checkout staged" : effectiveStatus === "revoked" ? "Revoked" : effectiveStatus === "delivered" ? "Delivered" : "On-chain purchase pending seal"}</span>
                  </div>
                  <strong>{product?.title ?? "Unknown listing"}</strong>
                  <span className="muted">{product?.description ?? "The matching product data is not available in local storage."}</span>
                  <span className="asset-stage__lock">
                    {effectiveStatus === "prepared"
                      ? "Payment has not been executed yet. Asset remains locked."
                      : effectiveStatus === "revoked"
                        ? "Access was revoked. Reveal is disabled."
                      : effectiveStatus === "delivered"
                        ? "Sealed delivery is ready. Buyer can reveal the asset locally."
                        : "Waiting for sealed delivery so the buyer can reveal the asset."}
                  </span>
                </div>
                <div className="detail-list">
                  <div className="detail-row">
                    <span className="muted">Purchase ID</span>
                    <strong>{truncateValue(purchase.purchaseIdHex)}</strong>
                  </div>
                  <div className="detail-row">
                    <span className="muted">Amount</span>
                    <strong>{purchase.amountSol} SOL</strong>
                  </div>
                  <div className="detail-row">
                    <span className="muted">Buyer</span>
                    <strong>{purchase.buyerWallet ? truncateValue(purchase.buyerWallet) : "not connected"}</strong>
                  </div>
                  <div className="detail-row">
                    <span className="muted">Delivery key</span>
                    <strong>{truncateValue(purchase.buyerDeliveryPublicKeyBase64, 16, 12)}</strong>
                  </div>
                  <div className="detail-row">
                    <span className="muted">Transaction</span>
                    <strong>{purchase.transactionSignature ? truncateValue(purchase.transactionSignature, 16, 12) : "not sent"}</strong>
                  </div>
                  <div className="detail-row">
                    <span className="muted">Finalize tx</span>
                    <strong>{purchase.finalizeSignature ? truncateValue(purchase.finalizeSignature, 16, 12) : "not finalized"}</strong>
                  </div>
                  <div className="detail-row">
                    <span className="muted">Access count</span>
                    <strong>{onchain ? `${onchain.accessCount}/${onchain.maxAccessCount}` : `${purchase.accessCount}/${purchase.maxAccessCount}`}</strong>
                  </div>
                  <div className="detail-row">
                    <span className="muted">Expires</span>
                    <strong>{onchain?.expiresAt ? new Date(onchain.expiresAt * 1000).toLocaleString() : purchase.expiresAt ? new Date(purchase.expiresAt).toLocaleString() : "No expiry"}</strong>
                  </div>
                  <div className="detail-row">
                    <span className="muted">Revoked</span>
                    <strong>{onchain?.revokedAt ? new Date(onchain.revokedAt * 1000).toLocaleString() : purchase.revokedAt ? new Date(purchase.revokedAt).toLocaleString() : "Active"}</strong>
                  </div>
                </div>
                <div className="row">
                  <button className="button secondary" type="button" onClick={() => void finalizeDelivery(purchase.purchaseIdHex)} disabled={busyPurchaseId === purchase.purchaseIdHex || effectiveStatus !== "pending_seal"}>
                    {busyPurchaseId === purchase.purchaseIdHex && effectiveStatus !== "delivered" ? "Finalizing..." : "Finalize delivery"}
                  </button>
                  <button className="button" type="button" onClick={() => void revealPurchase(purchase.purchaseIdHex)} disabled={busyPurchaseId === purchase.purchaseIdHex || effectiveStatus !== "delivered"}>
                    {busyPurchaseId === purchase.purchaseIdHex && effectiveStatus === "delivered" ? "Revealing..." : revealedPurchaseId === purchase.purchaseIdHex ? "Reveal again" : "Reveal asset"}
                  </button>
                  <button className="button secondary" type="button" onClick={() => void revokePurchase(purchase.purchaseIdHex)} disabled={busyPurchaseId === purchase.purchaseIdHex || effectiveStatus === "revoked" || !product?.policy.revocable}>
                    {busyPurchaseId === purchase.purchaseIdHex && effectiveStatus === "revoked" ? "Revoking..." : "Revoke access"}
                  </button>
                </div>
                <div className="timeline">
                  <div className="timeline-item done">
                    <strong>1. Checkout prepared</strong>
                    <span className="muted">The app already has the buyer intent and delivery key.</span>
                  </div>
                  <div className={`timeline-item${effectiveStatus === "prepared" ? " active" : " done"}`}>
                    <strong>2. Execute payment</strong>
                    <span className="muted">Wallet signature submitted the on-chain purchase transaction.</span>
                  </div>
                  <div className={`timeline-item${effectiveStatus === "delivered" ? " done" : effectiveStatus === "pending_seal" ? " active" : ""}`}>
                    <strong>3. Finalize delivery</strong>
                    <span className="muted">Seller seals the delivery material and writes the sealed box on-chain.</span>
                  </div>
                  <div className={`timeline-item${effectiveStatus === "revoked" ? " done" : effectiveStatus === "delivered" ? " active" : ""}`}>
                    <strong>4. Reveal full asset</strong>
                    <span className="muted">Buyer decrypts locally using the sealed delivery material and downloaded ciphertext.</span>
                  </div>
                  <div className={`timeline-item${effectiveStatus === "revoked" ? " active" : ""}`}>
                    <strong>5. Revoke later if needed</strong>
                    <span className="muted">Seller can revoke future access when the listing policy allows it.</span>
                  </div>
                </div>
              </div>
            );})}
          </div>
        )}
      </div>
    </div>
  );
}
