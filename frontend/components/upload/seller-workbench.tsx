"use client";

import Image from "next/image";
import { AnchorProvider } from "@coral-xyz/anchor";
import { ChangeEvent, FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useAnchorWallet, useConnection, useWallet } from "@solana/wallet-adapter-react";
import { randomHexId, type ProductMetadata } from "@arxcess/sdk";
import { getArciumFrontendBlockMessage, getConfiguredCustodyMode, isArciumFrontendRuntimeReady, prepareListingCustody } from "@/lib/arcium/client";
import { NoticeToast } from "@/components/ui/notice-toast";
import { encryptFile } from "@/lib/crypto/content";
import { uploadCiphertextToPinata, uploadJsonToPinata } from "@/lib/ipfs/client";
import { hasConfiguredProgramId, hasConfiguredTreasuryPublicKey } from "@/lib/anchor/client";
import { createMarketplaceListing, hasSupabaseListingsPublicConfig } from "@/lib/marketplace/listings";
import { fetchOnchainProductStates } from "@/lib/solana/account-state";
import { buildActivateProductTransaction, buildCreateListingTransaction, buildCreateProductTransaction, buildRequestDepositProductKeyTransaction, buildStageProductArciumMaterialTransaction } from "@/lib/solana/arxcess";
import { solToLamports } from "@/lib/solana/amounts";
import { confirmTransactionOrThrow } from "@/lib/solana/transactions";
import { isMissingSupabaseListingsTableError } from "@/lib/supabase/listings";
import { saveStoredSellerDeliveryMaterial, type LocalProductListing, saveStoredProduct } from "@/lib/storage/marketplace";
import { formatBytes, formatLicenseDuration, truncateValue } from "@/lib/utils/format";

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
        vaultHandleHex: string;
        publishSignature: string;
        activationSignature: string | null;
        activationRequired: boolean;
      }
    | null
  >(null);
  const sellerWallet = useMemo(() => publicKey?.toBase58() ?? null, [publicKey]);
  const configuredCustodyMode = getConfiguredCustodyMode();
  const isArciumMode = configuredCustodyMode === "arcium";
  const isArciumPublishBlocked = isArciumMode && !isArciumFrontendRuntimeReady("publish");
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
      setStatusMessage(configuredCustodyMode === "arcium" ? "Preparing Arcium custody..." : "Preparing explicit browser custody...");
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
        vaultHandleHex: custody.vaultHandleHex,
        keyCommitmentHex: custody.keyCommitmentHex,
        createdAt: new Date().toISOString()
      };

      let transaction;
      let keyCommitmentHex = custody.keyCommitmentHex;
      let vaultHandleHex = custody.vaultHandleHex;

      if (custody.custodyMode === "arcium") {
        if (!custody.arciumPublishMaterial) {
          throw new Error("Arcium publish material is missing.");
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
        const stageTx = await buildStageProductArciumMaterialTransaction({
          seller: publicKey,
          productIdHex,
          encryptedKeyNonce: custody.arciumPublishMaterial.encryptedKeyNonce,
          encryptedKeyCiphertexts: custody.arciumPublishMaterial.encryptedKeyCiphertexts
        });
        const requestTx = await buildRequestDepositProductKeyTransaction({
          seller: publicKey,
          productIdHex,
          computationOffset
        });

        const publishSetupTransaction = createTx.transaction.add(...stageTx.transaction.instructions);
        const setupBlockhash = await connection.getLatestBlockhash();

        publishSetupTransaction.recentBlockhash = setupBlockhash.blockhash;
        publishSetupTransaction.feePayer = publicKey;

        setStatusMessage("Waiting for wallet approval to create the listing and stage Arcium material...");
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

        if (custody.sellerDeliveryMaterial) {
          saveStoredSellerDeliveryMaterial(productIdHex, custody.sellerDeliveryMaterial);
        }
        setStatusMessage("Waiting for the confidential callback to settle before activation...");

        const readiness = await waitForArciumCustodyReady(storedListing, 12, 5000);
        let activationSignature: string | null = null;
        let activationRequired = false;

        if (readiness.alreadyActive) {
          storedListing = await publishListingToCatalog(storedListing);
          setStatusMessage("Listing published successfully and is now live in Explore.");
        } else if (readiness.ready) {
          activationSignature = await activateListing(storedListing);
          storedListing = await publishListingToCatalog(storedListing);
          setStatusMessage("Listing published successfully and is now live in Explore.");
        } else {
          activationRequired = true;
          setStatusMessage("Listing is being finalized. It will appear in Explore after activation completes.");
        }

        setResult({
          listing: storedListing,
          keyCommitmentHex: keyCommitmentHex ?? "",
          vaultHandleHex: vaultHandleHex ?? "",
          publishSignature,
          activationSignature,
          activationRequired
        });

        setForm(initialForm);
        setFile(null);
        return;
      } else {
        const legacy = await buildCreateListingTransaction({
          seller: publicKey,
          productIdHex,
          metadataUri: metadataUpload.gatewayUrl,
          ciphertextCid: ciphertextUpload.cid,
          ciphertextHashHex: encrypted.ciphertextHashHex,
          priceLamports: solToLamports(form.priceSol),
          fileSizeBytes: BigInt(encrypted.sizeBytes),
          vaultHandleHex: custody.vaultHandleHex!,
          keyCommitmentHex: custody.keyCommitmentHex!,
          licenseDurationSeconds,
          maxAccessCount,
          revocable: form.revocable
        });

        transaction = legacy.transaction;
        keyCommitmentHex = legacy.keyCommitmentHex;
        vaultHandleHex = legacy.vaultHandleHex;
      }

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

      if (custody.sellerDeliveryMaterial) {
        saveStoredSellerDeliveryMaterial(productIdHex, custody.sellerDeliveryMaterial);
      }
      saveStoredProduct(storedListing);
      setStatusMessage("Listing published successfully.");

      setResult({
        listing: storedListing,
        keyCommitmentHex: keyCommitmentHex ?? "",
        vaultHandleHex: vaultHandleHex ?? "",
        publishSignature,
        activationSignature: null,
        activationRequired: false
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
      <section className="card surface page-intro">
        <div className="page-intro__top">
          <div>
            <span className="eyebrow">Launch</span>
            <h2 className="section-title">Launch a locked product</h2>
            <p className="muted">Fill in the listing, upload the file, and publish.</p>
          </div>
          <div className="page-intro__meta">
            <span className="badge badge--neutral">Connected wallet: {sellerWallet ? truncateValue(sellerWallet, 12, 10) : "not connected"}</span>
            <span className="badge badge--neutral">Custody: {isArciumMode ? "Arcium configured" : "Browser demo"}</span>
          </div>
        </div>
      </section>

      {isArciumPublishBlocked ? (
        <div className="callout callout--info">
          <strong>Arcium publish is unavailable</strong>
          <span className="muted">{getArciumFrontendBlockMessage("publish")}</span>
        </div>
      ) : null}

      <div className="grid grid-2 marketplace-split">
        <div className="card surface">
          <div>
            <h2 className="section-title">Listing details</h2>
            <p className="muted">Add the product info and the file people unlock after purchase.</p>
          </div>
          <form className="grid" onSubmit={handleSubmit}>
            <label>
              Title
              <input name="title" required value={form.title} onChange={handleInputChange} placeholder="Premium concept art pack" />
            </label>
            <label>
              Description
              <textarea name="description" required value={form.description} onChange={handleInputChange} placeholder="Explain what unlocks after purchase." />
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
            <label className="checkbox-field">
              <input type="checkbox" name="revocable" checked={form.revocable} onChange={handleInputChange} />
              <span>
                <strong>Revocable access</strong>
                <span className="muted">Allow this purchase to be revoked later.</span>
              </span>
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
              <button className="button" type="submit" disabled={busy || !file || isArciumPublishBlocked}>
                {busy ? "Publishing..." : "Publish listing"}
              </button>
            </div>
          </form>
          {statusMessage ? (
            <div className="callout callout--info">
              <strong>Publish status</strong>
              <span className="muted">{statusMessage}</span>
            </div>
          ) : null}
        </div>

        <div className="card surface accent-card">
          <div>
            <span className="badge">Preview</span>
            <h3 className="section-title">Listing preview</h3>
            <p className="muted">Check the title, file, and state before publishing.</p>
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
              <span className="badge">Encrypted asset</span>
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
        </div>
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
              <button className="button" type="button" onClick={() => void handleActivateResultListing()} disabled={activatingResult}>
                {activatingResult ? "Activating..." : "Activate listing"}
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
      <NoticeToast message={error} open={Boolean(error)} onClose={() => setError(null)} />
    </div>
  );
}
