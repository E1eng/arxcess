"use client";

import { useDeliveryKeys } from "@/hooks/use-delivery-keys";
import { usePurchases } from "@/hooks/use-purchases";

export function PurchasesList() {
  const { purchases } = usePurchases();
  const { keypair, ensureKeypair } = useDeliveryKeys();

  return (
    <div className="grid">
      <div className="card">
        <div>
          <h2 className="section-title">Buyer delivery keys</h2>
          <p className="muted">A dedicated delivery keypair is stored locally in your browser for future Arcium-sealed key delivery.</p>
        </div>
        <div className="row">
          <button className="button" type="button" onClick={() => ensureKeypair()}>
            {keypair ? "Rotate later manually" : "Generate delivery keypair"}
          </button>
          <span className="badge">{keypair ? "Keypair ready" : "Keypair missing"}</span>
        </div>
        {keypair ? <pre className="code">{JSON.stringify({ publicKeyBase64: keypair.publicKeyBase64 }, null, 2)}</pre> : null}
      </div>
      <div className="card">
        <div>
          <h2 className="section-title">Prepared purchases</h2>
          <p className="muted">These entries represent the next payloads to send through `purchase_product` once the on-chain program is deployed.</p>
        </div>
        {purchases.length === 0 ? (
          <span className="muted">No purchase payloads prepared yet.</span>
        ) : (
          purchases.map((purchase) => (
            <div key={purchase.purchaseIdHex} className="card">
              <strong>{purchase.purchaseIdHex}</strong>
              <span className="muted">Product: {purchase.productIdHex}</span>
              <span className="muted">Buyer: {purchase.buyerWallet ?? "not connected"}</span>
              <span className="muted">Delivery key: {purchase.buyerDeliveryPublicKeyBase64.slice(0, 24)}...</span>
              <span className="badge">{purchase.status}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
