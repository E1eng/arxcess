"use client";

import { useEffect, useMemo, useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { randomHexId } from "@arxcess/sdk";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { NoticeToast } from "@/components/ui/notice-toast";
import { WalletAddress } from "@/components/ui/WalletAddress";
import { useDeliveryKeys } from "@/hooks/use-delivery-keys";
import { useProducts } from "@/hooks/use-products";
import { hasConfiguredProgramId, hasConfiguredTreasuryPublicKey } from "@/lib/anchor/client";
import { fetchOnchainProductStates, type DecodedProductState } from "@/lib/solana/account-state";
import { buildPurchaseTransaction } from "@/lib/solana/arxcess";
import { type LocalProductListing, type LocalPurchaseIntent, saveStoredPurchase } from "@/lib/storage/marketplace";
import { confirmTransactionOrThrow } from "@/lib/solana/transactions";
import { formatBytes, formatLicenseDuration } from "@/lib/utils/format";

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

  function resolveProductStatusCopy(product: LocalProductListing, onchain: DecodedProductState | undefined) {
    if (!onchain) {
      return {
        badge: "Encrypted listing",
        subtitle: "Preview only. Full asset unlocks after checkout."
      };
    }

    if (onchain.statusLabel === "draft" && onchain.arciumDepositComputationOffset !== 0 && !onchain.arciumCustodyReady) {
      return {
        badge: "Arcium custody queued",
        subtitle: "Publisher queued confidential custody and is waiting for the callback to settle before activation."
      };
    }

    if (onchain.statusLabel === "draft" && onchain.arciumCustodyReady) {
      return {
        badge: "Custody ready",
        subtitle: "Confidential custody is ready on-chain. The publisher can activate this listing next."
      };
    }

    return {
      badge: onchain.statusLabel,
      subtitle: "Preview only. Full asset unlocks after checkout."
    };
  }

  function canPurchaseProduct(product: LocalProductListing, onchain: DecodedProductState | undefined) {
    if (!onchain) {
      return false;
    }

    return onchain.statusLabel === "active";
  }

  const visibleProducts = useMemo(
    () => products.filter((product) => canPurchaseProduct(product, onchainProductStates[product.productIdHex])),
    [onchainProductStates, products]
  );

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

    const onchain = onchainProductStates[product.productIdHex];

    if (!canPurchaseProduct(product, onchain)) {
      setError("This listing is not active on-chain yet. Wait until the seller finishes activation before buying.");
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
        transactionSignature,
        deliveryMode: "arcium"
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
    <div className="grid gap-6">
      <section className="page-intro rounded-[var(--radius-xl)] border border-[color:var(--border)] bg-[color:rgba(12,21,37,0.64)] p-6 shadow-glass md:p-8">
        <div className="page-intro__top gap-4">
          <div>
            <span className="eyebrow">Explore</span>
            <h2 className="section-title text-3xl md:text-4xl">Browse encrypted digital products</h2>
            <p className="muted mt-3 max-w-2xl text-sm leading-7 md:text-base">Choose a product, complete checkout with your wallet, and unlock it later from Library once on-chain delivery is ready.</p>
          </div>
          <div className="page-intro__meta gap-3">
            <Badge variant="gray">{visibleProducts.length} products</Badge>
            {connectedWallet ? <WalletAddress address={connectedWallet} /> : <Badge variant="gray">Wallet not connected</Badge>}
          </div>
        </div>
      </section>

      {statusMessage ? (
        <div className="callout callout--info">
          <strong>Checkout status</strong>
          <span className="muted">{statusMessage}</span>
        </div>
      ) : null}

      {visibleProducts.length === 0 ? (
        <EmptyState
          icon="🔒"
          title="No products found"
          description="No products are live right now. New listings appear here automatically after their on-chain activation is complete."
        />
      ) : (
        <div className="catalog-grid">
          {visibleProducts.map((product) => {
            const onchain = onchainProductStates[product.productIdHex];
            const statusCopy = resolveProductStatusCopy(product, onchain);
            const canPurchase = canPurchaseProduct(product, onchain);

            return (
              <Card key={product.productIdHex} className="product-card p-0">
                <div className="relative overflow-hidden border-b border-[color:var(--border)] bg-[linear-gradient(135deg,rgba(124,58,237,0.18),rgba(12,21,37,0.9),rgba(6,182,212,0.14))] p-5">
                  <div className="mb-4 flex aspect-video items-center justify-center rounded-[var(--radius)] border border-dashed border-[color:var(--border2)] bg-[color:rgba(17,30,51,0.68)] text-5xl">
                    🔒
                  </div>
                  <div className="absolute right-4 top-4">
                    <Badge variant="violet">Encrypted</Badge>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Badge variant="cyan">{product.category}</Badge>
                    <Badge variant="gray">{statusCopy.badge}</Badge>
                    {product.policy.revocable ? <Badge variant="amber">Revocable</Badge> : null}
                  </div>
                </div>
                <div className="grid gap-5 p-5">
                  <div className="grid gap-2">
                    <h3 className="font-head text-2xl font-bold text-text">{product.title}</h3>
                    <p className="line-clamp-2 text-sm leading-7 text-text2">{product.description}</p>
                    <span className="text-xs leading-6 text-text2">{statusCopy.subtitle}</span>
                  </div>
                  <div className="grid gap-3 text-sm text-text2">
                    <div className="flex items-center justify-between gap-3">
                      <span>Price</span>
                      <strong className="font-mono text-base text-violet2">◎ {Number(product.priceSol).toFixed(4)}</strong>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <span>Asset size</span>
                      <strong>{formatBytes(product.fileSizeBytes)}</strong>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <span>Access window</span>
                      <strong>{formatLicenseDuration(product.policy.licenseDurationSeconds)}</strong>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <span>Reveal limit</span>
                      <strong>{product.policy.maxAccessCount}</strong>
                    </div>
                  </div>
                  <div className="flex items-center justify-between gap-3 border-t border-[color:var(--border)] pt-4">
                    <div className="min-w-0">
                      <div className="text-xs uppercase tracking-[0.1em] text-text3">Publisher</div>
                      {product.sellerWallet ? <WalletAddress address={product.sellerWallet} shortened /> : <span className="text-sm text-text2">Unknown</span>}
                    </div>
                    <Button type="button" variant="cyan" size="sm" onClick={() => void preparePurchase(product)} disabled={busyProductId === product.productIdHex || !canPurchase} loading={busyProductId === product.productIdHex}>
                      {busyProductId === product.productIdHex ? "Processing..." : "Buy →"}
                    </Button>
                  </div>
                </div>
              </Card>
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
