import { AppShell } from "@/components/marketplace/app-shell";
import Link from "next/link";

export default function HomePage() {
  return (
    <AppShell>
      <section className="hero">
        <div className="hero-grid">
          <div className="hero-copy">
            <span className="badge badge--neutral">Encrypted digital commerce on Solana</span>
            <h1>Sell locked digital products with a simple buyer and seller flow.</h1>
            <p className="subtitle">Publish a product, buy it with a wallet, then reveal it securely after delivery is ready.</p>
            <div className="row hero-actions">
              <Link className="button" href="/seller">
                Start selling
              </Link>
              <Link className="button secondary" href="/products">
                Browse products
              </Link>
            </div>
            <div className="stat-grid">
              <div className="card compact">
                <div className="kpi">
                  <span className="muted">Encryption</span>
                  <strong>In browser</strong>
                </div>
                <span className="muted">Files are encrypted before upload.</span>
              </div>
              <div className="card compact">
                <div className="kpi">
                  <span className="muted">Storage</span>
                  <strong>Pinata + IPFS</strong>
                </div>
                <span className="muted">Only encrypted content is uploaded.</span>
              </div>
              <div className="card compact">
                <div className="kpi">
                  <span className="muted">Payments</span>
                  <strong>Wallet based</strong>
                </div>
                <span className="muted">Purchases and access are enforced on-chain.</span>
              </div>
            </div>
          </div>
          <div className="hero-panel">
            <span className="badge">Simple flow</span>
            <h2 className="section-title">Three steps</h2>
            <div className="grid">
              <div className="step-item">
                <strong>1. Publish</strong>
                <span className="muted">Create a listing and upload the locked file.</span>
              </div>
              <div className="step-item">
                <strong>2. Buy</strong>
                <span className="muted">The buyer pays with a wallet.</span>
              </div>
              <div className="step-item">
                <strong>3. Reveal</strong>
                <span className="muted">After delivery is ready, the buyer reveals and downloads.</span>
              </div>
            </div>
            <div className="callout">
              <strong>Start anywhere</strong>
              <span className="muted">Go to Seller to publish, Products to buy, or Purchases to open what you already own.</span>
            </div>
          </div>
        </div>
      </section>
      <section className="grid grid-2">
        <div className="card surface">
          <div>
            <span className="eyebrow">What you can do</span>
            <h2 className="section-title">Focused and minimal</h2>
            <p className="muted">Each page is built around one main job, so the product is easier to understand and easier to use.</p>
          </div>
          <div className="feature-grid">
            <div className="step-item">
              <strong>Seller</strong>
              <span className="muted">Create and publish locked listings.</span>
            </div>
            <div className="step-item">
              <strong>Products</strong>
              <span className="muted">Browse and buy available products.</span>
            </div>
            <div className="step-item">
              <strong>Purchases</strong>
              <span className="muted">Reveal and download what has been delivered.</span>
            </div>
          </div>
        </div>
        <div className="card surface">
          <div>
            <span className="eyebrow">Quick navigation</span>
            <h2 className="section-title">Open the page you need</h2>
            <p className="muted">No extra steps, no onboarding wall. Just go directly to the part you want to use.</p>
          </div>
          <div className="grid">
            <Link className="button secondary" href="/seller">
              Seller
            </Link>
            <Link className="button secondary" href="/products">
              Products
            </Link>
            <Link className="button secondary" href="/purchases">
              Purchases
            </Link>
          </div>
        </div>
      </section>
    </AppShell>
  );
}
