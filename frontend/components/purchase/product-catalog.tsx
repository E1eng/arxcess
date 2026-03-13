"use client";

import { useEffect, useMemo, useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { randomHexId } from "@arxcess/sdk";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { NoticeToast } from "@/components/ui/notice-toast";
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
    <div className="grid gap-px">

      {/* Page header bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 border border-[color:var(--border)] bg-[color:var(--surface)] px-5 py-3">
        <div className="flex items-center gap-3">
          <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-[color:var(--text2)]">Explore</span>
          <span className="border border-[color:var(--border2)] px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.1em] text-[color:var(--text2)]">{visibleProducts.length} active</span>
        </div>
        <div className="flex items-center gap-2">
          {connectedWallet ? (
            <span className="flex items-center gap-1.5 font-mono text-[11px] text-[color:var(--text2)]">
              <span className="h-1.5 w-1.5 rounded-full bg-[color:var(--green)]" />
              {connectedWallet.slice(0, 4)}…{connectedWallet.slice(-4)}
            </span>
          ) : (
            <span className="text-[11px] text-[color:var(--text2)]">Connect wallet to purchase</span>
          )}
        </div>
      </div>

      {/* Status / checkout feedback */}
      {statusMessage ? (
        <div className="callout callout--info">
          <strong className="text-[11px] uppercase tracking-[0.08em]">Checkout</strong>
          <span className="text-sm text-[color:var(--text2)]">{statusMessage}</span>
        </div>
      ) : null}

      {prepared ? (
        <div className="callout callout--success">
          <strong className="text-[11px] uppercase tracking-[0.08em]">Purchased</strong>
          <span className="text-sm text-[color:var(--text2)]">{prepared.product.title} — confirmed on-chain. Open Library to wait for delivery.</span>
        </div>
      ) : null}

      {/* Product list — full width */}
      <div className="grid gap-px border border-[color:var(--border)] bg-[color:var(--border)]">

        {/* Left: product list */}
        <div className="flex flex-col gap-px bg-[color:var(--border)]">
          {visibleProducts.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 bg-black p-16 text-center">
              <span className="text-3xl">🔒</span>
              <p className="text-[11px] font-bold uppercase tracking-[0.1em] text-[color:var(--text2)]">No active listings</p>
              <p className="max-w-xs text-xs text-[color:var(--text2)]">New listings appear here after on-chain activation is complete.</p>
            </div>
          ) : (
            visibleProducts.map((product) => {
              const onchain = onchainProductStates[product.productIdHex];
              const canPurchase = canPurchaseProduct(product, onchain);

              return (
                <div key={product.productIdHex} className="flex items-center gap-4 bg-[color:var(--surface)] px-5 py-4 transition-colors hover:bg-[color:var(--surface2)]">
                  {/* Left: category + title */}
                  <div className="min-w-0 flex-1">
                    <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
                      <Badge variant="gray">{product.category}</Badge>
                      {product.policy.revocable ? <Badge variant="amber">Revocable</Badge> : null}
                    </div>
                    <h3 className="truncate font-head text-sm font-bold text-white">{product.title}</h3>
                    <p className="mt-0.5 truncate text-[11px] text-[color:var(--text2)]">{product.description}</p>
                    <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] font-mono text-[color:var(--text3)]">
                      <span>{formatBytes(product.fileSizeBytes)}</span>
                      <span>{formatLicenseDuration(product.policy.licenseDurationSeconds)}</span>
                      <span>×{product.policy.maxAccessCount}</span>
                    </div>
                  </div>

                  {/* Right: price + buy */}
                  <div className="flex shrink-0 flex-col items-end gap-2">
                    <span className="font-mono text-sm font-bold text-[#9B8FFF]">◎ {Number(product.priceSol).toFixed(3)}</span>
                    <Button
                      type="button"
                      variant="violet"
                      size="sm"
                      onClick={() => void preparePurchase(product)}
                      disabled={busyProductId === product.productIdHex || !canPurchase}
                      loading={busyProductId === product.productIdHex}
                    >
                      {busyProductId === product.productIdHex ? "..." : "Buy"}
                    </Button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      <NoticeToast message={error} open={Boolean(error)} onClose={() => setError(null)} />
    </div>
  );
}
