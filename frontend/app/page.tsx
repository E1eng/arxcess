import { AppShell } from "@/components/marketplace/app-shell";
import Link from "next/link";

export default function HomePage() {
  return (
    <AppShell>
      <section className="hero">
        <div className="hero-grid">
          <div className="hero-copy">
            <span className="badge">Web-only encrypted marketplace MVP</span>
            <h1>Sell encrypted digital goods without giving the platform your keys.</h1>
            <p className="subtitle">
              Arxcess encrypts files in the browser, stores only ciphertext on Pinata/IPFS, and prepares Solana + Arcium payloads for trust-minimized delivery.
            </p>
            <div className="row hero-actions">
              <Link className="button" href="/seller">
                Create listing
              </Link>
              <Link className="button secondary" href="/products">
                Browse products
              </Link>
            </div>
            <div className="stat-grid">
              <div className="card compact">
                <div className="kpi">
                  <span className="muted">Encryption</span>
                  <strong>Client-side</strong>
                </div>
                <span className="muted">Plaintext stays in the browser before upload.</span>
              </div>
              <div className="card compact">
                <div className="kpi">
                  <span className="muted">Storage</span>
                  <strong>Pinata/IPFS</strong>
                </div>
                <span className="muted">Only encrypted blobs leave the browser.</span>
              </div>
              <div className="card compact">
                <div className="kpi">
                  <span className="muted">Settlement</span>
                  <strong>Solana + Anchor</strong>
                </div>
                <span className="muted">Purchase entitlement is shaped for on-chain enforcement.</span>
              </div>
            </div>
          </div>
          <div className="hero-panel">
            <span className="badge">Prototype workflow</span>
            <h2 className="section-title">How it flows</h2>
            <div className="grid">
              <div className="step-item">
                <strong>1. Encrypt locally</strong>
                <span className="muted">Choose an asset and encrypt it in the browser before upload.</span>
              </div>
              <div className="step-item">
                <strong>2. Upload ciphertext</strong>
                <span className="muted">Store ciphertext and metadata on IPFS through Pinata.</span>
              </div>
              <div className="step-item">
                <strong>3. Prepare delivery</strong>
                <span className="muted">Generate buyer delivery keys and purchase payloads for later settlement.</span>
              </div>
            </div>
            <div className="callout">
              <strong>Best next step in dev</strong>
              <span className="muted">Configure env values, connect a wallet, create a listing, then verify the buyer flow from the products page.</span>
            </div>
          </div>
        </div>
      </section>
      <section className="grid grid-2">
        <div className="card surface">
          <div>
            <h2 className="section-title">Built for fast iteration</h2>
            <p className="muted">The current workspace is optimized for prototyping the full encrypted commerce loop before deeper on-chain integration lands.</p>
          </div>
          <div className="grid">
            <span className="badge">Seller tooling</span>
            <span className="badge">Buyer payload prep</span>
            <span className="badge">Local browser state</span>
          </div>
        </div>
        <div className="card surface">
          <div>
            <h2 className="section-title">Suggested journey</h2>
            <p className="muted">Move through the product flow in order so each page has meaningful data to display.</p>
          </div>
          <div className="grid">
            <Link className="button secondary" href="/seller">
              Go to seller workbench
            </Link>
            <Link className="button secondary" href="/products">
              Review catalog and prepare purchase
            </Link>
            <Link className="button secondary" href="/purchases">
              Inspect delivery keys and purchase intents
            </Link>
          </div>
        </div>
      </section>
    </AppShell>
  );
}
