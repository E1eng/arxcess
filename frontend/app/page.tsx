import { AppShell } from "@/components/marketplace/app-shell";
import Link from "next/link";

export default function HomePage() {
  return (
    <AppShell>
      <section className="hero">
        <div className="hero-grid">
          <div className="hero-copy">
            <span className="badge badge--neutral">Encrypted digital commerce on Solana</span>
            <h1>Launch premium digital products and unlock them securely after purchase.</h1>
            <p className="subtitle">Explore products, launch your own listing, and open delivered purchases from one clean workspace.</p>
            <div className="row hero-actions">
              <Link className="button" href="/products">
                Explore products
              </Link>
              <Link className="button secondary" href="/seller">
                Launch a product
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
            <span className="badge">How it works</span>
            <h2 className="section-title">Three steps</h2>
            <div className="grid">
              <div className="step-item">
                <strong>1. Launch</strong>
                <span className="muted">Create a listing and upload the locked file.</span>
              </div>
              <div className="step-item">
                <strong>2. Purchase</strong>
                <span className="muted">Someone pays with a wallet and the order is recorded on-chain.</span>
              </div>
              <div className="step-item">
                <strong>3. Reveal</strong>
                <span className="muted">Once delivery is ready, the purchaser reveals and downloads the file.</span>
              </div>
            </div>
            <div className="callout">
              <strong>Why home stays separate</strong>
              <span className="muted">Home introduces the product. Explore is for browsing, Launch is for publishing, and Library is only useful after someone already owns something.</span>
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
              <strong>Launch</strong>
              <span className="muted">Create and publish locked listings.</span>
            </div>
            <div className="step-item">
              <strong>Explore</strong>
              <span className="muted">Browse and purchase available products.</span>
            </div>
            <div className="step-item">
              <strong>Library</strong>
              <span className="muted">Open and download what has already been delivered.</span>
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
            <Link className="button secondary" href="/products">
              Explore
            </Link>
            <Link className="button secondary" href="/seller">
              Launch
            </Link>
            <Link className="button secondary" href="/purchases">
              Library
            </Link>
          </div>
        </div>
      </section>
    </AppShell>
  );
}
