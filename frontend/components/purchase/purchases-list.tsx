"use client";

import { useEffect, useMemo, useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { type ProductMetadata } from "@arxcess/sdk";
import { evaluateDeliveryForFinalize } from "@/lib/access/delivery-evaluator";
import { InfoButton, OverlayDialog } from "@/components/ui/overlay-dialog";
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

function truncateValue(value: string, head = 12, tail = 8) {
  if (value.length <= head + tail + 3) {
    return value;
  }

  return `${value.slice(0, head)}...${value.slice(-tail)}`;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function isConsumeAccessUnsupported(message: string) {
  return (
    message.includes("InstructionFallbackNotFound") ||
    message.includes("Fallback functions are not supported") ||
    message.includes('"Custom":101') ||
    message.includes("custom program error: 0x65")
  );
}

export function PurchasesList() {
  const { connection } = useConnection();
  const { publicKey, sendTransaction } = useWallet();
  const { purchases, refreshPurchases } = usePurchases();
  const { products } = useProducts();
  const buyerWallet = useMemo(() => publicKey?.toBase58() ?? null, [publicKey]);
  const { keypair, ensureKeypair } = useDeliveryKeys(buyerWallet);
  const [busyPurchaseId, setBusyPurchaseId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [onchainPurchaseStates, setOnchainPurchaseStates] = useState<Record<string, DecodedPurchaseState>>({});
  const [revealedPurchaseId, setRevealedPurchaseId] = useState<string | null>(null);
  const [isFlowDialogOpen, setIsFlowDialogOpen] = useState(false);
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
    } catch (cause) {
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
    } catch (cause) {
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
    let consumeAccessUnavailable = false;
    const diagnostics = {
      stage: "prepare",
      payloadSource: "unknown",
      metadataIv: "0",
      payloadsMatch: "na",
      storedDigest: "none",
      revealDigest: "none",
      ciphertextHashMatch: "na"
    };

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

    try {
      stage = "resolve_payload";
      diagnostics.stage = stage;
      if (purchase.sealedKeyBoxBase64 && onchain?.sealedKeyBoxBase64 && purchase.sealedKeyBoxBase64 !== onchain.sealedKeyBoxBase64) {
        setError("The local finalized delivery payload does not match the on-chain decoded payload. Using the local payload for reveal.");
      }

      diagnostics.payloadsMatch =
        purchase.sealedKeyBoxBase64 && onchain?.sealedKeyBoxBase64
          ? purchase.sealedKeyBoxBase64 === onchain.sealedKeyBoxBase64
            ? "1"
            : "0"
          : "na";

      const sealedKeyBoxBase64 = purchase.sealedKeyBoxBase64 ?? onchain?.sealedKeyBoxBase64;
      diagnostics.payloadSource = purchase.sealedKeyBoxBase64 ? "local" : onchain?.sealedKeyBoxBase64 ? "chain" : "missing";

      if (!sealedKeyBoxBase64) {
        throw new Error("Sealed delivery payload is missing from both local state and on-chain purchase state.");
      }

      stage = "unseal";
      diagnostics.stage = stage;
      const deliveryMaterial = unsealDeliveryMaterial({
        sealedKeyBoxBase64,
        keypair: deliveryKeypair
      });
      stage = "metadata";
      diagnostics.stage = stage;
      const metadataResponse = await fetch(product.metadataGatewayUrl, {
        method: "GET",
        cache: "no-store"
      });

      if (!metadataResponse.ok) {
        throw new Error("Failed to fetch listing metadata from storage.");
      }

      const metadata = (await metadataResponse.json()) as ProductMetadata;
      const iv = metadata.ivBase64 ? base64ToBytes(metadata.ivBase64) : deliveryMaterial.iv;
      diagnostics.metadataIv = metadata.ivBase64 ? "1" : "0";
      const deliveryMaterialDigestHex = await createDeliveryMaterialDigestHex({
        contentKey: deliveryMaterial.contentKey,
        iv
      });
      diagnostics.storedDigest = purchase.deliveryMaterialDigestHex ? purchase.deliveryMaterialDigestHex.slice(0, 10) : "none";
      diagnostics.revealDigest = deliveryMaterialDigestHex.slice(0, 10);

      if (purchase.deliveryMaterialDigestHex && purchase.deliveryMaterialDigestHex !== deliveryMaterialDigestHex) {
        throw new Error("Buyer unsealed delivery material does not match the material the seller validated during finalize.");
      }

      stage = "ciphertext";
      diagnostics.stage = stage;
      const response = await fetch(product.ciphertextGatewayUrl, {
        method: "GET",
        cache: "no-store"
      });

      if (!response.ok) {
        throw new Error("Failed to fetch ciphertext from storage.");
      }

      const ciphertext = new Uint8Array(await response.arrayBuffer());
      const ciphertextHashHex = await sha256Hex(ciphertext);
      diagnostics.ciphertextHashMatch = ciphertextHashHex === product.ciphertextHashHex ? "1" : "0";

      if (ciphertextHashHex !== product.ciphertextHashHex) {
        throw new Error("Downloaded ciphertext does not match the listing hash for this purchase.");
      }

      stage = "decrypt";
      diagnostics.stage = stage;
      const plaintext = await decryptCiphertext({
        ciphertext,
        contentKey: deliveryMaterial.contentKey,
        iv
      });
      stage = "consume_access";
      diagnostics.stage = stage;
      const { transaction } = await buildConsumeAccessTransaction({
        buyer: publicKey,
        listing: product,
        purchaseIdHex
      });
      const latestBlockhash = await connection.getLatestBlockhash();

      transaction.recentBlockhash = latestBlockhash.blockhash;
      transaction.feePayer = publicKey;

      stage = "simulate_consume_access";
      diagnostics.stage = stage;
      try {
        const simulation = await (connection as {
          simulateTransaction: (
            transaction: object,
            config: {
              commitment: "processed";
              replaceRecentBlockhash: boolean;
              sigVerify: boolean;
            }
          ) => Promise<{
            value: {
              err: unknown;
              logs?: string[];
            };
          }>;
        }).simulateTransaction(transaction, {
          commitment: "processed",
          replaceRecentBlockhash: true,
          sigVerify: false
        });

        if (simulation.value.err) {
          const logSuffix = simulation.value.logs?.length ? ` Logs: ${simulation.value.logs.slice(-8).join(" | ")}` : "";
          throw new Error(`Consume access would fail on-chain: ${JSON.stringify(simulation.value.err)}.${logSuffix}`);
        }
      } catch (cause) {
        const simulationMessage = cause instanceof Error ? cause.message : String(cause);

        if (simulationMessage.includes("Consume access would fail on-chain")) {
          if (isConsumeAccessUnsupported(simulationMessage)) {
            consumeAccessUnavailable = true;
          } else {
            throw cause;
          }
        } else if (isConsumeAccessUnsupported(simulationMessage)) {
          consumeAccessUnavailable = true;
        }
      }

      if (!consumeAccessUnavailable) {
        stage = "wallet_approval";
        diagnostics.stage = stage;
        try {
          const consumeSignature = await sendTransaction(transaction, connection, {
            skipPreflight: true
          });

          stage = "confirm_consume_access";
          diagnostics.stage = stage;
          await confirmTransactionOrThrow({
            connection,
            signature: consumeSignature,
            blockhash: latestBlockhash.blockhash,
            lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
            label: "Consume access"
          });
        } catch (cause) {
          const consumeMessage = cause instanceof Error ? cause.message : String(cause);

          if (isConsumeAccessUnsupported(consumeMessage)) {
            consumeAccessUnavailable = true;
          } else {
            throw cause;
          }
        }
      }

      stage = "download";
      diagnostics.stage = stage;
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

      if (consumeAccessUnavailable) {
        setError("Asset revealed successfully, but the deployed program does not support on-chain consume access yet. Access usage was tracked locally for this session.");
      }
      return;
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      if (message.includes("Failed to unseal delivery material")) {
        setError("Reveal failed because the buyer delivery keypair in this browser does not match the one used during checkout.");
      } else if (message.includes("does not match the material the seller validated")) {
        setError("Reveal failed because the buyer opened a different delivery payload than the one the seller validated during finalize.");
      } else if (message.includes("invalid payload shape")) {
        setError("Reveal failed because the finalized delivery payload is malformed. The seller likely finalized with mismatched delivery material.");
      } else if (message.includes("Consume access failed on-chain")) {
        setError(`Reveal decrypted successfully, but consume access failed on-chain. ${message}`);
      } else if (message.includes("Consume access would fail on-chain")) {
        setError(`Reveal decrypted successfully, but the consume access transaction would be rejected on-chain. ${message}`);
      } else if (stage === "wallet_approval" || stage === "confirm_consume_access" || stage === "download") {
        setError(`Reveal decrypted successfully, but failed during ${stage}. ${message}`);
      } else if (
        message.includes("Failed to decrypt ciphertext") ||
        message.includes("Downloaded ciphertext does not match") ||
        message.includes("Unexpected error")
      ) {
        setError(
          `Reveal failed while decrypting the downloaded ciphertext. The sealed delivery material or encrypted file may not match this purchase. [stage=${diagnostics.stage} src=${diagnostics.payloadSource} same=${diagnostics.payloadsMatch} iv=${diagnostics.metadataIv} stored=${diagnostics.storedDigest} reveal=${diagnostics.revealDigest} hash=${diagnostics.ciphertextHashMatch}]`
        );
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
    setBusyPurchaseId(null);
    setRevealedPurchaseId(null);
    setOnchainPurchaseStates({});
    window.location.reload();
  }

  return (
    <div className="grid">
      <div className="card">
        <div>
          <div className="title-with-action">
            <h2 className="section-title">Buyer delivery keys</h2>
            <InfoButton label="View buyer key flow details" onClick={() => setIsFlowDialogOpen(true)} />
          </div>
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
          <div className="title-with-action">
            <h2 className="section-title">Buyer library</h2>
            <InfoButton label="View purchase flow details" onClick={() => setIsFlowDialogOpen(true)} />
          </div>
          <p className="muted">This area should become the post-checkout home for every purchase.</p>
        </div>
        <div className="row">
          <button className="button secondary" type="button" onClick={resetLocalState}>
            Reset local demo state
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
                <div className="detail-row">
                  <span className="muted">Flow</span>
                  <strong>
                    {effectiveStatus === "revoked"
                      ? "This purchase was revoked, so future reveals are blocked."
                      : effectiveStatus === "delivered"
                        ? "Payment and delivery are complete. Reveal uses the original buyer delivery keypair stored in this browser."
                        : effectiveStatus === "pending_seal"
                          ? "Payment is confirmed on-chain. Waiting for the seller to finalize sealed delivery before reveal is possible."
                          : "Checkout is staged locally and the purchase must be submitted on-chain before delivery can begin."}
                  </strong>
                </div>
              </div>
            );})}
          </div>
        )}
      </div>
      <NoticeToast message={error} open={Boolean(error)} onClose={() => setError(null)} />
      <OverlayDialog open={isFlowDialogOpen} title="Purchase flow" onClose={() => setIsFlowDialogOpen(false)}>
        <span>1. Buyer pays on-chain and the purchase becomes pending delivery.</span>
        <span>2. Seller finalizes a sealed delivery package using the seller environment that published the listing.</span>
        <span>3. Buyer reveals the asset using the original buyer wallet and delivery keypair from checkout.</span>
      </OverlayDialog>
    </div>
  );
}
