"use client";

import Image from "next/image";
import { ChangeEvent, FormEvent, useEffect, useMemo, useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { PROTOCOL_FEE_BPS, randomHexId, type ProductMetadata } from "@arxcess/sdk";
import { InfoButton, OverlayDialog } from "@/components/ui/overlay-dialog";
import { NoticeToast } from "@/components/ui/notice-toast";
import { encryptFile } from "@/lib/crypto/content";
import { uploadCiphertextToPinata, uploadJsonToPinata } from "@/lib/ipfs/client";
import { hasConfiguredProgramId, hasConfiguredTreasuryPublicKey } from "@/lib/anchor/client";
import { createMarketplaceListing, hasSupabaseListingsPublicConfig } from "@/lib/marketplace/listings";
import { buildCreateListingTransaction } from "@/lib/solana/arxcess";
import { solToLamports } from "@/lib/solana/amounts";
import { confirmTransactionOrThrow } from "@/lib/solana/transactions";
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

function inferPreviewMode(file: File | null) {
  if (!file) {
    return "empty" as const;
  }

  if (file.type.startsWith("image/")) {
    return "image" as const;
  }

  return "file" as const;
}

export function SellerWorkbench() {
  const { connection } = useConnection();
  const { publicKey, sendTransaction } = useWallet();
  const [form, setForm] = useState(initialForm);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [filePreviewUrl, setFilePreviewUrl] = useState<string | null>(null);
  const [isFlowDialogOpen, setIsFlowDialogOpen] = useState(false);
  const [result, setResult] = useState<
    | {
        listing: LocalProductListing;
        keyCommitmentHex: string;
        vaultHandleHex: string;
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
  const previewMode = useMemo(() => inferPreviewMode(file), [file]);

  useEffect(() => {
    if (!file || !file.type.startsWith("image/")) {
      setFilePreviewUrl(null);
      return;
    }

    const objectUrl = URL.createObjectURL(file);
    setFilePreviewUrl(objectUrl);

    return () => {
      URL.revokeObjectURL(objectUrl);
    };
  }, [file]);

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
    setStatusMessage("Encrypting the asset in your browser...");

    try {
      const encrypted = await encryptFile(file);
      const ciphertextBytes = Uint8Array.from(encrypted.ciphertext);
      setStatusMessage("Uploading ciphertext to Pinata...");
      const ciphertextUpload = await uploadCiphertextToPinata(new Blob([ciphertextBytes]), `${file.name}.enc`);
      const productIdHex = randomHexId();

      const metadata: ProductMetadata = {
        name: form.title,
        description: form.description,
        category: form.category,
        ciphertextCid: ciphertextUpload.cid,
        ivBase64: encrypted.ivBase64,
        mimeHint: encrypted.mimeType,
        sizeBytes: encrypted.sizeBytes,
        version: 1
      };

      setStatusMessage("Uploading metadata to Pinata...");
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

      setStatusMessage("Waiting for wallet approval to publish on-chain...");
      const publishSignature = await sendTransaction(transaction, connection);

      setStatusMessage("Transaction sent. Waiting for on-chain confirmation...");
      await confirmTransactionOrThrow({
        connection,
        signature: publishSignature,
        blockhash: latestBlockhash.blockhash,
        lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
        label: "Publish listing"
      });

      listing.publishSignature = publishSignature;

      let storedListing = listing;

      if (hasSupabaseListingsPublicConfig()) {
        setStatusMessage("Saving listing to shared Supabase catalog...");
        try {
          storedListing = await createMarketplaceListing(listing);
        } catch (cause) {
          const message = cause instanceof Error ? cause.message : "Failed to create listing.";

          if (!isMissingSupabaseListingsTableError(message)) {
            throw cause;
          }

          setError("Supabase listings table is unavailable. The listing was stored locally only.");
        }
      }

      saveStoredSellerDeliveryMaterial(productIdHex, {
        contentKeyBase64: encrypted.contentKeyBase64,
        ivBase64: encrypted.ivBase64,
        ciphertextHashHex: encrypted.ciphertextHashHex,
        keyCommitmentHex
      });
      saveStoredProduct(storedListing);
      setStatusMessage("Listing published successfully.");

      setResult({
        listing: storedListing,
        keyCommitmentHex,
        vaultHandleHex,
        publishSignature
      });

      setForm(initialForm);
      setFile(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to create listing.");
      setStatusMessage(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid">
      <div className="grid grid-2 marketplace-split">
        <div className="card surface">
          <div>
            <div className="title-with-action">
              <h2 className="section-title">Create encrypted listing</h2>
              <InfoButton label="View seller flow details" onClick={() => setIsFlowDialogOpen(true)} />
            </div>
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
                {busy ? "Publishing in progress..." : "Publish listing on-chain"}
              </button>
              <span className="badge">Seller wallet: {sellerWallet ?? "not connected"}</span>
            </div>
          </form>
          {statusMessage ? <div className="badge">{statusMessage}</div> : null}
        </div>

        <div className="card surface accent-card">
          <div>
            <span className="badge">Preview before publish</span>
            <h3 className="section-title">What buyers will understand first</h3>
            <p className="muted">They should see the offer, the price, and that the real asset only unlocks after purchase.</p>
          </div>
          <div className="asset-stage">
            <div className="asset-stage__media">
              <div className="asset-preview-frame">
                {previewMode === "image" && filePreviewUrl ? (
                  <Image className="asset-preview-image" src={filePreviewUrl} alt={file?.name ?? "Selected asset preview"} fill unoptimized />
                ) : (
                  <div className="asset-preview-placeholder">
                    <span className="badge">{file ? (file.type || "file").split("/")[0] : "No asset"}</span>
                    <strong>{file ? file.name : "Upload a file to preview it here"}</strong>
                    <span className="muted">
                      {file
                        ? "This public-facing preview helps the seller verify the listing before publishing."
                        : "For an MVP, this panel should preview the public cover or representative asset state before encryption."}
                    </span>
                  </div>
                )}
              </div>
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
              <span className="muted">Preview</span>
              <strong>{previewMode === "image" ? "Image thumbnail ready" : file ? "File metadata ready" : "No asset selected"}</strong>
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
                <div className="detail-row">
                  <span className="muted">Flow</span>
                  <strong>The listing is live, buyers can pay on-chain, and the seller finalizes sealed delivery before buyers reveal locally.</strong>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}
      <NoticeToast message={error} open={Boolean(error)} onClose={() => setError(null)} />
      <OverlayDialog open={isFlowDialogOpen} title="Seller flow" onClose={() => setIsFlowDialogOpen(false)}>
        <span>1. Seller encrypts the asset in the browser and uploads ciphertext plus metadata.</span>
        <span>2. The listing is published on-chain and the seller browser keeps the delivery material locally.</span>
        <span>3. When a buyer pays, the seller must finalize delivery from the seller environment that still has the delivery material.</span>
      </OverlayDialog>
    </div>
  );
}
