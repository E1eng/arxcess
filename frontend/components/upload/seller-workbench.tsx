"use client";

import { ChangeEvent, FormEvent, useMemo, useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { PROTOCOL_FEE_BPS, randomHexId, type ProductMetadata } from "@arxcess/sdk";
import { encryptFile } from "@/lib/crypto/content";
import { uploadCiphertextToPinata, uploadJsonToPinata } from "@/lib/ipfs/client";
import { hasConfiguredProgramId, hasConfiguredTreasuryPublicKey } from "@/lib/anchor/client";
import { createMarketplaceListing, hasSupabaseListingsPublicConfig } from "@/lib/marketplace/listings";
import { buildCreateListingTransaction } from "@/lib/solana/arxcess";
import { solToLamports } from "@/lib/solana/amounts";
import { isMissingSupabaseListingsTableError } from "@/lib/supabase/listings";
import { saveStoredSellerDeliveryMaterial, type LocalProductListing, saveStoredProduct } from "@/lib/storage/marketplace";

const initialForm = {
  title: "",
  description: "",
  category: "ebook",
  priceSol: "0.10",
  licenseDurationDays: "30",
  maxAccessCount: "3",
  revocable: true
};

function formatBytes(bytes: number) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }

  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function truncateValue(value: string, head = 10, tail = 8) {
  if (value.length <= head + tail + 3) {
    return value;
  }

  return `${value.slice(0, head)}...${value.slice(-tail)}`;
}

export function SellerWorkbench() {
  const { connection } = useConnection();
  const { publicKey, sendTransaction } = useWallet();
  const [form, setForm] = useState(initialForm);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<
    | {
        listing: LocalProductListing;
        keyCommitmentHex: string;
        vaultHandleHex: string;
        protocolFeeBps: number;
        contentKeyBase64: string;
        ivBase64: string;
        publishSignature: string;
      }
    | null
  >(null);
  const sellerWallet = useMemo(() => publicKey?.toBase58() ?? null, [publicKey]);
  const selectedAssetLabel = file ? `${file.name} · ${formatBytes(file.size)}` : "Choose the asset you want to lock behind payment.";
  const estimatedFeeSol = useMemo(() => {
    const amount = Number(form.priceSol || 0);
    if (!Number.isFinite(amount)) {
      return "0.0000";
    }

    return ((amount * PROTOCOL_FEE_BPS) / 10_000).toFixed(4);
  }, [form.priceSol]);
  const estimatedSellerTakeHome = useMemo(() => {
    const amount = Number(form.priceSol || 0);
    if (!Number.isFinite(amount)) {
      return "0.0000";
    }

    return Math.max(amount - Number(estimatedFeeSol), 0).toFixed(4);
  }, [estimatedFeeSol, form.priceSol]);

  function handleInputChange(event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) {
    const value =
      event.target instanceof HTMLInputElement && event.target.type === "checkbox"
        ? event.target.checked
        : event.target.value;

    setForm((current) => ({
      ...current,
      [event.target.name]: value
    }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!publicKey || !sendTransaction) {
      setError("Connect a wallet before publishing on-chain.");
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

    if (!file) {
      setError("Select a file before creating a listing.");
      return;
    }

    const licenseDurationDays = Number(form.licenseDurationDays || 0);
    const maxAccessCount = Number(form.maxAccessCount || 0);

    if (!Number.isInteger(licenseDurationDays) || licenseDurationDays < 0) {
      setError("License duration must be a non-negative integer.");
      return;
    }

    if (!Number.isInteger(maxAccessCount) || maxAccessCount <= 0) {
      setError("Max access count must be greater than zero.");
      return;
    }

    const licenseDurationSeconds = licenseDurationDays * 24 * 60 * 60;

    setBusy(true);
    setError(null);
    setResult(null);

    try {
      const encrypted = await encryptFile(file);
      const ciphertextBytes = Uint8Array.from(encrypted.ciphertext);
      const ciphertextUpload = await uploadCiphertextToPinata(new Blob([ciphertextBytes]), `${file.name}.enc`);
      const productIdHex = randomHexId();

      const metadata: ProductMetadata = {
        name: form.title,
        description: form.description,
        category: form.category,
        ciphertextCid: ciphertextUpload.cid,
        mimeHint: encrypted.mimeType,
        sizeBytes: encrypted.sizeBytes,
        version: 1
      };

      const metadataUpload = await uploadJsonToPinata(metadata, `${productIdHex}-metadata`);

      const listing: LocalProductListing = {
        productIdHex,
        title: form.title,
        description: form.description,
        category: form.category,
        priceSol: form.priceSol,
        metadataCid: metadataUpload.cid,
        metadataGatewayUrl: metadataUpload.gatewayUrl,
        ciphertextCid: ciphertextUpload.cid,
        ciphertextGatewayUrl: ciphertextUpload.gatewayUrl,
        ciphertextHashHex: encrypted.ciphertextHashHex,
        mimeType: encrypted.mimeType,
        fileSizeBytes: encrypted.sizeBytes,
        sellerWallet,
        policy: {
          licenseDurationSeconds,
          maxAccessCount,
          revocable: form.revocable
        },
        createdAt: new Date().toISOString()
      };

      const { transaction, keyCommitmentHex, vaultHandleHex } = await buildCreateListingTransaction({
        seller: publicKey,
        productIdHex,
        metadataUri: metadataUpload.gatewayUrl,
        ciphertextCid: ciphertextUpload.cid,
        ciphertextHashHex: encrypted.ciphertextHashHex,
        priceLamports: solToLamports(form.priceSol),
        fileSizeBytes: BigInt(encrypted.sizeBytes),
        contentKeyBase64: encrypted.contentKeyBase64,
        licenseDurationSeconds,
        maxAccessCount,
        revocable: form.revocable
      });
      const latestBlockhash = await connection.getLatestBlockhash();

      transaction.recentBlockhash = latestBlockhash.blockhash;

      const publishSignature = await sendTransaction(transaction, connection);

      await connection.confirmTransaction(
        {
          signature: publishSignature,
          blockhash: latestBlockhash.blockhash,
          lastValidBlockHeight: latestBlockhash.lastValidBlockHeight
        },
        "confirmed"
      );

      listing.publishSignature = publishSignature;

      let storedListing = listing;

      if (hasSupabaseListingsPublicConfig()) {
        try {
          storedListing = await createMarketplaceListing(listing);
        } catch (cause) {
          const message = cause instanceof Error ? cause.message : "Failed to create listing.";

          if (!isMissingSupabaseListingsTableError(message)) {
            throw cause;
          }

          setError("Supabase table belum dibuat. Listing disimpan lokal dulu. Jalankan SQL di supabase/marketplace_listings.sql lalu refresh.");
        }
      }

      saveStoredSellerDeliveryMaterial(productIdHex, {
        contentKeyBase64: encrypted.contentKeyBase64,
        ivBase64: encrypted.ivBase64
      });
      saveStoredProduct(storedListing);

      setResult({
        listing: storedListing,
        protocolFeeBps: PROTOCOL_FEE_BPS,
        keyCommitmentHex,
        vaultHandleHex,
        contentKeyBase64: encrypted.contentKeyBase64,
        ivBase64: encrypted.ivBase64,
        publishSignature
      });

      setForm(initialForm);
      setFile(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to create listing.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid">
      <div className="grid grid-2 marketplace-split">
        <div className="card surface">
          <div>
            <h2 className="section-title">Create encrypted listing</h2>
            <p className="muted">Publish the commercial shell of your product while the full asset stays encrypted until a buyer pays.</p>
          </div>
          <form className="grid" onSubmit={handleSubmit}>
            <label>
              Title
              <input name="title" required value={form.title} onChange={handleInputChange} placeholder="Premium concept art pack" />
            </label>
            <label>
              Description
              <textarea name="description" required value={form.description} onChange={handleInputChange} placeholder="Explain what the buyer gets after unlock." />
            </label>
            <div className="grid grid-2">
              <label>
                Category
                <select name="category" value={form.category} onChange={handleInputChange}>
                  <option value="ebook">ebook</option>
                  <option value="code">code</option>
                  <option value="image">image</option>
                  <option value="template">template</option>
                  <option value="dataset">dataset</option>
                </select>
              </label>
              <label>
                Price (SOL)
                <input name="priceSol" required inputMode="decimal" value={form.priceSol} onChange={handleInputChange} placeholder="0.10" />
              </label>
            </div>
            <div className="grid grid-2">
              <label>
                License duration (days)
                <input name="licenseDurationDays" required inputMode="numeric" value={form.licenseDurationDays} onChange={handleInputChange} placeholder="30" />
              </label>
              <label>
                Max reveal count
                <input name="maxAccessCount" required inputMode="numeric" value={form.maxAccessCount} onChange={handleInputChange} placeholder="3" />
              </label>
            </div>
            <label className="row">
              <input type="checkbox" name="revocable" checked={form.revocable} onChange={handleInputChange} />
              <span>Seller can revoke access later</span>
            </label>
            <label>
              Asset file
              <input
                type="file"
                required
                onChange={(event) => {
                  setFile(event.target.files?.[0] ?? null);
                }}
              />
            </label>
            <div className="row">
              <button className="button" type="submit" disabled={busy || !file}>
                {busy ? "Encrypting, signing, and publishing..." : "Publish listing on-chain"}
              </button>
              <span className="badge">Seller wallet: {sellerWallet ?? "not connected"}</span>
            </div>
          </form>
          {error ? <div className="badge">{error}</div> : null}
        </div>

        <div className="card surface accent-card">
          <div>
            <span className="badge">Preview before publish</span>
            <h3 className="section-title">What buyers will understand first</h3>
            <p className="muted">They should see the offer, the price, and that the real asset only unlocks after purchase.</p>
          </div>
          <div className="asset-stage">
            <div className="asset-stage__media">
              <span className="badge">Encrypted asset</span>
              <strong>{form.title || "Untitled listing"}</strong>
              <span className="muted">{selectedAssetLabel}</span>
              <span className="asset-stage__lock">Locked until checkout + sealed delivery</span>
            </div>
            <div className="metric-grid">
              <div className="kpi compact-kpi">
                <span className="muted">Buyer price</span>
                <strong>{form.priceSol || "0.00"} SOL</strong>
              </div>
              <div className="kpi compact-kpi">
                <span className="muted">Protocol fee</span>
                <strong>{estimatedFeeSol} SOL</strong>
              </div>
              <div className="kpi compact-kpi">
                <span className="muted">Seller receives</span>
                <strong>{estimatedSellerTakeHome} SOL</strong>
              </div>
            </div>
          </div>
          <div className="detail-list">
            <div className="detail-row">
              <span className="muted">Category</span>
              <strong>{form.category}</strong>
            </div>
            <div className="detail-row">
              <span className="muted">Reveal mode</span>
              <strong>Decrypt after purchase</strong>
            </div>
            <div className="detail-row">
              <span className="muted">License duration</span>
              <strong>{form.licenseDurationDays} days</strong>
            </div>
            <div className="detail-row">
              <span className="muted">Max reveals</span>
              <strong>{form.maxAccessCount}</strong>
            </div>
            <div className="detail-row">
              <span className="muted">Revocable</span>
              <strong>{form.revocable ? "Yes" : "No"}</strong>
            </div>
            <div className="detail-row">
              <span className="muted">Publish path</span>
              <strong>Encrypt → Pinata → Wallet signature → Program publish</strong>
            </div>
          </div>
        </div>
      </div>

      {result ? (
        <div className="card surface">
          <div>
            <span className="badge">Listing published</span>
            <h3 className="section-title">Your listing is ready for the marketplace</h3>
            <p className="muted">The public storefront is now set. The encrypted file stays locked until a buyer completes checkout.</p>
          </div>
          <div className="grid grid-2 marketplace-split">
            <div className="asset-stage">
              <div className="asset-stage__media success">
                <span className="badge">{result.listing.category}</span>
                <strong>{result.listing.title}</strong>
                <span className="muted">{result.listing.description}</span>
                <span className="asset-stage__lock">Asset size {formatBytes(result.listing.fileSizeBytes)} · {result.listing.mimeType}</span>
              </div>
              <div className="row">
                <a className="button secondary" href={result.listing.metadataGatewayUrl} target="_blank" rel="noreferrer">
                  View metadata
                </a>
                <a className="button secondary" href={result.listing.ciphertextGatewayUrl} target="_blank" rel="noreferrer">
                  View ciphertext
                </a>
              </div>
            </div>
            <div className="grid">
              <div className="detail-list">
                <div className="detail-row">
                  <span className="muted">Product ID</span>
                  <strong>{truncateValue(result.listing.productIdHex)}</strong>
                </div>
                <div className="detail-row">
                  <span className="muted">Metadata CID</span>
                  <strong>{truncateValue(result.listing.metadataCid)}</strong>
                </div>
                <div className="detail-row">
                  <span className="muted">Ciphertext CID</span>
                  <strong>{truncateValue(result.listing.ciphertextCid)}</strong>
                </div>
                <div className="detail-row">
                  <span className="muted">Key commitment</span>
                  <strong>{truncateValue(result.keyCommitmentHex)}</strong>
                </div>
                <div className="detail-row">
                  <span className="muted">Vault handle</span>
                  <strong>{truncateValue(result.vaultHandleHex)}</strong>
                </div>
                <div className="detail-row">
                  <span className="muted">Publish tx</span>
                  <strong>{truncateValue(result.publishSignature, 16, 12)}</strong>
                </div>
                <div className="detail-row">
                  <span className="muted">License</span>
                  <strong>{result.listing.policy.licenseDurationSeconds === 0 ? "No expiry" : `${Math.floor(result.listing.policy.licenseDurationSeconds / 86400)} days`}</strong>
                </div>
                <div className="detail-row">
                  <span className="muted">Max reveals</span>
                  <strong>{result.listing.policy.maxAccessCount}</strong>
                </div>
              </div>
              <div className="timeline">
                <div className="timeline-item done">
                  <strong>1. Encrypt asset in browser</strong>
                  <span className="muted">The full file never left the browser unencrypted.</span>
                </div>
                <div className="timeline-item done">
                  <strong>2. Upload marketplace payload</strong>
                  <span className="muted">Metadata and ciphertext were pushed to Pinata.</span>
                </div>
                <div className="timeline-item done">
                  <strong>3. Sign publish transaction</strong>
                  <span className="muted">The wallet approved create, key deposit, and activation on Devnet.</span>
                </div>
                <div className="timeline-item active">
                  <strong>4. Wait for buyer checkout</strong>
                  <span className="muted">Next UX step is purchase, sealed delivery, and reveal.</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
