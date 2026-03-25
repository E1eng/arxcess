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
import { useProducts } from "@/hooks/use-products";
import { CategoryIcon } from "@/components/marketplace/category-icon";
import { Input, Select, Textarea } from "@/components/ui/Input";
import { NoticeToast } from "@/components/ui/notice-toast";
import { WalletAddress } from "@/components/ui/WalletAddress";
import { StepIndicator } from "@/components/StepIndicator";
import { encryptFile } from "@/lib/crypto/content";
import { uploadCiphertextToPinata, uploadJsonToPinata } from "@/lib/ipfs/client";
import { hasConfiguredProgramId, hasConfiguredTreasuryPublicKey } from "@/lib/anchor/client";
import { createMarketplaceListing, hasSupabaseListingsPublicConfig } from "@/lib/marketplace/listings";
import { CATEGORY_LABELS, normalizeMarketplaceCategory } from "@/lib/marketplace/categories";
import { fetchOnchainProductStates } from "@/lib/solana/account-state";
import { buildActivateProductTransaction, buildCreateProductTransaction, buildDepositProductKeyTransaction, buildStageProductArciumMaterialTransaction } from "@/lib/solana/arxcess";
import { solToLamports } from "@/lib/solana/amounts";
import { confirmTransactionOrThrow } from "@/lib/solana/transactions";
import { isMissingSupabaseListingsTableError } from "@/lib/supabase/listings";
import { type LocalProductListing, listStoredProducts, saveStoredProduct } from "@/lib/storage/marketplace";
import { formatBytes, formatLicenseDuration, truncateValue } from "@/lib/utils/format";
import { SolLogo } from "@/components/ui/SolLogo";

const initialForm = {
  title: "",
  description: "",
  category: "image",
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

function randomBigInt(byteLength: number) {
  const bytes = crypto.getRandomValues(new Uint8Array(byteLength));
  let value = 0n;

  for (const byte of bytes) {
    value = (value << 8n) | BigInt(byte);
  }

  return value;
}

function explorerTxUrl(signature: string) {
  return `https://explorer.solana.com/tx/${signature}?cluster=devnet`;
}

type LaunchResult = {
  listing: LocalProductListing;
  keyCommitmentHex: string;
  publishSignature: string;
  activationSignature: string | null;
  activationRequired: boolean;
  custodySettled: boolean;
};

export function SellerWorkbench() {
  const { products } = useProducts();
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
  const [result, setResult] = useState<LaunchResult | null>(null);
  const sellerWallet = useMemo(() => publicKey?.toBase58() ?? null, [publicKey]);
  const isArciumPublishBlocked = !isArciumFrontendRuntimeReady();
  const selectedAssetLabel = file ? `${file.name} · ${formatBytes(file.size)}` : "Choose the asset you want to lock behind payment.";
  const previewMode = useMemo(() => inferPreviewMode(file), [file]);
  const normalizedCategory = normalizeMarketplaceCategory(form.category);
  const buildResultState = useCallback((listing: LocalProductListing, overrides?: Partial<LaunchResult>): LaunchResult => ({
    listing,
    keyCommitmentHex: overrides?.keyCommitmentHex ?? listing.keyCommitmentHex ?? "",
    publishSignature: overrides?.publishSignature ?? listing.publishSignature ?? "",
    activationSignature: overrides?.activationSignature ?? listing.activationSignature ?? null,
    activationRequired: overrides?.activationRequired ?? false,
    custodySettled: overrides?.custodySettled ?? false
  }), []);

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
      setStatusMessage("Saving listing to the shared database...");
      try {
        storedListing = await createMarketplaceListing(listing);
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : "Failed to create listing.";

        if (!isMissingSupabaseListingsTableError(message)) {
          throw cause;
        }

        setError("The shared listings database is unavailable. The listing was stored locally only.");
      }
    }

    saveStoredProduct(storedListing);
    return storedListing;
  }, []);

  useEffect(() => {
    if (!sellerWallet) {
      setResult(null);
      return;
    }

    if (result?.listing.sellerWallet === sellerWallet) {
      return;
    }

    const latestListing = [...products, ...listStoredProducts()]
      .filter((entry) => entry.sellerWallet === sellerWallet && entry.publishSignature)
      .filter((entry, index, all) => all.findIndex((candidate) => candidate.productIdHex === entry.productIdHex) === index)
      .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))[0];

    if (!latestListing?.publishSignature) {
      return;
    }

    let cancelled = false;

    async function hydrateStoredLaunch() {
      const onchain = (await fetchOnchainProductStates(connection, [latestListing]))[latestListing.productIdHex];

      if (cancelled) {
        return;
      }

      if (onchain?.statusLabel === "active") {
        setResult(buildResultState(latestListing, {
          activationRequired: false,
          custodySettled: true
        }));
        return;
      }

      if (onchain?.arciumCustodyReady) {
        setResult(buildResultState(latestListing, {
          activationRequired: true,
          custodySettled: true
        }));
        return;
      }

      setResult(buildResultState(latestListing, {
        activationRequired: true,
        custodySettled: false
      }));
    }

    void hydrateStoredLaunch();

    return () => {
      cancelled = true;
    };
  }, [buildResultState, connection, products, result?.listing.sellerWallet, sellerWallet]);

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
        setResult((current) => current ? buildResultState(storedListing, {
          ...current,
          activationRequired: false,
          custodySettled: true
        }) : current);
        setStatusMessage("Listing is active and now live in Explore.");
        return;
      }

      if (!readiness.ready) {
        throw new Error("Arcium custody has not settled on-chain yet. Try activating again shortly.");
      }

      const activationSignature = await activateListing(result.listing);
      const listingWithActivation = {
        ...result.listing,
        activationSignature
      };
      const storedListing = await publishListingToCatalog(listingWithActivation);
      setResult((current) => current ? buildResultState(storedListing, {
        ...current,
        activationRequired: false,
        activationSignature,
        custodySettled: true
      }) : current);
      setStatusMessage("Listing activated successfully and is now live in Explore.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to activate listing.");
    } finally {
      setActivatingResult(false);
    }
  }, [activateListing, buildResultState, publishListingToCatalog, result, waitForArciumCustodyReady]);

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
      setStatusMessage("Uploading encrypted asset to IPFS...");
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

      setStatusMessage("Uploading listing metadata to IPFS...");
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
        encryptedKeyCiphertexts: custody.arciumPublishMaterial.encryptedKeyCiphertexts,
        keyCommitmentHex: custody.keyCommitmentHex
      });
      const depositTx = await buildDepositProductKeyTransaction({
        seller: publicKey,
        productIdHex,
        sellerEncryptionPublicKey: custody.arciumPublishMaterial.sellerEncryptionPublicKey,
        keyCommitmentHex: custody.keyCommitmentHex
      });
      const activateTx = await buildActivateProductTransaction({
        seller: publicKey,
        productIdHex
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

      const publishTx = stageTx.transaction
        .add(...depositTx.transaction.instructions)
        .add(...activateTx.transaction.instructions);
      const publishBlockhash = await connection.getLatestBlockhash();

      publishTx.recentBlockhash = publishBlockhash.blockhash;
      publishTx.feePayer = publicKey;

      setStatusMessage("Waiting for wallet approval to stage Arcium custody and activate the listing...");
      const publishSignature = await sendTransaction(publishTx, connection);

      setStatusMessage("Finalizing Arcium custody and activation on-chain...");
      await confirmTransactionOrThrow({
        connection,
        signature: publishSignature,
        blockhash: publishBlockhash.blockhash,
        lastValidBlockHeight: publishBlockhash.lastValidBlockHeight,
        label: "Stage Arcium custody and activate listing"
      });

      listing.publishSignature = publishSignature;
      listing.activationSignature = publishSignature;

      let storedListing = listing;

      if (hasSupabaseListingsPublicConfig()) {
        setStatusMessage("Saving listing to the shared database...");
        try {
          storedListing = await createMarketplaceListing(listing);
        } catch (cause) {
          const message = cause instanceof Error ? cause.message : "Failed to create listing.";

          if (!isMissingSupabaseListingsTableError(message)) {
            throw cause;
          }

          setError("The shared listings database is unavailable. The listing was stored locally only.");
        }
      }

      const activationSignature = publishSignature;
      const activationRequired = false;

      setStatusMessage("Listing published successfully and is now live in Explore.");

      saveStoredProduct(storedListing);

      setResult(buildResultState(storedListing, {
        keyCommitmentHex: custody.keyCommitmentHex,
        publishSignature,
        activationSignature,
        activationRequired,
        custodySettled: true
      }));

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
    <div className="grid gap-px">

      {/* Page header bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 border border-[color:var(--border)] bg-[color:var(--surface)] px-5 py-3">
        <div className="flex items-center gap-3">
          <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-[color:var(--text2)]">Launch</span>
          <Badge variant="violet">Arcium Custody</Badge>
          {isArciumPublishBlocked ? <Badge variant="red">Unavailable</Badge> : <Badge variant="green">Ready</Badge>}
        </div>
        <div className="flex items-center gap-2">
          {sellerWallet ? (
            <WalletAddress address={sellerWallet} shortened />
          ) : (
            <span className="text-[11px] text-[color:var(--text2)]">Connect wallet to publish</span>
          )}
        </div>
      </div>

      {/* Status callouts */}
      {isArciumPublishBlocked ? (
        <div className="callout callout--info">
          <strong>Arcium unavailable</strong>
          <span className="text-[color:var(--text2)]">{getArciumFrontendBlockMessage("publish")}</span>
        </div>
      ) : null}

      {statusMessage ? (
        <div className="callout callout--info">
          <strong>Status</strong>
          <span className="text-[color:var(--text2)]">{statusMessage}</span>
        </div>
      ) : null}

      {result ? (
        <div className="callout callout--success">
          <strong>Published!</strong>
          <span className="text-[color:var(--text2)]">
            {result.activationRequired
              ? result.custodySettled
                ? `${result.listing.title}: custody has settled on-chain and the listing is ready to activate.`
                : `${result.listing.title}: custody was queued successfully and is waiting for the Arcium callback.`
              : `${result.listing.title} is now live in Explore.`}
          </span>
          <div className="mt-3 overflow-hidden border border-[color:var(--border)]">
            <div className="flex items-center justify-between border-b border-[color:var(--border)] bg-[#0d0d14] px-3 py-2">
              <span className="flex items-center gap-2 text-[9px] font-bold uppercase tracking-[0.14em] text-[#9B8FFF]">
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#6B50FF" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
                Arcium proof
              </span>
              <Badge variant={result.activationRequired ? (result.custodySettled ? "violet" : "amber") : "green"}>
                {result.activationRequired ? (result.custodySettled ? "Ready to activate" : "Awaiting callback") : "Live"}
              </Badge>
            </div>
            <div className="grid gap-px bg-[color:var(--border)] sm:grid-cols-3">
              <div className="flex flex-col gap-2 bg-[color:var(--surface)] p-3">
                <span className="flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-[0.12em] text-[color:var(--text3)]">
                  <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                  Queue tx
                </span>
                <a
                  href={explorerTxUrl(result.publishSignature)}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-1 font-mono text-[11px] text-[#9B8FFF] underline-offset-2 hover:underline"
                >
                  <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
                  {truncateValue(result.publishSignature, 10, 10)}
                </a>
                <span className="text-[11px] text-[color:var(--text3)]">
                  {result.activationRequired
                    ? "This transaction only queues confidential custody on Arcium."
                    : "This transaction staged Arcium custody material and brought the listing live."}
                </span>
              </div>
              <div className="flex flex-col gap-2 bg-[color:var(--surface)] p-3">
                <span className="flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-[0.12em] text-[color:var(--text3)]">
                  <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>
                  Custody settlement
                </span>
                <span className="font-mono text-[11px] text-white">
                  {result.activationRequired
                    ? result.custodySettled
                      ? "Callback settled"
                      : "Waiting for Arcium callback"
                    : "Settled on-chain"}
                </span>
                <span className="text-[11px] text-[color:var(--text3)]">
                  {result.activationRequired
                    ? result.custodySettled
                      ? "The callback completed successfully. You can activate the listing now."
                      : "The request transaction landed, but the custody callback has not completed yet."
                    : "The callback completed and the listing is already live."}
                </span>
              </div>
              <div className="flex flex-col gap-2 bg-[color:var(--surface)] p-3">
                <span className="flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-[0.12em] text-[color:var(--text3)]">
                  <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
                  Activation tx
                </span>
                {result.activationSignature ? (
                  <a
                    href={explorerTxUrl(result.activationSignature)}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-1 font-mono text-[11px] text-[#9B8FFF] underline-offset-2 hover:underline"
                  >
                    <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
                    {truncateValue(result.activationSignature, 10, 10)}
                  </a>
                ) : (
                  <span className="font-mono text-[11px] text-[color:var(--text3)]">{result.activationRequired ? "Not sent yet" : "Already active"}</span>
                )}
              </div>
            </div>
          </div>
          {result.activationRequired && result.custodySettled ? (
            <Button type="button" size="sm" variant="secondary" onClick={() => void handleActivateResultListing()} disabled={activatingResult} loading={activatingResult}>
              {activatingResult ? "Activating..." : "Activate listing"}
            </Button>
          ) : null}
        </div>
      ) : null}

      {/* 2-col: form left, preview+panels right */}
      <div className="grid gap-6 lg:grid-cols-[1.2fr_1fr]">

        {/* Left: form */}
        <div className="flex flex-col gap-6 rounded-2xl border border-[#1a1a2e] bg-[#0b0b12] p-8">
          <div>
            <h2 className="text-xl font-bold text-white">Create Listing</h2>
            <p className="mt-1 text-[13px] text-[#8b8b9d]">Publish an encrypted digital asset to the marketplace.</p>
          </div>

          <form className="grid gap-6" onSubmit={handleSubmit}>
            <Input label="Product name" name="title" required value={form.title} onChange={handleInputChange} placeholder="e.g. Premium design kit" />
            <Textarea label="Description" name="description" required value={form.description} onChange={handleInputChange} placeholder="What does the buyer get after purchase?" />
            <div className="grid gap-5 sm:grid-cols-2">
              <Select label="Category" name="category" value={form.category} onChange={handleInputChange}>
                <option value="image">Image</option>
                <option value="video_gif">Video / GIF</option>
                <option value="other">Other</option>
              </Select>
              <Input label="Price (SOL)" name="priceSol" required inputMode="decimal" value={form.priceSol} onChange={handleInputChange} placeholder="0.10" suffix="SOL" />
            </div>
            <div className="grid gap-5 sm:grid-cols-2">
              <Input label="Access window (days)" name="licenseDurationDays" required inputMode="numeric" value={form.licenseDurationDays} onChange={handleInputChange} placeholder="30" hint="Buyer access expires after N days" />
              <Input label="Reveal limit" name="maxAccessCount" required inputMode="numeric" value={form.maxAccessCount} onChange={handleInputChange} placeholder="3" hint="Max times buyer can download" />
            </div>
            
            <label className="group flex cursor-pointer items-start gap-4 rounded-xl border border-[#1a1a2e] bg-[#131320] p-4 transition-colors hover:border-[#6B50FF]/50">
              <input type="checkbox" name="revocable" checked={form.revocable} onChange={handleInputChange} className="mt-1 h-4 w-4 rounded border-[#2e2e48] bg-black text-[#6B50FF] focus:ring-[#6B50FF] focus:ring-offset-0" />
              <div>
                <strong className="block text-[14px] font-medium text-white">Revocable access</strong>
                <span className="block mt-0.5 text-[12px] text-[#8b8b9d]">Allow revoking buyer access after sale.</span>
              </div>
            </label>

            {/* File upload */}
            <label className="group grid cursor-pointer gap-2">
              <span className="text-[12px] font-bold uppercase tracking-wider text-[#5e5e73]">Asset file</span>
              <div className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-[#2e2e48] bg-gradient-to-b from-[#131320] to-[#0b0b12] p-8 text-center transition-all group-hover:border-[#6B50FF]/50 group-hover:bg-[#131320]">
                {file ? (
                  <div className="flex flex-col items-center gap-2">
                    <div className="flex h-12 w-12 items-center justify-center rounded-full bg-purple-500/10 text-purple-400">
                      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/><path d="m9 15 3 3 3-3"/><path d="M12 12v6"/></svg>
                    </div>
                    <span className="font-mono text-[14px] font-bold text-white">{file.name}</span>
                    <span className="text-[12px] text-[#8b8b9d]">{formatBytes(file.size)} · Will be encrypted before upload</span>
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-2">
                    <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[#1a1a2e] text-[#5e5e73] group-hover:text-purple-400 group-hover:bg-purple-500/10 transition-colors">
                      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" x2="12" y1="3" y2="15"/></svg>
                    </div>
                    <span className="text-[14px] font-medium text-white">Click to select a file</span>
                    <span className="text-[12px] text-[#8b8b9d]">Any format · Encrypted in-browser before upload</span>
                  </div>
                )}
              </div>
              <input type="file" required className="sr-only" onChange={(event) => { setFile(event.target.files?.[0] ?? null); }} />
            </label>

            <button
              type="submit"
              disabled={busy || !file || isArciumPublishBlocked}
              className="mt-2 inline-flex h-12 items-center justify-center rounded-lg bg-gradient-to-r from-[#6B50FF] to-[#8B5CF6] px-8 text-[13px] font-bold uppercase tracking-wider text-white shadow-[0_0_20px_rgba(107,80,255,0.3)] transition-all hover:scale-[1.02] hover:shadow-[0_0_30px_rgba(107,80,255,0.5)] disabled:pointer-events-none disabled:opacity-50"
            >
              {busy ? "Publishing..." : "Sign & Publish on Solana"}
            </button>
          </form>
        </div>

        {/* Right: preview + hash panels */}
        <div className="flex flex-col gap-4">

          {/* Preview Panel */}
          <div className="flex flex-col overflow-hidden rounded-2xl border border-[#1a1a2e] bg-[#0b0b12]">
            <div className="flex items-center justify-between border-b border-[#1a1a2e] bg-gradient-to-r from-[#131320] to-transparent px-5 py-3">
              <span className="text-[11px] font-bold uppercase tracking-widest text-purple-400">Live Preview</span>
              <span className="font-mono text-[11px] text-[#5e5e73]">#P</span>
            </div>
            
            <div className="p-5">
              {/* Image / Placeholder Area */}
              <div className="relative mb-5 flex min-h-[220px] items-center justify-center overflow-hidden rounded-xl border border-[#1a1a2e] bg-[#131320]">
                {previewMode === "image" && filePreviewUrl ? (
                  <div className="relative h-full min-h-[220px] w-full">
                    <Image className="object-contain p-2" src={filePreviewUrl} alt={file?.name ?? "preview"} fill unoptimized />
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-3">
                    <div className="flex h-14 w-14 items-center justify-center rounded-full bg-black/50 border border-[#2e2e48] text-[#5e5e73]">
                      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" x2="12" y1="3" y2="15"/></svg>
                    </div>
                    <span className="text-[12px] text-[#8b8b9d] uppercase tracking-wider font-bold">No Preview</span>
                  </div>
                )}
                
                {/* Overlay Badge */}
                <div className="absolute left-3 top-3">
                  <span className="inline-flex items-center rounded-md border border-purple-500/30 bg-purple-500/20 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-purple-300 backdrop-blur-md">
                    {CATEGORY_LABELS[normalizedCategory]}
                  </span>
                </div>
              </div>

              {/* Title & Desc */}
              <div className="mb-6">
                <h3 className="text-[18px] font-bold text-white leading-tight">{form.title || "Untitled Product"}</h3>
                <p className="mt-1 text-[13px] leading-relaxed text-[#8b8b9d] line-clamp-2">{form.description || "Product description will appear here..."}</p>
              </div>

              {/* Detail list rows */}
              <div className="mt-4 flex flex-col">
                {[
                  ["Category", CATEGORY_LABELS[normalizedCategory]],
                  ["Price", form.priceSol || "0.00"],
                  ["Access window", formatLicenseDuration(Number(form.licenseDurationDays || 0) * 86400)],
                  ["Reveal limit", `${form.maxAccessCount}×`],
                  ["Revocable", form.revocable ? "Yes" : "No"]
                ].map(([label, value]) => (
                  <div key={label} className="flex items-center justify-between border-b border-[#1a1a2e] py-3.5 last:border-0">
                    <span className="text-[12px] font-medium text-[#5e5e73]">{label}</span>
                    <span className="flex items-center gap-1 text-[12px] font-bold text-white">{label === "Price" ? <><span>{value}</span><SolLogo size={11} className="text-purple-400" /></> : value}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* #1 Custody Note */}
          <div className="flex flex-col overflow-hidden rounded-2xl border border-[#1a1a2e] bg-[#0b0b12]">
            <div className="flex items-center gap-3 bg-gradient-to-r from-purple-500/10 to-transparent px-5 py-4">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-purple-500/20 text-purple-400">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
              </div>
              <div className="flex-1">
                <p className="text-[12px] font-bold uppercase tracking-widest text-purple-400">Arcium Custody</p>
                <p className="mt-0.5 text-[12px] text-[#8b8b9d]">File encrypted locally. Keys held securely in confidential state.</p>
              </div>
            </div>
          </div>

        </div>
      </div>

      <NoticeToast message={error} open={Boolean(error)} onClose={() => setError(null)} />
    </div>
  );
}
