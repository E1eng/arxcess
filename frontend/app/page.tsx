import type { Metadata } from "next";
import { AppShell } from "@/components/marketplace/app-shell";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Arxcess — Encrypted Digital Goods on Solana",
  description: "Buy and sell encrypted digital products trustlessly on Solana. Files stay private until payment is finalized."
};

export default function HomePage() {
  return (
    <AppShell>
      <section className="relative overflow-hidden rounded-[var(--radius-xl)] border border-[color:var(--border)] bg-[linear-gradient(135deg,rgba(124,58,237,0.16),rgba(3,7,18,0.92),rgba(6,182,212,0.08))] px-6 py-16 shadow-glass md:px-10 md:py-24">
        <div className="grid items-center gap-10 lg:grid-cols-[minmax(0,1.2fr)_minmax(340px,0.8fr)]">
          <div className="space-y-8 animate-fadeUp">
            <div className="inline-flex rounded-full border border-[color:rgba(6,182,212,0.28)] bg-[color:rgba(6,182,212,0.12)] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.1em] text-cyan2">
              Built on Solana ◎ Devnet
            </div>
            <div className="space-y-5">
              <h1 className="max-w-4xl font-head text-5xl font-extrabold leading-[0.95] tracking-tight text-text md:text-7xl">
                The <span className="bg-gradient-to-r from-violet2 to-cyan2 bg-clip-text text-transparent">Encrypted</span>
                <br />
                Digital Marketplace
              </h1>
              <p className="max-w-2xl text-lg leading-8 text-text2 md:text-xl">
                Sell any digital file. Buyers only decrypt after payment is confirmed on-chain. Zero trust required.
              </p>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row">
              <Link className="inline-flex h-12 items-center justify-center rounded-[var(--radius)] bg-gradient-to-r from-violet to-cyan px-6 font-medium text-white shadow-[var(--glow-v)] transition hover:-translate-y-0.5" href={"/explore" as any}>
                Explore Products →
              </Link>
              <Link className="inline-flex h-12 items-center justify-center rounded-[var(--radius)] border border-[color:var(--border2)] bg-[color:rgba(17,30,51,0.88)] px-6 font-medium text-text transition hover:border-violet hover:bg-[color:rgba(12,21,37,0.92)]" href={"/launch" as any}>
                Launch Your Product
              </Link>
            </div>
            <div className="grid gap-4 md:grid-cols-3">
              <div className="rounded-[var(--radius-lg)] border border-[color:var(--border)] bg-[color:rgba(12,21,37,0.55)] p-5">
                <div className="text-[11px] uppercase tracking-[0.12em] text-text2">Products Listed</div>
                <div className="mt-2 font-head text-3xl font-bold text-text">0</div>
                <div className="mt-1 text-sm text-green">Ready for launch</div>
              </div>
              <div className="rounded-[var(--radius-lg)] border border-[color:var(--border)] bg-[color:rgba(12,21,37,0.55)] p-5">
                <div className="text-[11px] uppercase tracking-[0.12em] text-text2">SOL Volume</div>
                <div className="mt-2 font-head text-3xl font-bold text-text">◎ 0.0000</div>
                <div className="mt-1 text-sm text-text2">On-chain settlement</div>
              </div>
              <div className="rounded-[var(--radius-lg)] border border-[color:var(--border)] bg-[color:rgba(12,21,37,0.55)] p-5">
                <div className="text-[11px] uppercase tracking-[0.12em] text-text2">Security</div>
                <div className="mt-2 font-head text-3xl font-bold text-text">E2E</div>
                <div className="mt-1 text-sm text-cyan2">Encrypted in browser</div>
              </div>
            </div>
          </div>
          <div className="animate-float rounded-[var(--radius-xl)] border border-[color:rgba(124,58,237,0.24)] bg-[color:rgba(12,21,37,0.72)] p-6 backdrop-blur-xl">
            <div className="relative overflow-hidden rounded-[var(--radius-lg)] border border-[color:var(--border)] bg-[linear-gradient(135deg,rgba(124,58,237,0.2),rgba(12,21,37,0.92),rgba(6,182,212,0.15))] p-6">
              <div className="absolute right-4 top-4 rounded-full border border-[color:rgba(124,58,237,0.35)] bg-[color:rgba(124,58,237,0.14)] px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-violet2">
                🔒 Encrypted
              </div>
              <div className="mb-5 flex aspect-video items-center justify-center rounded-[var(--radius)] border border-dashed border-[color:var(--border2)] bg-[color:rgba(17,30,51,0.68)] text-6xl">
                ✨
              </div>
              <div className="mb-3 inline-flex rounded-full border border-[color:rgba(6,182,212,0.35)] bg-[color:rgba(6,182,212,0.12)] px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-cyan2">
                Design
              </div>
              <h2 className="font-head text-2xl font-bold text-text">Premium Asset Pack</h2>
              <p className="mt-2 text-sm leading-7 text-text2">Encrypted before upload, sold with on-chain access rules, and revealed only after confirmed payment.</p>
              <div className="mt-6 flex items-center justify-between gap-4 border-t border-[color:var(--border)] pt-4">
                <div>
                  <div className="font-mono text-lg text-violet2">◎ 0.0500</div>
                  <div className="text-xs text-text3">by 3xKp...f7A2</div>
                </div>
                <Link className="inline-flex h-10 items-center justify-center rounded-[var(--radius)] bg-gradient-to-r from-cyan to-cyan2 px-4 text-sm font-semibold text-slate-950 transition hover:-translate-y-0.5" href={"/explore" as any}>
                  Buy →
                </Link>
              </div>
            </div>
          </div>
        </div>
      </section>
      <section className="grid gap-6 lg:grid-cols-3">
        {[
          ["🔐", "Creator", "Encrypts & uploads file in browser"],
          ["◎", "Buyer", "Purchases on Solana"],
          ["📦", "Delivery", "Decryption key revealed on-chain"]
        ].map(([icon, title, copy], index) => (
          <div key={title} className="rounded-[var(--radius-lg)] border border-[color:var(--border)] bg-[color:rgba(12,21,37,0.64)] p-6 backdrop-blur-xl">
            <div className="mb-4 flex items-center justify-between">
              <span className="text-3xl">{icon}</span>
              <span className="font-mono text-xs uppercase tracking-[0.12em] text-text3">step 0{index + 1}</span>
            </div>
            <h3 className="font-head text-2xl font-bold text-text">{title}</h3>
            <p className="mt-3 text-sm leading-7 text-text2">{copy}</p>
          </div>
        ))}
      </section>
      <section className="grid gap-6 md:grid-cols-2">
        {[
          ["🔒", "Browser-side Encryption", "Files encrypted before upload. Never stored as plaintext."],
          ["◎", "On-chain Payments", "Solana transactions. Instant, low-fee, verifiable."],
          ["📦", "Conditional Delivery", "Decryption only after on-chain confirmation."],
          ["🔄", "Revocable Access", "Publishers can revoke time-limited access."]
        ].map(([icon, title, copy]) => (
          <div key={title} className="rounded-[var(--radius-lg)] border border-[color:var(--border)] bg-[color:rgba(12,21,37,0.56)] p-6 transition hover:border-[color:rgba(124,58,237,0.4)] hover:shadow-glass">
            <div className="mb-4 text-3xl">{icon}</div>
            <h3 className="font-head text-2xl font-bold text-text">{title}</h3>
            <p className="mt-3 text-sm leading-7 text-text2">{copy}</p>
          </div>
        ))}
      </section>
      <section className="rounded-[var(--radius-xl)] border border-[color:rgba(124,58,237,0.25)] bg-[linear-gradient(135deg,rgba(124,58,237,0.22),rgba(3,7,18,0.96))] px-6 py-10 md:px-10">
        <div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
          <div className="space-y-2">
            <div className="text-[11px] uppercase tracking-[0.12em] text-violet2">Ready to sell encrypted?</div>
            <h2 className="font-head text-3xl font-bold text-text md:text-4xl">Connect wallet dan publish produk pertamamu dalam menit.</h2>
            <p className="text-sm leading-7 text-text2">Explore untuk pembeli, Launch untuk creator, Library untuk delivery hub yang tetap sederhana.</p>
          </div>
          <Link className="inline-flex h-12 items-center justify-center rounded-[var(--radius)] bg-gradient-to-r from-violet to-cyan px-6 font-medium text-white shadow-[var(--glow-v)] transition hover:-translate-y-0.5" href={"/launch" as any}>
            Launch Your First Product →
          </Link>
        </div>
      </section>
    </AppShell>
  );
}
