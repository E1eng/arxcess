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

      {/* ── Main 2-col: left hero, right hash panels ─────── */}
      <div className="grid gap-px border border-[color:var(--border)] bg-[color:var(--border)] lg:grid-cols-[1fr_1fr]">

        {/* Left — hero */}
        <div className="flex flex-col justify-between gap-10 bg-black p-8 lg:p-12">
          <div className="flex flex-col gap-5">
            {/* Status badges */}
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 border border-[color:var(--border2)] px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.1em] text-[color:var(--text2)]">
                Marketplace
              </span>
              <span className="inline-flex items-center gap-1.5 border border-[#f59e0b] px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.1em] text-[#f59e0b]">
                Encrypted
              </span>
              <span className="inline-flex items-center gap-1.5 border border-[color:var(--green)] px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.1em] text-[color:var(--green)]">
                <span className="h-1 w-1 rounded-full bg-[color:var(--green)] animate-pulseSoft" />
                Active
              </span>
            </div>

            {/* Title */}
            <h1 className="font-head text-4xl font-bold leading-[1.08] tracking-tight text-white lg:text-[48px]">
              Encrypted Digital Goods on Solana
            </h1>

            {/* Description */}
            <p className="max-w-[44ch] text-[14px] leading-7 text-[color:var(--text2)]">
              Sell any digital file. Buyers only decrypt after payment is confirmed on-chain.
              Zero trust required — access policies enforced entirely via Arcium on Solana.
            </p>
          </div>

          {/* CTAs */}
          <div className="flex flex-wrap gap-3">
            <Link
              href={"/explore" as any}
              className="inline-flex h-11 items-center justify-center bg-[#6B50FF] px-7 text-[11px] font-bold uppercase tracking-[0.12em] text-white transition-colors hover:bg-[#7B62FF]"
            >
              Browse products »
            </Link>
            <Link
              href={"/launch" as any}
              className="inline-flex h-11 items-center justify-center border border-[color:var(--border2)] px-7 text-[11px] font-bold uppercase tracking-[0.12em] text-[color:var(--text2)] transition-colors hover:border-white hover:text-white"
            >
              Publish a product
            </Link>
          </div>
        </div>

        {/* Right — hash section panels */}
        <div className="flex flex-col gap-px bg-[color:var(--border)]">

          {/* #0.1 Description */}
          <div className="bg-[color:var(--surface)]">
            <div className="flex items-center justify-between bg-[#6B50FF] px-4 py-2">
              <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-white">Description</span>
              <span className="font-mono text-[10px] text-white/60">#0.1</span>
            </div>
            <div className="px-4 py-4">
              <p className="text-[13px] leading-6 text-[color:var(--text2)]">
                Arxcess is a pay-to-decrypt digital goods marketplace. Files are encrypted in your browser before upload. Decryption keys are held by Arcium in confidential shared state — released only after on-chain payment confirmation, with revocation and time-bound access enforcement.
              </p>
            </div>
          </div>

          {/* #0.2 How it works */}
          <div className="bg-[color:var(--surface)]">
            <div className="flex items-center justify-between border-t border-[color:var(--border)] bg-[#6B50FF] px-4 py-2">
              <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-white">How it works</span>
              <span className="font-mono text-[10px] text-white/60">#0.2</span>
            </div>
            <ul className="flex flex-col gap-2 px-4 py-4">
              {[
                "Creator uploads a file — encrypted in-browser before any transfer.",
                "Arcium takes custody of the encryption key in confidential state.",
                "Buyer pays on Solana. Transaction confirmed on-chain immediately.",
                "Seller queues Arcium delivery. Buyer reveals and downloads the file."
              ].map((item) => (
                <li key={item} className="flex items-start gap-2 text-[13px] text-[color:var(--text2)]">
                  <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-[#6B50FF]" />
                  {item}
                </li>
              ))}
            </ul>
          </div>

          {/* #0.3 Key features */}
          <div className="bg-[color:var(--surface)]">
            <div className="flex items-center justify-between border-t border-[color:var(--border)] bg-[#6B50FF] px-4 py-2">
              <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-white">Key features</span>
              <span className="font-mono text-[10px] text-white/60">#0.3</span>
            </div>
            <ul className="flex flex-col gap-2 px-4 py-4">
              {[
                ["Browser-side Encryption", "Files never leave your device as plaintext."],
                ["On-chain Payments", "Instant Solana transactions, no escrow."],
                ["Conditional Delivery", "Key released only after payment confirmation."],
                ["Revocable Access", "Set time limits and revoke access anytime."]
              ].map(([title, desc]) => (
                <li key={title} className="flex items-start gap-2 text-[13px] text-[color:var(--text2)]">
                  <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-[#6B50FF]" />
                  <span><strong className="font-bold text-white">{title}</strong> — {desc}</span>
                </li>
              ))}
            </ul>
          </div>

        </div>
      </div>

      {/* ── Bottom CTA bar ──────────────────────────────────── */}
      <div className="flex flex-col items-start justify-between gap-4 border border-[color:var(--border)] bg-[color:var(--surface)] px-6 py-5 sm:flex-row sm:items-center">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-white">Ready to sell encrypted?</p>
          <p className="mt-1 text-[12px] text-[color:var(--text2)]">Connect your wallet and publish your first product in minutes.</p>
        </div>
        <Link
          href={"/launch" as any}
          className="shrink-0 inline-flex h-10 items-center bg-[#6B50FF] px-6 text-[11px] font-bold uppercase tracking-[0.12em] text-white transition-colors hover:bg-[#7B62FF]"
        >
          Launch now »
        </Link>
      </div>

    </AppShell>
  );
}
