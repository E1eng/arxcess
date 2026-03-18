"use client";

import { useEffect, useMemo, useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { randomHexId } from "@arxcess/sdk";
import { CategoryIcon } from "@/components/marketplace/category-icon";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { NoticeToast } from "@/components/ui/notice-toast";
import { WalletAddress } from "@/components/ui/WalletAddress";
import { useDeliveryKeys } from "@/hooks/use-delivery-keys";
import { useProducts } from "@/hooks/use-products";
import { hasConfiguredProgramId, hasConfiguredTreasuryPublicKey } from "@/lib/anchor/client";
import { hasSupabasePurchasesPublicConfig, upsertMarketplacePurchase } from "@/lib/marketplace/purchases";
import { CATEGORY_LABELS, MARKETPLACE_CATEGORIES, normalizeMarketplaceCategory } from "@/lib/marketplace/categories";
import { fetchOnchainProductStates, type DecodedProductState } from "@/lib/solana/account-state";
import { buildPurchaseTransaction } from "@/lib/solana/arxcess";
import { type LocalProductListing, type LocalPurchaseIntent, saveStoredPurchase } from "@/lib/storage/marketplace";
import { confirmTransactionOrThrow } from "@/lib/solana/transactions";
import { formatBytes, formatLicenseDuration } from "@/lib/utils/format";

const CATEGORIES = MARKETPLACE_CATEGORIES;
type SortKey = "default" | "price_asc" | "price_desc";
type ExploreToast = {
  title: string;
  message: string;
  variant: "info" | "success";
};

export function ProductCatalog() {
  const { connection } = useConnection();
  const { publicKey, sendTransaction } = useWallet();
  const { products } = useProducts();
  const connectedWallet = useMemo(() => publicKey?.toBase58() ?? null, [publicKey]);
  const { ensureKeypair } = useDeliveryKeys(connectedWallet);
  const [busyProductId, setBusyProductId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [statusToast, setStatusToast] = useState<ExploreToast | null>(null);
  const [onchainProductStates, setOnchainProductStates] = useState<Record<string, DecodedProductState>>({});
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);
  const [sort, setSort] = useState<SortKey>("default");

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

  function resolveProductStatusCopy(onchain: DecodedProductState | undefined) {
    if (!onchain) {
      return {
        subtitle: "Preview only. Full asset unlocks after checkout."
      };
    }

    if (onchain.statusLabel === "draft" && onchain.arciumDepositComputationOffset !== 0 && !onchain.arciumCustodyReady) {
      return {
        subtitle: "Publisher queued confidential custody and is waiting for the callback to settle before activation."
      };
    }

    if (onchain.statusLabel === "draft" && onchain.arciumCustodyReady) {
      return {
        subtitle: "Confidential custody is ready on-chain. The publisher can activate this listing next."
      };
    }

    return {
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
      result = result.filter((p) => normalizeMarketplaceCategory(p.category) === categoryFilter);
    }
    if (sort === "price_asc") {
      result = [...result].sort((a, b) => Number(a.priceSol) - Number(b.priceSol));
    } else if (sort === "price_desc") {
      result = [...result].sort((a, b) => Number(b.priceSol) - Number(a.priceSol));
    }
    return result;
  }, [visibleProducts, search, categoryFilter, sort]);

  const summary = useMemo(() => {
    const floorPrice = visibleProducts.length > 0 ? Math.min(...visibleProducts.map((product) => Number(product.priceSol))) : null;

    return {
      filteredCount: filteredProducts.length,
      categoryCount: new Set(visibleProducts.map((product) => normalizeMarketplaceCategory(product.category))).size,
      revocableCount: visibleProducts.filter((product) => product.policy.revocable).length,
      floorPrice
    };
  }, [filteredProducts.length, visibleProducts]);

  const hasActiveFilters = Boolean(search || categoryFilter || sort !== "default");

  function showStatus(title: string, message: string, variant: ExploreToast["variant"] = "info") {
    setStatusToast({ title, message, variant });
  }

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
    showStatus("Checkout", "Preparing secure checkout...");

    try {
      const deliveryKeypair = ensureKeypair();
      const purchaseIdHex = randomHexId();
      showStatus("Checkout", "Building purchase transaction...");
      const { transaction } = await buildPurchaseTransaction({
        buyer: publicKey,
        listing: product,
        purchaseIdHex,
        buyerDeliveryPublicKeyBase64: deliveryKeypair.publicKeyBase64
      });
      const latestBlockhash = await connection.getLatestBlockhash();

      transaction.recentBlockhash = latestBlockhash.blockhash;

      showStatus("Checkout", "Waiting for wallet approval to pay on-chain...");
      const transactionSignature = await sendTransaction(transaction, connection);

      showStatus("Checkout", "Payment sent. Waiting for on-chain confirmation...");
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
        sellerWallet: product.sellerWallet,
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

      if (hasSupabasePurchasesPublicConfig()) {
        try {
          await upsertMarketplacePurchase(purchase);
        } catch {
        }
      }

      showStatus("Purchase confirmed", `${product.title} is now in your Library. Wait until delivery is ready.`, "success");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to execute on-chain purchase.");
      setStatusToast(null);
    } finally {
      setBusyProductId(null);
    }
  }

  return (
    <div className="flex flex-col gap-4">

      {/* ── Page header ──────────────────────────────────────── */}
      <div className="flex flex-col gap-6">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-widest text-[#5e5e73]">Explore</p>
          <h1 className="mt-1 font-head text-[28px] font-bold tracking-tight text-white sm:text-[32px]">Find live encrypted listings.</h1>
          <p className="mt-2 max-w-2xl text-[14px] leading-relaxed text-[#8b8b9d]">Browse active listings, compare pricing, and buy with a calmer, more consistent layout.</p>
        </div>

        {/* ── Filters & Stats ──────────────────────────────────────── */}
        <div className="grid gap-4 sm:grid-cols-[1fr_auto]">
          <div className="flex flex-col gap-4 rounded-2xl border border-[#1a1a2e] bg-gradient-to-br from-[#0b0b12] to-[#131320] p-5">
            <div className="grid gap-4 sm:grid-cols-3">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-[#5e5e73]">Showing</p>
                <div className="mt-1 flex items-baseline gap-2">
                  <span className="font-mono text-[24px] font-bold text-white">{summary.filteredCount}</span>
                </div>
                <p className="mt-0.5 text-[11px] text-[#8b8b9d]">Live listings after filters.</p>
              </div>
              <div className="border-t border-[#1a1a2e] pt-4 sm:border-l sm:border-t-0 sm:pl-5 sm:pt-0">
                <p className="text-[10px] font-bold uppercase tracking-widest text-[#5e5e73]">Floor Price</p>
                <div className="mt-1 flex items-baseline gap-1.5">
                  <span className="font-mono text-[24px] font-bold text-white">{summary.floorPrice === null ? "—" : summary.floorPrice.toFixed(3)}</span>
                  {summary.floorPrice === null ? null : <span className="font-mono text-[11px] font-bold text-purple-400">SOL</span>}
                </div>
                <p className="mt-0.5 text-[11px] text-[#8b8b9d]">Lowest active price.</p>
              </div>
              <div className="border-t border-[#1a1a2e] pt-4 sm:border-l sm:border-t-0 sm:pl-5 sm:pt-0">
                <p className="text-[10px] font-bold uppercase tracking-widest text-[#5e5e73]">Mix</p>
                <div className="mt-1 flex items-baseline gap-2">
                  <span className="font-mono text-[24px] font-bold text-white">{summary.categoryCount}</span>
                </div>
                <p className="mt-0.5 text-[11px] text-[#8b8b9d]">Media groups, {summary.revocableCount} revocable.</p>
              </div>
            </div>

            <div className="mt-1 border-t border-[#1a1a2e] pt-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <div className="relative flex-1">
                  <input
                    type="text"
                    placeholder="Search title or description..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="h-10 w-full rounded-lg border border-[#2e2e48] bg-[#0b0b12] pl-10 pr-10 text-[13px] text-white placeholder:text-[#5e5e73] focus:border-[#6B50FF] focus:outline-none focus:ring-1 focus:ring-[#6B50FF]"
                  />
                  <div className="absolute left-3 top-1/2 -translate-y-1/2 text-[#5e5e73]">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
                  </div>
                  {search ? (
                    <button
                      type="button"
                      onClick={() => setSearch("")}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-[#5e5e73] transition hover:text-white"
                      aria-label="Clear search"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                    </button>
                  ) : null}
                </div>
                
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setCategoryFilter(null)}
                    className={`inline-flex h-10 items-center justify-center rounded-lg border px-4 text-[11px] font-bold uppercase tracking-wider transition-colors ${categoryFilter === null ? "border-purple-500/50 bg-purple-500/10 text-purple-400" : "border-[#2e2e48] bg-transparent text-[#8b8b9d] hover:border-purple-500/30 hover:text-white"}`}
                  >
                    All
                  </button>
                  {CATEGORIES.map((cat) => (
                    <button
                      key={cat}
                      type="button"
                      onClick={() => setCategoryFilter(categoryFilter === cat ? null : cat)}
                      className={`inline-flex h-10 items-center gap-2 rounded-lg border px-4 text-[11px] font-bold uppercase tracking-wider transition-colors ${categoryFilter === cat ? "border-purple-500/50 bg-purple-500/10 text-purple-400" : "border-[#2e2e48] bg-transparent text-[#8b8b9d] hover:border-purple-500/30 hover:text-white"}`}
                    >
                      <CategoryIcon category={cat} className="h-3.5 w-3.5" />
                      {CATEGORY_LABELS[cat]}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
          
          <div className="flex flex-col gap-4">
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as SortKey)}
              className="h-10 w-full min-w-[180px] rounded-lg border border-[#2e2e48] bg-[#0b0b12] px-4 text-[12px] font-medium text-white focus:border-[#6B50FF] focus:outline-none focus:ring-1 focus:ring-[#6B50FF]"
            >
              <option value="default">Sort by Default</option>
              <option value="price_asc">Price: Low to High</option>
              <option value="price_desc">Price: High to Low</option>
            </select>
            {hasActiveFilters ? (
              <button 
                onClick={() => { setSearch(""); setCategoryFilter(null); setSort("default"); }}
                className="text-right text-[12px] text-purple-400 hover:text-purple-300 transition-colors"
              >
                Clear all filters
              </button>
            ) : null}
          </div>
        </div>
      </div>

      {/* ── Product list ─────────────────────────────────────── */}
      <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
        {filteredProducts.length === 0 ? (
          <div className="col-span-full flex flex-col items-center justify-center gap-4 rounded-2xl border border-dashed border-[#2e2e48] bg-[#0b0b12] p-16 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-[#1a1a2e] text-[#5e5e73]">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
            </div>
            <div>
              <p className="text-[14px] font-bold text-white">
                {visibleProducts.length === 0 ? "No active listings" : "No results found"}
              </p>
              <p className="mt-1 max-w-sm text-[13px] text-[#8b8b9d]">
                {visibleProducts.length === 0
                  ? "New listings appear after on-chain activation is complete."
                  : "Try adjusting your search or category filters to find what you're looking for."}
              </p>
            </div>
            {hasActiveFilters ? (
              <button type="button" onClick={() => { setSearch(""); setCategoryFilter(null); setSort("default"); }} className="mt-2 text-[13px] font-medium text-purple-400 hover:text-purple-300">
                Clear filters
              </button>
            ) : null}
          </div>
        ) : (
          filteredProducts.map((product) => {
            const onchain = onchainProductStates[product.productIdHex];
            const canPurchase = canPurchaseProduct(product, onchain);
            const isBusy = busyProductId === product.productIdHex;
            const statusCopy = resolveProductStatusCopy(onchain);
            const normalizedCategory = normalizeMarketplaceCategory(product.category);

            return (
              <div key={product.productIdHex} className="group flex flex-col overflow-hidden rounded-2xl border border-[#1a1a2e] bg-[#0b0b12] transition-all hover:-translate-y-1 hover:border-purple-500/30 hover:shadow-[0_8px_30px_rgba(107,80,255,0.1)]">
                
                {/* Card Header (Category & Badges) */}
                <div className="flex items-center justify-between border-b border-[#1a1a2e] bg-gradient-to-r from-[#131320] to-transparent px-5 py-4">
                  <div className="flex items-center gap-2.5">
                    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-purple-500/10 text-purple-400">
                      <CategoryIcon category={normalizedCategory} className="h-4 w-4" />
                    </div>
                    <span className="text-[11px] font-bold uppercase tracking-widest text-[#8b8b9d]">{CATEGORY_LABELS[normalizedCategory]}</span>
                  </div>
                  {product.policy.revocable ? (
                    <span className="inline-flex items-center rounded-full bg-red-500/10 px-2.5 py-1 text-[9px] font-bold uppercase tracking-wider text-red-400 border border-red-500/20">
                      Revocable
                    </span>
                  ) : null}
                </div>

                {/* Card Body (Title & Desc) */}
                <div className="flex-1 p-5">
                  <h3 className="line-clamp-2 text-[18px] font-bold leading-tight text-white group-hover:text-purple-400 transition-colors">{product.title}</h3>
                  <p className="mt-2 line-clamp-2 text-[13px] leading-relaxed text-[#8b8b9d]">{product.description}</p>
                  
                  {/* File Metadata Tags */}
                  <div className="mt-5 flex flex-wrap gap-2">
                    <span className="inline-flex items-center gap-1.5 rounded-md bg-[#1a1a2e] px-2.5 py-1 font-mono text-[10px] text-[#8b8b9d]">
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                      {formatBytes(product.fileSizeBytes)}
                    </span>
                    <span className="inline-flex items-center gap-1.5 rounded-md bg-[#1a1a2e] px-2.5 py-1 font-mono text-[10px] text-[#8b8b9d]">
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                      {formatLicenseDuration(product.policy.licenseDurationSeconds)}
                    </span>
                    <span className="inline-flex items-center gap-1.5 rounded-md bg-[#1a1a2e] px-2.5 py-1 font-mono text-[10px] text-[#8b8b9d]">
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                      {product.policy.maxAccessCount}× reveals
                    </span>
                  </div>
                </div>

                {/* Card Footer (Price & Action) */}
                <div className="border-t border-[#1a1a2e] bg-[#131320] p-5">
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-widest text-[#5e5e73]">Price</p>
                      <div className="mt-0.5 flex items-baseline gap-1.5">
                        <span className="font-mono text-[20px] font-bold text-white">{Number(product.priceSol).toFixed(3)}</span>
                        <span className="font-mono text-[11px] font-bold text-purple-400">SOL</span>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => void preparePurchase(product)}
                      disabled={isBusy || !canPurchase || !connectedWallet}
                      className="inline-flex h-10 items-center justify-center rounded-lg bg-gradient-to-r from-purple-600 to-purple-500 px-6 text-[12px] font-bold uppercase tracking-wider text-white shadow-[0_0_15px_rgba(168,85,247,0.4)] transition-all hover:scale-[1.02] disabled:pointer-events-none disabled:opacity-50"
                    >
                      {!connectedWallet ? "Connect" : isBusy ? "Buying..." : "Buy Now"}
                    </button>
                  </div>
                  
                  {/* Publisher Info (Compact) */}
                  <div className="mt-4 flex items-center justify-between border-t border-[#1a1a2e] pt-4">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-[#5e5e73]">Publisher</p>
                    {product.sellerWallet ? (
                      <WalletAddress address={product.sellerWallet} copyable={false} className="border-none bg-transparent p-0 text-[11px] text-[#8b8b9d] hover:text-white" />
                    ) : (
                      <span className="font-mono text-[11px] text-[#5e5e73]">Unknown</span>
                    )}
                  </div>
                </div>

              </div>
            );
          })
        )}
      </div>

      {!connectedWallet && filteredProducts.length > 0 ? (
        <div className="flex justify-center pt-8">
          <div className="inline-flex items-center gap-3 rounded-full border border-purple-500/30 bg-purple-500/10 px-6 py-2.5 text-[12px] text-purple-300">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
            Connect your wallet to purchase items
          </div>
        </div>
      ) : null}

      <NoticeToast message={error} open={Boolean(error)} onClose={() => setError(null)} />
      <NoticeToast message={statusToast?.message ?? null} title={statusToast?.title} variant={statusToast?.variant ?? "info"} open={Boolean(statusToast)} onClose={() => setStatusToast(null)} />
    </div>
  );
}
