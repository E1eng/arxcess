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

const CATEGORIES = ["ebook", "code", "image", "template", "dataset"] as const;
type SortKey = "default" | "price_asc" | "price_desc";

const CATEGORY_ICONS: Record<(typeof CATEGORIES)[number], string> = {
  ebook: "◫",
  code: "<>",
  image: "▣",
  template: "◧",
  dataset: "#"
};

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
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);
  const [sort, setSort] = useState<SortKey>("default");
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

  const filteredProducts = useMemo(() => {
    let result = visibleProducts;
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(
        (p) => p.title.toLowerCase().includes(q) || p.description.toLowerCase().includes(q)
      );
    }
    if (categoryFilter) {
      result = result.filter((p) => p.category === categoryFilter);
    }
    if (sort === "price_asc") {
      result = [...result].sort((a, b) => Number(a.priceSol) - Number(b.priceSol));
    } else if (sort === "price_desc") {
      result = [...result].sort((a, b) => Number(b.priceSol) - Number(a.priceSol));
    }
    return result;
  }, [visibleProducts, search, categoryFilter, sort]);

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
    <div className="flex flex-col gap-4">

      {/* ── Page header ──────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center border border-[color:var(--border2)] bg-[color:var(--surface)] font-mono text-[12px] text-[#9B8FFF]">◎</div>
          <h1 className="font-head text-[16px] font-bold uppercase tracking-[0.08em] text-white">Explore</h1>
          <span className="border border-[color:var(--border2)] px-2 py-0.5 font-mono text-[10px] text-[color:var(--text2)]">
            {filteredProducts.length}/{visibleProducts.length}
          </span>
        </div>
        {/* Sort */}
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as SortKey)}
          className="border border-[color:var(--border2)] bg-black px-2 py-1.5 font-mono text-[10px] font-bold uppercase tracking-[0.08em] text-[color:var(--text2)] focus:outline-none focus:border-[#6B50FF]"
        >
          <option value="default">Sort: Default</option>
          <option value="price_asc">Price: Low → High</option>
          <option value="price_desc">Price: High → Low</option>
        </select>
      </div>

      {/* ── Search bar ───────────────────────────────────────── */}
      <div className="relative">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 font-mono text-[11px] text-[color:var(--text3)]">⌕</span>
        <input
          type="text"
          placeholder="Search products..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full border border-[color:var(--border)] bg-[color:var(--surface)] py-2 pl-8 pr-4 text-[12px] text-white placeholder:text-[color:var(--text3)] focus:border-[#6B50FF] focus:outline-none"
        />
        {search ? (
          <button
            type="button"
            onClick={() => setSearch("")}
            className="absolute right-3 top-1/2 -translate-y-1/2 font-mono text-[11px] text-[color:var(--text3)] hover:text-white"
          >
            ✕
          </button>
        ) : null}
      </div>

      {/* ── Category filter pills ─────────────────────────────── */}
      <div className="flex flex-wrap gap-1.5">
        <button
          type="button"
          onClick={() => setCategoryFilter(null)}
          className={`px-3 py-1 text-[10px] font-bold uppercase tracking-[0.1em] border transition-colors ${
            categoryFilter === null
              ? "border-[#6B50FF] bg-[#6B50FF] text-white"
              : "border-[color:var(--border2)] bg-transparent text-[color:var(--text2)] hover:border-white hover:text-white"
          }`}
        >
          All
        </button>
        {CATEGORIES.map((cat) => (
          <button
            key={cat}
            type="button"
            onClick={() => setCategoryFilter(categoryFilter === cat ? null : cat)}
            className={`px-3 py-1 text-[10px] font-bold uppercase tracking-[0.1em] border transition-colors ${
              categoryFilter === cat
                ? "border-[#6B50FF] bg-[#6B50FF] text-white"
                : "border-[color:var(--border2)] bg-transparent text-[color:var(--text2)] hover:border-white hover:text-white"
            }`}
          >
            {cat}
          </button>
        ))}
      </div>

      {/* Status callouts */}
      {statusMessage ? (
        <div className="callout callout--info">
          <strong>Checkout</strong>
          <span className="text-[color:var(--text2)]">{statusMessage}</span>
        </div>
      ) : null}

      {prepared ? (
        <div className="callout callout--success">
          <strong>Purchase confirmed</strong>
          <span className="text-[color:var(--text2)]">{prepared.product.title} — open Library to wait for delivery.</span>
        </div>
      ) : null}

      {/* ── Product list ─────────────────────────────────────── */}
      <div className="flex flex-col gap-px border border-[color:var(--border)] bg-[color:var(--border)]">
        {filteredProducts.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 bg-[color:var(--surface)] p-16 text-center">
            <span className="text-3xl">🔒</span>
            <p className="text-[11px] font-bold uppercase tracking-[0.1em] text-[color:var(--text2)]">
              {visibleProducts.length === 0 ? "No active listings" : "No results"}
            </p>
            <p className="max-w-xs text-xs text-[color:var(--text2)]">
              {visibleProducts.length === 0
                ? "New listings appear after on-chain activation is complete."
                : "Try a different search or filter."}
            </p>
            {(search || categoryFilter) ? (
              <button
                type="button"
                onClick={() => { setSearch(""); setCategoryFilter(null); }}
                className="mt-1 border border-[color:var(--border2)] px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.1em] text-[color:var(--text2)] hover:border-white hover:text-white"
              >
                Clear filters
              </button>
            ) : null}
          </div>
        ) : (
          filteredProducts.map((product) => {
            const onchain = onchainProductStates[product.productIdHex];
            const canPurchase = canPurchaseProduct(product, onchain);
            const isBusy = busyProductId === product.productIdHex;
            const statusCopy = resolveProductStatusCopy(product, onchain);

            return (
              <div key={product.productIdHex} className="flex flex-col gap-4 bg-[color:var(--surface)] px-4 py-4 transition-colors hover:bg-[color:var(--surface2)] sm:flex-row sm:items-start sm:px-5">
                {/* Info */}
                <div className="flex min-w-0 flex-1 gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center border border-[color:var(--border2)] bg-black font-mono text-[12px] text-[#9B8FFF]">
                    {CATEGORY_ICONS[product.category as keyof typeof CATEGORY_ICONS] ?? "•"}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
                      <Badge variant={canPurchase ? "green" : "gray"}>{statusCopy.badge}</Badge>
                      <Badge variant="gray">{product.category}</Badge>
                      {product.policy.revocable ? <Badge variant="amber">Revocable</Badge> : null}
                    </div>
                    <h3 className="truncate font-head text-sm font-bold text-white">{product.title}</h3>
                    <p className="mt-0.5 truncate text-[11px] text-[color:var(--text2)]">{product.description}</p>
                    <p className="mt-1 text-[11px] text-[color:var(--text3)]">{statusCopy.subtitle}</p>
                    <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 font-mono text-[11px] text-[color:var(--text2)]">
                      <span>{formatBytes(product.fileSizeBytes)}</span>
                      <span>{formatLicenseDuration(product.policy.licenseDurationSeconds)}</span>
                      <span>×{product.policy.maxAccessCount}</span>
                    </div>
                  </div>
                </div>
                {/* Price + buy */}
                <div className="flex shrink-0 flex-row items-center justify-between gap-3 sm:min-w-[116px] sm:flex-col sm:items-end">
                  <span className="font-mono text-sm font-bold text-[#9B8FFF]">◎ {Number(product.priceSol).toFixed(3)}</span>
                  <Button
                    type="button"
                    variant="violet"
                    size="sm"
                    onClick={() => void preparePurchase(product)}
                    disabled={isBusy || !canPurchase || !connectedWallet}
                    loading={isBusy}
                  >
                    {!connectedWallet ? "No wallet" : isBusy ? "..." : "Buy »"}
                  </Button>
                </div>
              </div>
            );
          })
        )}
      </div>

      {!connectedWallet ? (
        <p className="text-center text-[11px] text-[color:var(--text3)]">Connect your wallet from the top bar to purchase.</p>
      ) : null}

      <NoticeToast message={error} open={Boolean(error)} onClose={() => setError(null)} />
    </div>
  );
}
