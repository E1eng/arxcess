"use client";

import { ChangeEvent, FormEvent, useMemo, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { PROTOCOL_FEE_BPS, randomHexId, type ProductMetadata } from "@arxcess/sdk";
import { createKeyCommitmentHex, encryptFile } from "@/lib/crypto/content";
import { uploadCiphertextToPinata, uploadJsonToPinata } from "@/lib/ipfs/client";
import { saveStoredProduct } from "@/lib/storage/marketplace";

const initialForm = {
  title: "",
  description: "",
  category: "ebook",
  priceSol: "0.10"
};

export function SellerWorkbench() {
  const { publicKey } = useWallet();
  const [form, setForm] = useState(initialForm);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Record<string, unknown> | null>(null);
  const sellerWallet = useMemo(() => publicKey?.toBase58() ?? null, [publicKey]);

  function handleInputChange(event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) {
    setForm((current) => ({
      ...current,
      [event.target.name]: event.target.value
    }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!file) {
      setError("Select a file before creating a listing.");
      return;
    }

    setBusy(true);
    setError(null);
    setResult(null);

    try {
      const encrypted = await encryptFile(file);
      const ciphertextBytes = Uint8Array.from(encrypted.ciphertext);
      const ciphertextUpload = await uploadCiphertextToPinata(new Blob([ciphertextBytes]), `${file.name}.enc`);
      const productIdHex = randomHexId();
      const keyCommitmentHex = await createKeyCommitmentHex(encrypted.contentKeyBase64, encrypted.ciphertextHashHex);

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

      saveStoredProduct({
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
        createdAt: new Date().toISOString()
      });

      setResult({
        productIdHex,
        priceSol: form.priceSol,
        protocolFeeBps: PROTOCOL_FEE_BPS,
        ciphertextCid: ciphertextUpload.cid,
        metadataCid: metadataUpload.cid,
        ciphertextHashHex: encrypted.ciphertextHashHex,
        keyCommitmentHex,
        arciumDepositPayload: {
          productIdHex,
          ciphertextHashHex: encrypted.ciphertextHashHex,
          contentKeyBase64: encrypted.contentKeyBase64,
          ivBase64: encrypted.ivBase64
        }
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
    <div className="card">
      <div>
        <h2 className="section-title">Create encrypted listing</h2>
        <p className="muted">The browser encrypts the file before anything is uploaded to Pinata.</p>
      </div>
      <form className="grid" onSubmit={handleSubmit}>
        <label>
          Title
          <input name="title" required value={form.title} onChange={handleInputChange} />
        </label>
        <label>
          Description
          <textarea name="description" required value={form.description} onChange={handleInputChange} />
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
            <input name="priceSol" required inputMode="decimal" value={form.priceSol} onChange={handleInputChange} />
          </label>
        </div>
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
            {busy ? "Encrypting and uploading..." : "Create listing"}
          </button>
          <span className="badge">Seller wallet: {sellerWallet ?? "not connected"}</span>
        </div>
      </form>
      {error ? <div className="badge">{error}</div> : null}
      {result ? <pre className="code">{JSON.stringify(result, null, 2)}</pre> : null}
    </div>
  );
}
