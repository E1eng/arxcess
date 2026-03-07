"use client";

import { useEffect, useMemo, useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { randomHexId } from "@arxcess/sdk";
import { NoticeToast } from "@/components/ui/notice-toast";
import { useDeliveryKeys } from "@/hooks/use-delivery-keys";
import { useProducts } from "@/hooks/use-products";
import { hasConfiguredProgramId, hasConfiguredTreasuryPublicKey } from "@/lib/anchor/client";
import { fetchOnchainProductStates, type DecodedProductState } from "@/lib/solana/account-state";
import { buildPurchaseTransaction } from "@/lib/solana/arxcess";
import { type LocalProductListing, type LocalPurchaseIntent, saveStoredPurchase } from "@/lib/storage/marketplace";
import { confirmTransactionOrThrow } from "@/lib/solana/transactions";
import { formatBytes, formatLicenseDuration, truncateValue } from "@/lib/utils/format";

export function ProductCatalog() {
  const { connection } = useConnection();
  const { publicKey, sendTransaction } = useWallet();
  const { products } = useProducts();
  const connectedWallet = useMemo(() => publicKey?.toBase58() ?? null, [publicKey]);
  const { ensureKeypair } = useDeliveryKeys(connectedWallet);
  const [busyProductId, setBusyProductId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [onchainProductStates, setOnchainProductStates] = useState<Record<string, DecodedProductState>>({});
  const [prepared, setPrepared] = useState<
    | {
        product: LocalProductListing;
        purchase: LocalPurchaseIntent;
      }
    | null
  >(null);

  useEffect(() => {
    let ignore = false;

    async function loadOnchainStates() {
      const resolvable = products.filter((product) => Boolean(product.sellerWallet));

      if (resolvable.length === 0) {
        if (!ignore) {
          setOnchainProductStates({});
        }
        return;
      }

      try {
        const states = await fetchOnchainProductStates(connection, resolvable);
        if (!ignore) {
          setOnchainProductStates(states);
        }
      } catch {
        if (!ignore) {
          setOnchainProductStates({});
        }
      }
    }

    void loadOnchainStates();

    return () => {
      ignore = true;
    };
  }, [connection, products]);

  async function preparePurchase(product: LocalProductListing) {
    if (!publicKey || !sendTransaction) {
      setError("Connect a wallet before buying on-chain.");
      return;
    }

    if (!hasConfiguredProgramId()) {
      setError("Missing NEXT_PUBLIC_PROGRAM_ID.");
      return;
    }

    if (!hasConfiguredTreasuryPublicKey()) {
      setError("Missing NEXT_PUBLIC_TREASURY_WALLET.");
      return;
    }

    setBusyProductId(product.productIdHex);
    setError(null);
    setStatusMessage("Preparing secure checkout...");

    try {
      const deliveryKeypair = ensureKeypair();
      const purchaseIdHex = randomHexId();
      setStatusMessage("Building purchase transaction...");
      const { transaction } = await buildPurchaseTransaction({
        buyer: publicKey,
        listing: product,
        purchaseIdHex,
        buyerDeliveryPublicKeyBase64: deliveryKeypair.publicKeyBase64
      });
      const latestBlockhash = await connection.getLatestBlockhash();

      transaction.recentBlockhash = latestBlockhash.blockhash;

      setStatusMessage("Waiting for wallet approval to pay on-chain...");
      const transactionSignature = await sendTransaction(transaction, connection);

      setStatusMessage("Payment sent. Waiting for on-chain confirmation...");
      await confirmTransactionOrThrow({
        connection,
        signature: transactionSignature,
        blockhash: latestBlockhash.blockhash,
        lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
        label: "Purchase"
      });

      const createdAt = new Date();
      const expiresAt =
        product.policy.licenseDurationSeconds === 0
          ? null
          : new Date(createdAt.getTime() + product.policy.licenseDurationSeconds * 1000).toISOString();
      const purchase: LocalPurchaseIntent = {
        purchaseIdHex,
        productIdHex: product.productIdHex,
        buyerWallet: connectedWallet,
        buyerDeliveryPublicKeyBase64: deliveryKeypair.publicKeyBase64,
        amountSol: product.priceSol,
        status: "pending_seal",
        accessCount: 0,
        maxAccessCount: product.policy.maxAccessCount,
        expiresAt,
        revokedAt: null,
        createdAt: createdAt.toISOString(),
        transactionSignature
      };

      saveStoredPurchase(purchase);
      setPrepared({
        product,
        purchase
      });
      setStatusMessage("Purchase confirmed. The item will appear in Library until delivery is ready.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to execute on-chain purchase.");
      setStatusMessage(null);
    } finally {
      setBusyProductId(null);
    }
  }

  return (
    <div className="grid">
      <section className="card surface page-intro">
        <div className="page-intro__top">
          <div>
            <span className="eyebrow">Explore</span>
            <h2 className="section-title">Explore locked digital products</h2>
            <p className="muted">Choose a product, complete checkout with your wallet, and open it later from Library.</p>
          </div>
          <div className="page-intro__meta">
            <span className="badge badge--neutral">Connected wallet: {connectedWallet ? truncateValue(connectedWallet, 12, 10) : "not connected"}</span>
          </div>
        </div>
      </section>

      {statusMessage ? (
        <div className="callout callout--info">
          <strong>Checkout status</strong>
          <span className="muted">{statusMessage}</span>
        </div>
      ) : null}

      {products.length === 0 ? (
        <div className="card surface empty-state">
          <strong>No products are available yet.</strong>
          <span className="muted">Launch a listing once your storage and wallet environment are ready.</span>
        </div>
      ) : (
        <div className="catalog-grid">
          {products.map((product) => {
            const onchain = onchainProductStates[product.productIdHex];

            return (
              <div key={product.productIdHex} className="card surface product-card">
                <div className="asset-stage__media product-card__media">
                  <div className="row">
                    <span className="badge">{product.category}</span>
                    <span className="badge badge--neutral">{onchain ? onchain.statusLabel : "Encrypted listing"}</span>
                  </div>
                  <strong>{product.title}</strong>
                  <span className="muted">{product.description}</span>
                  <span className="asset-stage__lock">Preview only. Full asset unlocks after checkout.</span>
                </div>
                <div className="metric-grid">
                  <div className="kpi compact-kpi">
                    <span className="muted">Price</span>
                    <strong>{product.priceSol} SOL</strong>
                  </div>
                  <div className="kpi compact-kpi">
                    <span className="muted">Asset size</span>
                    <strong>{formatBytes(product.fileSizeBytes)}</strong>
                  </div>
                </div>
                <div className="detail-list">
                  <div className="detail-row">
                    <span className="muted">Publisher</span>
                    <strong>{product.sellerWallet ? truncateValue(product.sellerWallet) : "not connected"}</strong>
                  </div>
                  <div className="detail-row">
                    <span className="muted">Access window</span>
                    <strong>{formatLicenseDuration(product.policy.licenseDurationSeconds)}</strong>
                  </div>
                  <div className="detail-row">
                    <span className="muted">Reveal limit</span>
                    <strong>{product.policy.maxAccessCount}</strong>
                  </div>
                  <div className="detail-row">
                    <span className="muted">Revocable</span>
                    <strong>{product.policy.revocable ? "Yes" : "No"}</strong>
                  </div>
                </div>
                <div className="row">
                  <button className="button" type="button" onClick={() => void preparePurchase(product)} disabled={busyProductId === product.productIdHex}>
                    {busyProductId === product.productIdHex ? "Processing..." : `Buy for ${product.priceSol} SOL`}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {prepared ? (
        <div className="callout callout--success">
          <div>
            <strong>Purchase saved to Library</strong>
            <span className="muted">{prepared.product.title} was paid successfully. Open Library to wait for delivery and reveal it later.</span>
          </div>
        </div>
      ) : null}
      <NoticeToast message={error} open={Boolean(error)} onClose={() => setError(null)} />
    </div>
  );
}
