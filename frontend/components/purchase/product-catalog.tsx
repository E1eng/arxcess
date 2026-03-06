"use client";

import { useMemo, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { randomHexId } from "@arxcess/sdk";
import { useDeliveryKeys } from "@/hooks/use-delivery-keys";
import { useProducts } from "@/hooks/use-products";
import { saveStoredPurchase } from "@/lib/storage/marketplace";
import { solToLamports } from "@/lib/solana/amounts";

export function ProductCatalog() {
  const { publicKey } = useWallet();
  const { products } = useProducts();
  const { ensureKeypair } = useDeliveryKeys();
  const [prepared, setPrepared] = useState<Record<string, unknown> | null>(null);
  const buyerWallet = useMemo(() => publicKey?.toBase58() ?? null, [publicKey]);

  function preparePurchase(productIdHex: string, amountSol: string) {
    const deliveryKeypair = ensureKeypair();
    const purchaseIdHex = randomHexId();
    saveStoredPurchase({
      purchaseIdHex,
      productIdHex,
      buyerWallet,
      buyerDeliveryPublicKeyBase64: deliveryKeypair.publicKeyBase64,
      amountSol,
      status: "prepared",
      createdAt: new Date().toISOString()
    });
    setPrepared({
      purchaseIdHex,
      productIdHex,
      buyerWallet,
      buyerDeliveryPublicKeyBase64: deliveryKeypair.publicKeyBase64,
      amountLamports: solToLamports(amountSol).toString()
    });
  }

  return (
    <div className="grid">
      <div className="card">
        <div>
          <h2 className="section-title">Catalog</h2>
          <p className="muted">These listings are your current browser-side marketplace state while on-chain integration is being wired.</p>
        </div>
        <span className="badge">Buyer wallet: {buyerWallet ?? "not connected"}</span>
      </div>
      {products.length === 0 ? (
        <div className="card">
          <strong>No products yet.</strong>
          <span className="muted">Create one from the seller page after configuring Pinata.</span>
        </div>
      ) : (
        products.map((product) => (
          <div key={product.productIdHex} className="card">
            <div className="row">
              <span className="badge">{product.category}</span>
              <span className="badge">{product.priceSol} SOL</span>
            </div>
            <div>
              <h3>{product.title}</h3>
              <p className="muted">{product.description}</p>
            </div>
            <div className="grid grid-2">
              <div className="kpi">
                <span className="muted">Ciphertext CID</span>
                <strong>{product.ciphertextCid.slice(0, 16)}...</strong>
              </div>
              <div className="kpi">
                <span className="muted">Metadata CID</span>
                <strong>{product.metadataCid.slice(0, 16)}...</strong>
              </div>
            </div>
            <div className="row">
              <a className="button secondary" href={product.metadataGatewayUrl} target="_blank" rel="noreferrer">
                Open metadata
              </a>
              <a className="button secondary" href={product.ciphertextGatewayUrl} target="_blank" rel="noreferrer">
                Open ciphertext
              </a>
              <button className="button" type="button" onClick={() => preparePurchase(product.productIdHex, product.priceSol)}>
                Prepare purchase payload
              </button>
            </div>
          </div>
        ))
      )}
      {prepared ? <pre className="code">{JSON.stringify(prepared, null, 2)}</pre> : null}
    </div>
  );
}
