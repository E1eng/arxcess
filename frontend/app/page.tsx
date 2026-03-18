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
      <div className="flex flex-col gap-6">
        {/* ── Main 2-col: left hero, right hash panels ─────── */}
        <div className="grid gap-6 lg:grid-cols-[1.2fr_1fr]">
          
          {/* Left — hero */}
          <div className="relative flex flex-col justify-between gap-10 overflow-hidden rounded-2xl border border-[#1a1a2e] bg-[#0b0b12] p-8 lg:p-12">
            {/* Background decorative glow */}
            <div className="absolute -left-20 -top-20 h-64 w-64 rounded-full bg-purple-500/10 blur-[80px]" />
            <div className="absolute -right-20 bottom-0 h-64 w-64 rounded-full bg-blue-500/5 blur-[80px]" />

            <div className="relative z-10 flex flex-col gap-6">
              {/* Status badges */}
              <div className="flex flex-wrap items-center gap-3">
                <span className="inline-flex items-center rounded-full border border-purple-500/30 bg-purple-500/10 px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-purple-300">
                  Arxcess on Solana Devnet
                </span>
                <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-emerald-400">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulseSoft" />
                  Active
                </span>
              </div>

              {/* Title */}
              <h1 className="font-head text-4xl font-bold leading-[1.1] tracking-tight text-white lg:text-[52px]">
                Encrypted <br />
                Digital Goods on <br />
                Solana.
              </h1>

              {/* Description */}
              <p className="max-w-[42ch] text-[15px] leading-relaxed text-[#8b8b9d]">
                Sell any digital file. Buyers only decrypt after payment is confirmed on-chain.
                Zero trust required — access policies enforced entirely via Arcium on Solana.
              </p>
            </div>

            {/* CTAs */}
            <div className="relative z-10 flex flex-wrap gap-4 pt-4">
              <Link
                href={"/explore" as any}
                className="inline-flex h-12 items-center justify-center rounded-lg bg-gradient-to-r from-[#6B50FF] to-[#8B5CF6] px-8 text-[12px] font-bold uppercase tracking-[0.1em] text-white shadow-[0_0_20px_rgba(107,80,255,0.3)] transition-all hover:scale-[1.02] hover:shadow-[0_0_30px_rgba(107,80,255,0.5)]"
              >
                Browse products
              </Link>
              <Link
                href={"/launch" as any}
                className="inline-flex h-12 items-center justify-center rounded-lg border border-[#2e2e48] bg-[#131320] px-8 text-[12px] font-bold uppercase tracking-[0.1em] text-[#a1a1aa] transition-all hover:border-[#6B50FF] hover:text-white"
              >
                Publish a product
              </Link>
            </div>
          </div>

          {/* Right — hash section panels */}
          <div className="flex flex-col gap-4">

            {/* #0.1 Description */}
            <div className="flex flex-col overflow-hidden rounded-2xl border border-[#1a1a2e] bg-[#0b0b12]">
              <div className="flex items-center justify-between border-b border-[#1a1a2e] bg-gradient-to-r from-[#131320] to-transparent px-5 py-3">
                <span className="text-[11px] font-bold uppercase tracking-widest text-purple-400">Description</span>
                <span className="font-mono text-[11px] text-[#5e5e73]">#0.1</span>
              </div>
              <div className="px-5 py-5">
                <p className="text-[14px] leading-relaxed text-[#8b8b9d]">
                  Arxcess is a pay-to-decrypt digital goods marketplace. Files are encrypted in your browser before upload. Decryption keys are held by Arcium in confidential shared state — released only after on-chain payment confirmation, with revocation and time-bound access enforcement.
                </p>
              </div>
            </div>

            {/* #0.2 How it works */}
            <div className="flex flex-col overflow-hidden rounded-2xl border border-[#1a1a2e] bg-[#0b0b12]">
              <div className="flex items-center justify-between border-b border-[#1a1a2e] bg-gradient-to-r from-[#131320] to-transparent px-5 py-3">
                <span className="text-[11px] font-bold uppercase tracking-widest text-purple-400">How it works</span>
                <span className="font-mono text-[11px] text-[#5e5e73]">#0.2</span>
              </div>
              <ul className="flex flex-col gap-3 px-5 py-5">
                {[
                  "Creator uploads a file — encrypted in-browser before any transfer.",
                  "Arcium takes custody of the encryption key in confidential state.",
                  "Buyer pays on Solana. Transaction confirmed on-chain immediately.",
                  "Seller queues Arcium delivery. Buyer reveals and downloads the file."
                ].map((item, i) => (
                  <li key={i} className="flex items-start gap-3 text-[14px] leading-relaxed text-[#8b8b9d]">
                    <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-purple-500 shadow-[0_0_8px_rgba(168,85,247,0.8)]" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>

            {/* #0.3 Key features */}
            <div className="flex flex-col overflow-hidden rounded-2xl border border-[#1a1a2e] bg-[#0b0b12]">
              <div className="flex items-center justify-between border-b border-[#1a1a2e] bg-gradient-to-r from-[#131320] to-transparent px-5 py-3">
                <span className="text-[11px] font-bold uppercase tracking-widest text-purple-400">Key features</span>
                <span className="font-mono text-[11px] text-[#5e5e73]">#0.3</span>
              </div>
              <ul className="flex flex-col gap-3 px-5 py-5">
                {[
                  ["Browser-side Encryption", "Files never leave your device as plaintext."],
                  ["On-chain Payments", "Instant Solana transactions, no escrow."],
                  ["Conditional Delivery", "Key released only after payment confirmation."],
                  ["Revocable Access", "Set time limits and revoke access anytime."]
                ].map(([title, desc]) => (
                  <li key={title} className="flex items-start gap-3 text-[14px] leading-relaxed text-[#8b8b9d]">
                    <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-purple-500 shadow-[0_0_8px_rgba(168,85,247,0.8)]" />
                    <span><strong className="font-semibold text-white">{title}</strong> — {desc}</span>
                  </li>
                ))}
              </ul>
            </div>

          </div>
        </div>

        {/* ── Bottom CTA bar ──────────────────────────────────── */}
        <div className="flex flex-col items-start justify-between gap-5 rounded-2xl border border-[#1a1a2e] bg-gradient-to-r from-[#0b0b12] to-[#131320] p-6 sm:flex-row sm:items-center lg:px-8 lg:py-6">
          <div className="flex items-center gap-5">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-purple-500/10 text-purple-400">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2v20"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
            </div>
            <div>
              <p className="text-[13px] font-bold uppercase tracking-widest text-white">Ready to sell?</p>
              <p className="mt-1 text-[14px] text-[#8b8b9d]">Connect your wallet and publish your first product in minutes.</p>
            </div>
          </div>
          <Link
            href={"/launch" as any}
            className="shrink-0 inline-flex h-11 items-center rounded-lg bg-white px-8 text-[11px] font-bold uppercase tracking-[0.1em] text-black transition-transform hover:scale-[1.02]"
          >
            Launch now
          </Link>
        </div>
      </div>
    </AppShell>
  );
}
