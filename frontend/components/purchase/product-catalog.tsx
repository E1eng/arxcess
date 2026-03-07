"use client";

import { useEffect, useMemo, useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { randomHexId } from "@arxcess/sdk";
import { InfoButton, OverlayDialog } from "@/components/ui/overlay-dialog";
import { NoticeToast } from "@/components/ui/notice-toast";
import { useDeliveryKeys } from "@/hooks/use-delivery-keys";
import { useProducts } from "@/hooks/use-products";
import { hasConfiguredProgramId, hasConfiguredTreasuryPublicKey } from "@/lib/anchor/client";
import { fetchOnchainProductStates, type DecodedProductState } from "@/lib/solana/account-state";
import { buildPurchaseTransaction } from "@/lib/solana/arxcess";
import { type LocalProductListing, type LocalPurchaseIntent, saveStoredPurchase } from "@/lib/storage/marketplace";
import { solToLamports } from "@/lib/solana/amounts";
import { confirmTransactionOrThrow } from "@/lib/solana/transactions";

function truncateValue(value: string, head = 12, tail = 6) {
  if (value.length <= head + tail + 3) {
    return value;
  }

  return `${value.slice(0, head)}...${value.slice(-tail)}`;
}

function formatBytes(bytes: number) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }

  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function ProductCatalog() {
  const { connection } = useConnection();
  const { publicKey, sendTransaction } = useWallet();
  const { products } = useProducts();
  const buyerWallet = useMemo(() => publicKey?.toBase58() ?? null, [publicKey]);
  const { ensureKeypair } = useDeliveryKeys(buyerWallet);
  const [selectedProduct, setSelectedProduct] = useState<LocalProductListing | null>(null);
  const [busyProductId, setBusyProductId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [onchainProductStates, setOnchainProductStates] = useState<Record<string, DecodedProductState>>({});
  const [isFlowDialogOpen, setIsFlowDialogOpen] = useState(false);
  const [prepared, setPrepared] = useState<
    | {
        product: LocalProductListing;
        purchase: LocalPurchaseIntent;
        amountLamports: string;
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
    setStatusMessage("Preparing buyer delivery key...");

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
        buyerWallet,
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
        purchase,
        amountLamports: solToLamports(product.priceSol).toString()
      });
      setSelectedProduct(product);
      setStatusMessage("Purchase confirmed. Waiting for seller to finalize delivery.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to execute on-chain purchase.");
      setStatusMessage(null);
    } finally {
      setBusyProductId(null);
    }
  }

  return (
    <div className="grid">
      <div className="card">
        <div>
          <div className="title-with-action">
            <h2 className="section-title">Catalog</h2>
            <InfoButton label="View buyer flow details" onClick={() => setIsFlowDialogOpen(true)} />
          </div>
          <p className="muted">Browse locked products like a storefront.</p>
        </div>
        <span className="badge">Buyer wallet: {buyerWallet ?? "not connected"}</span>
        {statusMessage ? <span className="badge">{statusMessage}</span> : null}
      </div>
      {products.length === 0 ? (
        <div className="card">
          <strong>No products yet.</strong>
          <span className="muted">Create one from the seller page after configuring Pinata.</span>
        </div>
      ) : (
        <div className="catalog-grid">
          {products.map((product) => {
            const isFocused = selectedProduct?.productIdHex === product.productIdHex;
            const onchain = onchainProductStates[product.productIdHex];

            return (
              <div key={product.productIdHex} className={`card surface product-card${isFocused ? " product-card--active" : ""}`}>
                <div className="asset-stage__media product-card__media">
                  <div className="row">
                    <span className="badge">{product.category}</span>
                    <span className="badge">{onchain ? onchain.statusLabel : "Encrypted listing"}</span>
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
                    <span className="muted">Format</span>
                    <strong>{product.mimeType}</strong>
                  </div>
                  <div className="detail-row">
                    <span className="muted">Seller</span>
                    <strong>{product.sellerWallet ? truncateValue(product.sellerWallet) : "not connected"}</strong>
                  </div>
                  <div className="detail-row">
                    <span className="muted">License</span>
                    <strong>{product.policy.licenseDurationSeconds === 0 ? "No expiry" : `${Math.floor(product.policy.licenseDurationSeconds / 86400)} days`}</strong>
                  </div>
                  <div className="detail-row">
                    <span className="muted">Max reveals</span>
                    <strong>{product.policy.maxAccessCount}</strong>
                  </div>
                  <div className="detail-row">
                    <span className="muted">On-chain sales</span>
                    <strong>{onchain?.totalSales ?? 0}</strong>
                  </div>
                </div>
                <div className="row">
                  <button className="button secondary" type="button" onClick={() => setSelectedProduct(product)}>
                    View checkout
                  </button>
                  <button className="button" type="button" onClick={() => void preparePurchase(product)} disabled={busyProductId === product.productIdHex}>
                    {busyProductId === product.productIdHex ? "Awaiting wallet confirmation..." : "Buy on-chain"}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {selectedProduct ? (
        <div className="card surface">
          <div>
            <span className="badge">Checkout preview</span>
            <h3 className="section-title">{selectedProduct.title}</h3>
            <p className="muted">This is the buyer-facing step before payment: review the offer, confirm the wallet, and continue to purchase.</p>
          </div>
          <div className="grid">
            <div className="asset-stage">
              <div className="asset-stage__media">
                <span className="badge">Locked content</span>
                <strong>{selectedProduct.title}</strong>
                <span className="muted">{selectedProduct.description}</span>
                <span className="asset-stage__lock">After payment, buyer receives a sealed delivery key and can reveal the asset.</span>
              </div>
              <div className="row">
                <a className="button secondary" href={selectedProduct.metadataGatewayUrl} target="_blank" rel="noreferrer">
                  View metadata
                </a>
                <a className="button secondary" href={selectedProduct.ciphertextGatewayUrl} target="_blank" rel="noreferrer">
                  View encrypted file
                </a>
              </div>
            </div>
            <div className="detail-list">
              <div className="detail-row">
                <span className="muted">Price</span>
                <strong>{selectedProduct.priceSol} SOL</strong>
              </div>
              <div className="detail-row">
                <span className="muted">Network</span>
                <strong>Solana Devnet</strong>
              </div>
              <div className="detail-row">
                <span className="muted">Buyer wallet</span>
                <strong>{buyerWallet ? truncateValue(buyerWallet) : "Connect wallet first"}</strong>
              </div>
              <div className="detail-row">
                <span className="muted">Revocable</span>
                <strong>{selectedProduct.policy.revocable ? "Yes" : "No"}</strong>
              </div>
              <div className="detail-row">
                <span className="muted">Product state</span>
                <strong>{onchainProductStates[selectedProduct.productIdHex]?.statusLabel ?? "unknown"}</strong>
              </div>
              <div className="detail-row">
                <span className="muted">Flow</span>
                <strong>
                  <InfoButton label="View checkout flow details" onClick={() => setIsFlowDialogOpen(true)} />
                </strong>
              </div>
            </div>
          </div>
          {prepared && prepared.product.productIdHex === selectedProduct.productIdHex ? (
            <div className="detail-list">
              <div className="detail-row">
                <span className="muted">Product</span>
                <strong>{prepared.product.title}</strong>
              </div>
              <div className="detail-row">
                <span className="muted">Amount</span>
                <strong>{prepared.product.priceSol} SOL</strong>
              </div>
              <div className="detail-row">
                <span className="muted">Lamports</span>
                <strong>{prepared.amountLamports}</strong>
              </div>
              <div className="detail-row">
                <span className="muted">Purchase ID</span>
                <strong>{truncateValue(prepared.purchase.purchaseIdHex)}</strong>
              </div>
              <div className="detail-row">
                <span className="muted">Transaction</span>
                <strong>{prepared.purchase.transactionSignature ? truncateValue(prepared.purchase.transactionSignature, 16, 12) : "pending"}</strong>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
      {prepared ? (
        <div className="card surface accent-card">
          <div>
            <span className="badge">On-chain purchase sent</span>
            <h3 className="section-title">Purchase confirmed on Devnet</h3>
            <p className="muted">Payment moved on-chain and the purchase is now waiting for sealed delivery finalization.</p>
          </div>
          <div className="grid grid-2 marketplace-split">
            <div className="detail-list">
              <div className="detail-row">
                <span className="muted">Product</span>
                <strong>{prepared.product.title}</strong>
              </div>
              <div className="detail-row">
                <span className="muted">Amount</span>
                <strong>{prepared.product.priceSol} SOL</strong>
              </div>
              <div className="detail-row">
                <span className="muted">Lamports</span>
                <strong>{prepared.amountLamports}</strong>
              </div>
              <div className="detail-row">
                <span className="muted">Purchase ID</span>
                <strong>{truncateValue(prepared.purchase.purchaseIdHex)}</strong>
              </div>
              <div className="detail-row">
                <span className="muted">Transaction</span>
                <strong>{prepared.purchase.transactionSignature ? truncateValue(prepared.purchase.transactionSignature, 16, 12) : "pending"}</strong>
              </div>
            </div>
            <div className="detail-list">
              <div className="detail-row">
                <span className="muted">Buyer</span>
                <strong>{prepared.purchase.buyerWallet ? truncateValue(prepared.purchase.buyerWallet) : "not connected"}</strong>
              </div>
              <div className="detail-row">
                <span className="muted">Delivery key</span>
                <strong>{truncateValue(prepared.purchase.buyerDeliveryPublicKeyBase64)}</strong>
              </div>
              <div className="detail-row">
                <span className="muted">Status</span>
                <strong>Pending sealed delivery</strong>
              </div>
              <div className="detail-row">
                <span className="muted">Next screen</span>
                <strong>Delivery finalization → reveal</strong>
              </div>
            </div>
          </div>
        </div>
      ) : null}
      <NoticeToast message={error} open={Boolean(error)} onClose={() => setError(null)} />
      <OverlayDialog open={isFlowDialogOpen} title="Buyer flow" onClose={() => setIsFlowDialogOpen(false)}>
        <span>1. Buyer selects a locked listing and pays on-chain.</span>
        <span>2. The purchase waits for the seller to finalize sealed delivery.</span>
        <span>3. After delivery is finalized, the buyer reveals from the library using the same browser delivery keypair used at checkout.</span>
      </OverlayDialog>
    </div>
  );
}
