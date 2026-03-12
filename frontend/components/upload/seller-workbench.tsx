"use client";

import Image from "next/image";
import { AnchorProvider } from "@coral-xyz/anchor";
import { ChangeEvent, FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useAnchorWallet, useConnection, useWallet } from "@solana/wallet-adapter-react";
import { randomHexId, type ProductMetadata } from "@arxcess/sdk";
import { getArciumFrontendBlockMessage, isArciumFrontendRuntimeReady, prepareListingCustody } from "@/lib/arcium/client";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input, Select, Textarea } from "@/components/ui/Input";
import { NoticeToast } from "@/components/ui/notice-toast";
import { WalletAddress } from "@/components/ui/WalletAddress";
import { StepIndicator } from "@/components/StepIndicator";
import { encryptFile } from "@/lib/crypto/content";
import { uploadCiphertextToPinata, uploadJsonToPinata } from "@/lib/ipfs/client";
import { hasConfiguredProgramId, hasConfiguredTreasuryPublicKey } from "@/lib/anchor/client";
import { createMarketplaceListing, hasSupabaseListingsPublicConfig } from "@/lib/marketplace/listings";
import { fetchOnchainProductStates } from "@/lib/solana/account-state";
import { buildActivateProductTransaction, buildCreateProductTransaction, buildRequestDepositProductKeyTransaction } from "@/lib/solana/arxcess";
import { solToLamports } from "@/lib/solana/amounts";
import { confirmTransactionOrThrow } from "@/lib/solana/transactions";
import { isMissingSupabaseListingsTableError } from "@/lib/supabase/listings";
import { type LocalProductListing, saveStoredProduct } from "@/lib/storage/marketplace";
import { formatBytes, formatLicenseDuration } from "@/lib/utils/format";

const initialForm = {
  title: "",
  description: "",
  category: "ebook",
  priceSol: "0.10",
  licenseDurationDays: "30",
  maxAccessCount: "3",
  revocable: true
};

function inferPreviewMode(file: File | null) {
  if (!file) {
    return "empty" as const;
  }

  if (file.type.startsWith("image/")) {
    return "image" as const;
  }

  return "file" as const;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function SellerWorkbench() {
  const { connection } = useConnection();
  const anchorWallet = useAnchorWallet();
  const { publicKey, sendTransaction } = useWallet();
  const [form, setForm] = useState(initialForm);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [activatingResult, setActivatingResult] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [filePreviewUrl, setFilePreviewUrl] = useState<string | null>(null);
  const [result, setResult] = useState<
    | {
        listing: LocalProductListing;
        keyCommitmentHex: string;
        publishSignature: string;
        activationSignature: string | null;
        activationRequired: boolean;
      }
    | null
  >(null);
  const sellerWallet = useMemo(() => publicKey?.toBase58() ?? null, [publicKey]);
  const isArciumPublishBlocked = !isArciumFrontendRuntimeReady();
  const selectedAssetLabel = file ? `${file.name} · ${formatBytes(file.size)}` : "Choose the asset you want to lock behind payment.";
  const previewMode = useMemo(() => inferPreviewMode(file), [file]);

  const activateListing = useCallback(async (listing: LocalProductListing) => {
    if (!publicKey || !sendTransaction) {
      throw new Error("Connect the seller wallet before activating the listing.");
    }

    const activateTx = await buildActivateProductTransaction({
      seller: publicKey,
      productIdHex: listing.productIdHex
    });
    const blockhash = await connection.getLatestBlockhash();

    activateTx.transaction.recentBlockhash = blockhash.blockhash;
    activateTx.transaction.feePayer = publicKey;

    setStatusMessage("Waiting for wallet approval to activate the listing...");
    const activationSignature = await sendTransaction(activateTx.transaction, connection);

    setStatusMessage("Activation sent. Waiting for on-chain confirmation...");
    await confirmTransactionOrThrow({
      connection,
      signature: activationSignature,
      blockhash: blockhash.blockhash,
      lastValidBlockHeight: blockhash.lastValidBlockHeight,
      label: "Activate listing"
    });

    return activationSignature;
  }, [connection, publicKey, sendTransaction]);

  const waitForArciumCustodyReady = useCallback(async (listing: LocalProductListing, maxPolls = 18, delayMs = 5000) => {
    for (let attempt = 0; attempt < maxPolls; attempt += 1) {
      const states = await fetchOnchainProductStates(connection, [listing]);
      const onchain = states[listing.productIdHex];

      if (onchain?.statusLabel === "active") {
        return {
          alreadyActive: true,
          ready: true
        };
      }

      if (onchain?.arciumCustodyReady) {
        return {
          alreadyActive: false,
          ready: true
        };
      }

      await sleep(delayMs);
    }

    return {
      alreadyActive: false,
      ready: false
    };
  }, [connection]);

  const publishListingToCatalog = useCallback(async (listing: LocalProductListing) => {
    let storedListing = listing;

    if (hasSupabaseListingsPublicConfig()) {
      setStatusMessage("Saving listing to shared catalog...");
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

    saveStoredProduct(storedListing);
    return storedListing;
  }, []);

  const handleActivateResultListing = useCallback(async () => {
    if (!result) {
      return;
    }

    setActivatingResult(true);
    setError(null);

    try {
      const readiness = await waitForArciumCustodyReady(result.listing, 1, 0);

      if (readiness.alreadyActive) {
        const storedListing = await publishListingToCatalog(result.listing);
        setResult((current) =>
          current
            ? {
                ...current,
                listing: storedListing,
                activationRequired: false
              }
            : current
        );
        setStatusMessage("Listing is active and now live in Explore.");
        return;
      }

      if (!readiness.ready) {
        throw new Error("Arcium custody has not settled on-chain yet. Try activating again shortly.");
      }

      const activationSignature = await activateListing(result.listing);
      const storedListing = await publishListingToCatalog(result.listing);
      setResult((current) =>
        current
          ? {
              ...current,
              listing: storedListing,
              activationRequired: false,
              activationSignature
            }
          : current
      );
      setStatusMessage("Listing activated successfully and is now live in Explore.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to activate listing.");
    } finally {
      setActivatingResult(false);
    }
  }, [activateListing, publishListingToCatalog, result, waitForArciumCustodyReady]);

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

  useEffect(() => {
    if (!result?.activationRequired || activatingResult) {
      return;
    }

    const pendingListing = result.listing;
    let cancelled = false;
    let timeoutId: number | null = null;

    async function continueActivation() {
      try {
        const readiness = await waitForArciumCustodyReady(pendingListing, 1, 0);

        if (cancelled) {
          return;
        }

        if (readiness.ready || readiness.alreadyActive) {
          await handleActivateResultListing();
          return;
        }

        timeoutId = window.setTimeout(() => {
          void continueActivation();
        }, 5000);
      } catch {
        timeoutId = window.setTimeout(() => {
          void continueActivation();
        }, 5000);
      }
    }

    void continueActivation();

    return () => {
      cancelled = true;

      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
      }
    };
  }, [activatingResult, handleActivateResultListing, result, waitForArciumCustodyReady]);

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

    if (isArciumPublishBlocked) {
      setError(getArciumFrontendBlockMessage("publish"));
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
      const anchorProvider = anchorWallet ? new AnchorProvider(connection, anchorWallet, AnchorProvider.defaultOptions()) : null;
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
      setStatusMessage("Preparing Arcium custody...");
      const custody = await prepareListingCustody({
        productIdHex,
        sellerWallet: publicKey.toBase58(),
        metadataUri: metadataUpload.gatewayUrl,
        ciphertextHashHex: encrypted.ciphertextHashHex,
        contentKeyBase64: encrypted.contentKeyBase64,
        ivBase64: encrypted.ivBase64
      }, {
        provider: anchorProvider ?? undefined
      });

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
        custodyMode: custody.custodyMode,
        keyCommitmentHex: custody.keyCommitmentHex,
        createdAt: new Date().toISOString()
      };

      if (!custody.arciumPublishMaterial) {
        throw new Error("Arcium publish material is missing.");
      }

      if (!custody.keyCommitmentHex) {
        throw new Error("Arcium publish is missing the product key commitment.");
      }

      const computationOffset = BigInt(Date.now());
      const createTx = await buildCreateProductTransaction({
        seller: publicKey,
        productIdHex,
        metadataUri: metadataUpload.gatewayUrl,
        ciphertextCid: ciphertextUpload.cid,
        ciphertextHashHex: encrypted.ciphertextHashHex,
        priceLamports: solToLamports(form.priceSol),
        fileSizeBytes: BigInt(encrypted.sizeBytes),
        licenseDurationSeconds,
        maxAccessCount,
        revocable: form.revocable
      });
      const requestTx = await buildRequestDepositProductKeyTransaction({
        seller: publicKey,
        productIdHex,
        computationOffset,
        sellerEncryptionPublicKey: custody.arciumPublishMaterial.sellerEncryptionPublicKey,
        encryptedKeyNonce: custody.arciumPublishMaterial.encryptedKeyNonce,
        encryptedKeyCiphertexts: custody.arciumPublishMaterial.encryptedKeyCiphertexts,
        keyCommitmentHex: custody.keyCommitmentHex
      });

      const publishSetupTransaction = createTx.transaction;
      const setupBlockhash = await connection.getLatestBlockhash();

      publishSetupTransaction.recentBlockhash = setupBlockhash.blockhash;
      publishSetupTransaction.feePayer = publicKey;

      setStatusMessage("Waiting for wallet approval to create the listing...");
      const publishSetupSignature = await sendTransaction(publishSetupTransaction, connection);

      setStatusMessage("Listing created. Waiting for on-chain confirmation before queueing Arcium custody...");
      await confirmTransactionOrThrow({
        connection,
        signature: publishSetupSignature,
        blockhash: setupBlockhash.blockhash,
        lastValidBlockHeight: setupBlockhash.lastValidBlockHeight,
        label: "Create product"
      });

      const requestBlockhash = await connection.getLatestBlockhash();

      requestTx.transaction.recentBlockhash = requestBlockhash.blockhash;
      requestTx.transaction.feePayer = publicKey;

      setStatusMessage("Waiting for wallet approval to queue Arcium custody...");
      const publishSignature = await sendTransaction(requestTx.transaction, connection);

      setStatusMessage("Arcium custody queued. Waiting for on-chain confirmation...");
      await confirmTransactionOrThrow({
        connection,
        signature: publishSignature,
        blockhash: requestBlockhash.blockhash,
        lastValidBlockHeight: requestBlockhash.lastValidBlockHeight,
        label: "Queue Arcium custody"
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

      setStatusMessage("Waiting for the confidential callback to settle before activation...");

      const readiness = await waitForArciumCustodyReady(storedListing, 12, 5000);
      let activationSignature: string | null = null;
      let activationRequired = false;

      if (readiness.alreadyActive) {
        setStatusMessage("Listing published successfully and is now live in Explore.");
      } else if (readiness.ready) {
        activationSignature = await activateListing(storedListing);
        setStatusMessage("Listing published successfully and is now live in Explore.");
      } else {
        activationRequired = true;
        setStatusMessage("Listing is being finalized. It will appear in Explore after activation completes.");
      }

      saveStoredProduct(storedListing);

      setResult({
        listing: storedListing,
        keyCommitmentHex: custody.keyCommitmentHex,
        publishSignature,
        activationSignature,
        activationRequired
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
    <div className="grid gap-6">
      <section className="page-intro rounded-[var(--radius-xl)] border border-[color:var(--border)] bg-[color:rgba(12,21,37,0.64)] p-6 shadow-glass md:p-8">
        <div className="page-intro__top gap-4">
          <div>
            <span className="eyebrow">Launch</span>
            <h2 className="section-title text-3xl md:text-4xl">Launch encrypted products</h2>
            <p className="muted mt-3 max-w-2xl text-sm leading-7 md:text-base">Create listing details, encrypt in-browser, set terms, and publish to Solana with Arcium custody.</p>
          </div>
          <div className="page-intro__meta gap-3">
            {sellerWallet ? <WalletAddress address={sellerWallet} /> : <Badge variant="gray">Wallet not connected</Badge>}
            <Badge variant="cyan">Custody: Arcium</Badge>
          </div>
        </div>
      </section>

      <StepIndicator steps={["Product Info", "Upload & Encrypt", "Set Terms", "Publish"]} currentStep={result ? 4 : busy ? 4 : file ? 2 : 1} />

      {isArciumPublishBlocked ? (
        <div className="callout callout--info">
          <strong>Arcium publish is unavailable</strong>
          <span className="muted">{getArciumFrontendBlockMessage("publish")}</span>
        </div>
      ) : null}

      <div className="grid grid-2 marketplace-split">
        <Card className="p-6 md:p-7">
          <div>
            <h2 className="section-title text-2xl md:text-3xl">Listing details</h2>
            <p className="muted mt-2 text-sm leading-7">Add the product info and the file buyers unlock after purchase.</p>
          </div>
          <form className="grid gap-5" onSubmit={handleSubmit}>
            <Input label="Product Name" name="title" required value={form.title} onChange={handleInputChange} placeholder="Premium concept art pack" />
            <Textarea label="Description" name="description" required value={form.description} onChange={handleInputChange} placeholder="Explain what unlocks after purchase." />
            <div className="grid grid-2">
              <Select label="Category" name="category" value={form.category} onChange={handleInputChange}>
                  <option value="ebook">ebook</option>
                  <option value="code">code</option>
                  <option value="image">image</option>
                  <option value="template">template</option>
                  <option value="dataset">dataset</option>
              </Select>
              <Input label="Price" name="priceSol" required inputMode="decimal" value={form.priceSol} onChange={handleInputChange} placeholder="0.10" suffix="SOL" />
            </div>
            <div className="grid grid-2">
              <Input label="Access Window (days)" name="licenseDurationDays" required inputMode="numeric" value={form.licenseDurationDays} onChange={handleInputChange} placeholder="30" hint="Buyer access expires after N days." />
              <Input label="Reveal Limit" name="maxAccessCount" required inputMode="numeric" value={form.maxAccessCount} onChange={handleInputChange} placeholder="3" hint="Max times buyer can download." />
            </div>
            <label className="checkbox-field">
              <input type="checkbox" name="revocable" checked={form.revocable} onChange={handleInputChange} />
              <span>
                <strong>Revocable access</strong>
                <span className="muted">Allow this purchase to be revoked later.</span>
              </span>
            </label>
            <label className="grid gap-3 text-sm text-text">
              <span className="font-medium">Upload & Encrypt</span>
              <div className="rounded-[var(--radius-lg)] border border-dashed border-[color:var(--border2)] bg-[color:rgba(17,30,51,0.45)] p-5 text-center">
                <div className="text-sm font-medium text-text">Drag & drop your file here</div>
                <div className="mt-1 text-xs text-text2">Supported: PDF, ZIP, PNG, MP4, etc</div>
                <div className="mt-1 text-xs text-text3">Max size depends on your browser and storage upload limits</div>
              </div>
              <input
                type="file"
                required
                onChange={(event) => {
                  setFile(event.target.files?.[0] ?? null);
                }}
              />
            </label>
            {file ? <Badge variant="cyan">Will be encrypted in browser before upload</Badge> : null}
            <div className="row">
              <Button type="submit" disabled={busy || !file || isArciumPublishBlocked} loading={busy}>
                {busy ? "Publishing..." : "Sign & Publish on Solana"}
              </Button>
            </div>
          </form>
          {statusMessage ? (
            <div className="callout callout--info">
              <strong>Publish status</strong>
              <span className="muted">{statusMessage}</span>
            </div>
          ) : null}
        </Card>

        <Card className="accent-card p-6 md:p-7">
          <div>
            <Badge variant="violet">Preview</Badge>
            <h3 className="section-title mt-4 text-2xl md:text-3xl">Listing preview</h3>
            <p className="muted mt-2 text-sm leading-7">Check the title, file, and state before publishing.</p>
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
                        ? "Preview is ready. The full file only unlocks after purchase and delivery."
                        : "Add a file to preview the locked product card before publishing."}
                    </span>
                  </div>
                )}
              </div>
              <Badge variant="violet">Encrypted asset</Badge>
              <strong>{form.title || "Untitled listing"}</strong>
              <span className="muted">{selectedAssetLabel}</span>
              <span className="asset-stage__lock">Locked until purchase</span>
            </div>
          </div>
          <div className="detail-list">
            <div className="detail-row">
              <span className="muted">Category</span>
              <strong>{form.category}</strong>
            </div>
            <div className="detail-row">
              <span className="muted">File</span>
              <strong>{selectedAssetLabel}</strong>
            </div>
            <div className="detail-row">
              <span className="muted">Access window</span>
              <strong>{formatLicenseDuration(Number(form.licenseDurationDays || 0) * 86400)}</strong>
            </div>
            <div className="detail-row">
              <span className="muted">Reveal limit</span>
              <strong>{form.maxAccessCount}</strong>
            </div>
            <div className="detail-row">
              <span className="muted">Revocable</span>
              <strong>{form.revocable ? "Yes" : "No"}</strong>
            </div>
          </div>
        </Card>
      </div>

      {result ? (
        <div className="callout callout--success">
          <div>
            <strong>Listing published</strong>
            <span className="muted">
              {result.activationRequired
                ? `${result.listing.title} is waiting for seller activation after the confidential callback settles.`
                : `${result.listing.title} is now live in Explore. New orders will show up in Library until delivery is ready.`}
            </span>
          </div>
          {result.activationRequired ? (
            <div className="row">
              <Button type="button" onClick={() => void handleActivateResultListing()} disabled={activatingResult} loading={activatingResult}>
                {activatingResult ? "Activating..." : "Activate listing"}
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}
      <NoticeToast message={error} open={Boolean(error)} onClose={() => setError(null)} />
    </div>
  );
}
