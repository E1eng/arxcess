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
import { CATEGORY_LABELS, MARKETPLACE_CATEGORIES, normalizeMarketplaceCategory } from "@/lib/marketplace/categories";
import { fetchOnchainProductStates, type DecodedProductState } from "@/lib/solana/account-state";
import { buildPurchaseTransaction } from "@/lib/solana/arxcess";
import { type LocalProductListing, type LocalPurchaseIntent, saveStoredPurchase } from "@/lib/storage/marketplace";
import { confirmTransactionOrThrow } from "@/lib/solana/transactions";
import { formatBytes, formatLicenseDuration } from "@/lib/utils/format";

const CATEGORIES = MARKETPLACE_CATEGORIES;
type SortKey = "default" | "price_asc" | "price_desc";

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
      <div className="overflow-hidden rounded-[28px] border border-[color:var(--border)] bg-[linear-gradient(140deg,rgba(107,80,255,0.18),rgba(12,21,37,0.98)_55%,rgba(6,182,212,0.1))] shadow-[0_24px_80px_rgba(3,7,18,0.45)]">
        <div className="grid gap-4 p-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.95fr)] lg:p-5">
          <div className="flex flex-col gap-4">
            <div className="min-w-0">
              <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#9B8FFF]">Explore</p>
              <h1 className="mt-1 font-head text-[22px] font-bold tracking-[-0.03em] text-white sm:text-[28px]">Encrypted media worth unlocking.</h1>
              <p className="mt-2 max-w-2xl text-[13px] leading-6 text-[color:var(--text2)]">Filter by media type, scan pricing faster, and buy only listings that are already live on-chain.</p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <div className="rounded-[20px] border border-[color:var(--border)] bg-[rgba(12,21,37,0.72)] px-3.5 py-3 backdrop-blur">
                <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[color:var(--text3)]">Showing</p>
                <p className="mt-1.5 font-head text-[22px] font-bold text-white">{summary.filteredCount}</p>
                <p className="mt-1 text-[11px] text-[color:var(--text2)]">Visible after filters.</p>
              </div>
              <div className="rounded-[20px] border border-[color:var(--border)] bg-[rgba(12,21,37,0.72)] px-3.5 py-3 backdrop-blur">
                <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[color:var(--text3)]">Floor</p>
                <div className="mt-1.5 flex items-end gap-1.5">
                  <span className="font-head text-[22px] font-bold text-white">{summary.floorPrice === null ? "—" : summary.floorPrice.toFixed(3)}</span>
                  {summary.floorPrice === null ? null : <span className="pb-0.5 font-mono text-[10px] font-bold uppercase tracking-[0.08em] text-[color:var(--text3)]">SOL</span>}
                </div>
                <p className="mt-1 text-[11px] text-[color:var(--text2)]">Lowest live ask.</p>
              </div>
              <div className="rounded-[20px] border border-[color:var(--border)] bg-[rgba(12,21,37,0.72)] px-3.5 py-3 backdrop-blur">
                <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[color:var(--text3)]">Mix</p>
                <p className="mt-1.5 font-head text-[22px] font-bold text-white">{summary.categoryCount}</p>
                <p className="mt-1 text-[11px] text-[color:var(--text2)]">Media groups, {summary.revocableCount} revocable.</p>
              </div>
            </div>
          </div>
          <div className="rounded-[24px] border border-[color:var(--border)] bg-[rgba(5,10,20,0.8)] p-4 backdrop-blur-xl sm:p-4.5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#9B8FFF]">Controls</p>
                <h2 className="mt-1 font-head text-[18px] font-bold text-white">Refine quickly</h2>
              </div>
              {hasActiveFilters ? (
                <Button type="button" variant="ghost" size="sm" onClick={() => { setSearch(""); setCategoryFilter(null); setSort("default"); }}>
                  Reset
                </Button>
              ) : null}
            </div>
            <div className="mt-4 space-y-3">
              <div className="relative">
                <input
                  type="text"
                  placeholder="Search title or description"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="w-full rounded-[16px] border border-[color:var(--border)] bg-[color:var(--surface)] py-2.5 pl-4 pr-10 text-[13px] text-white placeholder:text-[color:var(--text3)] focus:border-[#6B50FF] focus:outline-none"
                />
                {search ? (
                  <button
                    type="button"
                    onClick={() => setSearch("")}
                    className="absolute right-4 top-1/2 -translate-y-1/2 text-[color:var(--text3)] transition hover:text-white"
                    aria-label="Clear search"
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                  </button>
                ) : null}
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setCategoryFilter(null)}
                  className={`inline-flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-[10px] font-bold uppercase tracking-[0.14em] transition ${categoryFilter === null ? "border-[#6B50FF] bg-[#6B50FF] text-white shadow-[0_10px_30px_rgba(107,80,255,0.28)]" : "border-[color:var(--border2)] bg-transparent text-[color:var(--text2)] hover:border-white hover:text-white"}`}
                >
                  All media
                </button>
                {CATEGORIES.map((cat) => (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => setCategoryFilter(categoryFilter === cat ? null : cat)}
                    className={`inline-flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-[10px] font-bold uppercase tracking-[0.14em] transition ${categoryFilter === cat ? "border-[#6B50FF] bg-[#6B50FF] text-white shadow-[0_10px_30px_rgba(107,80,255,0.28)]" : "border-[color:var(--border2)] bg-transparent text-[color:var(--text2)] hover:border-white hover:text-white"}`}
                  >
                    <CategoryIcon category={cat} className="h-3 w-3" />
                    {CATEGORY_LABELS[cat]}
                  </button>
                ))}
              </div>
              <select
                value={sort}
                onChange={(e) => setSort(e.target.value as SortKey)}
                className="h-10 w-full rounded-[16px] border border-[color:var(--border)] bg-[color:var(--surface)] px-4 font-mono text-[10px] font-bold uppercase tracking-[0.08em] text-[color:var(--text2)] focus:border-[#6B50FF] focus:outline-none"
              >
                <option value="default">Default sorting</option>
                <option value="price_asc">Price: low to high</option>
                <option value="price_desc">Price: high to low</option>
              </select>
            </div>
          </div>
        </div>
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
      <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
        {filteredProducts.length === 0 ? (
          <div className="md:col-span-2 2xl:col-span-3 flex flex-col items-center justify-center gap-3 rounded-[24px] border border-dashed border-[color:var(--border2)] bg-[rgba(12,21,37,0.74)] p-12 text-center backdrop-blur">
            <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-[color:var(--text2)]">
              {visibleProducts.length === 0 ? "No active listings" : "No results"}
            </p>
            <p className="max-w-md text-[13px] leading-6 text-[color:var(--text2)]">
              {visibleProducts.length === 0
                ? "New listings appear after on-chain activation is complete."
                : "Try a different search or filter."}
            </p>
            {hasActiveFilters ? (
              <Button type="button" variant="ghost" size="sm" onClick={() => { setSearch(""); setCategoryFilter(null); setSort("default"); }}>
                Clear filters
              </Button>
            ) : null}
          </div>
        ) : (
          filteredProducts.map((product) => {
            const onchain = onchainProductStates[product.productIdHex];
            const canPurchase = canPurchaseProduct(product, onchain);
            const isBusy = busyProductId === product.productIdHex;
            const statusCopy = resolveProductStatusCopy(onchain);
            const normalizedCategory = normalizeMarketplaceCategory(product.category);
            const categoryFrameClass = normalizedCategory === "image"
              ? "from-[#6B50FF]/25 via-[#6B50FF]/8 to-transparent text-[#9B8FFF]"
              : normalizedCategory === "video_gif"
                ? "from-cyan-400/20 via-cyan-400/8 to-transparent text-cyan-200"
                : "from-fuchsia-400/18 via-fuchsia-400/6 to-transparent text-fuchsia-200";

            return (
              <div key={product.productIdHex} className="group flex h-full flex-col overflow-hidden rounded-[24px] border border-[color:var(--border)] bg-[linear-gradient(180deg,rgba(12,21,37,0.96),rgba(12,21,37,0.84))] shadow-[0_18px_50px_rgba(3,7,18,0.45)] transition duration-200 hover:-translate-y-1 hover:border-[rgba(107,80,255,0.45)] hover:shadow-[0_28px_70px_rgba(3,7,18,0.62)]">
                <div className="relative overflow-hidden border-b border-[color:var(--border)] px-4 pb-4 pt-4">
                  <div className={`absolute inset-0 bg-gradient-to-br ${categoryFrameClass}`} />
                  <div className="relative flex items-start justify-between gap-3">
                    <div className="flex flex-wrap gap-2">
                      <Badge variant="gray">{CATEGORY_LABELS[normalizedCategory]}</Badge>
                      {product.policy.revocable ? <Badge variant="amber">Revocable</Badge> : null}
                    </div>
                    <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-white/10 bg-black/20 backdrop-blur text-white/90">
                      <CategoryIcon category={normalizedCategory} className="h-4.5 w-4.5" />
                    </div>
                  </div>

                  <div className="relative mt-8 flex min-h-[118px] flex-col justify-end rounded-[20px] border border-white/8 bg-[rgba(5,10,20,0.28)] p-3.5 backdrop-blur-sm">
                    <div className="mb-3 inline-flex w-fit items-center gap-2 rounded-full border border-white/10 bg-black/20 px-2.5 py-1 font-mono text-[9px] uppercase tracking-[0.14em] text-[color:var(--text2)]">
                      <span className="inline-block h-2 w-2 rounded-full bg-current opacity-80" />
                      Encrypted preview
                    </div>
                    <h3 className="line-clamp-2 font-head text-[18px] font-bold text-white">{product.title}</h3>
                    <p className="mt-1.5 line-clamp-3 text-[13px] leading-5 text-[color:var(--text2)]">{product.description}</p>
                  </div>
                </div>

                <div className="flex flex-1 flex-col gap-3.5 px-4 py-4">
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[color:var(--text3)]">Price</p>
                      <div className="mt-1 flex items-baseline gap-1.5">
                        <span className="font-mono text-[18px] font-bold text-white">{Number(product.priceSol).toFixed(3)}</span>
                        <span className="font-mono text-[10px] text-[color:var(--text3)]">SOL</span>
                      </div>
                    </div>
                    <Button
                      type="button"
                      variant="violet"
                      size="sm"
                      onClick={() => void preparePurchase(product)}
                      disabled={isBusy || !canPurchase || !connectedWallet}
                      loading={isBusy}
                    >
                      {!connectedWallet ? "Connect wallet" : isBusy ? "Buying..." : "Buy now"}
                    </Button>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-[color:var(--border)] bg-[rgba(5,10,20,0.5)] px-2.5 py-1 font-mono text-[9px] text-[color:var(--text2)]">
                      <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                      {formatBytes(product.fileSizeBytes)}
                    </span>
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-[color:var(--border)] bg-[rgba(5,10,20,0.5)] px-2.5 py-1 font-mono text-[9px] text-[color:var(--text2)]">
                      <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                      {formatLicenseDuration(product.policy.licenseDurationSeconds)}
                    </span>
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-[color:var(--border)] bg-[rgba(5,10,20,0.5)] px-2.5 py-1 font-mono text-[9px] text-[color:var(--text2)]">
                      <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                      {product.policy.maxAccessCount}× reveals
                    </span>
                  </div>

                  <div className="rounded-[18px] border border-[color:var(--border)] bg-[rgba(5,10,20,0.45)] p-3">
                    <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[color:var(--text3)]">Publisher</p>
                    {product.sellerWallet ? (
                      <div className="mt-2">
                        <WalletAddress address={product.sellerWallet} copyable={false} className="w-fit border-[color:var(--border2)] bg-transparent px-0 py-0 text-[11px]" />
                      </div>
                    ) : (
                      <p className="mt-2 font-mono text-[11px] text-[color:var(--text2)]">Wallet unavailable</p>
                    )}
                    <p className="mt-3 text-[10px] leading-5 text-[color:var(--text2)]">{statusCopy.subtitle}</p>
                  </div>
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
