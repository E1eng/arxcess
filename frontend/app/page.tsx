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
      {/* Hero — 2-col split */}
      <section className="grid gap-px border border-[color:var(--border)] bg-[color:var(--border)] lg:grid-cols-[1fr_1fr]">

        {/* Left: headline + CTAs */}
        <div className="flex flex-col justify-between gap-10 bg-black p-8 lg:p-12">
          <div className="flex flex-col gap-5">
            <div className="flex items-center gap-2">
              <span className="border border-[#6B50FF] bg-[#6B50FF] px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.12em] text-white">
                Solana
              </span>
              <span className="border border-[color:var(--green)] px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.12em] text-[color:var(--green)]">
                ● Devnet
              </span>
            </div>
            <h1 className="font-head text-4xl font-bold leading-[1.1] tracking-tight text-white lg:text-[52px]">
              Sell encrypted digital files on-chain.
            </h1>
            <p className="max-w-[42ch] text-[15px] leading-7 text-[color:var(--text2)]">
              Files stay private until payment is confirmed. Access policies, revocation, and time-limited licenses enforced entirely on Solana via Arcium.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Link
              href={"/explore" as any}
              className="flex h-11 items-center justify-center bg-[#6B50FF] px-7 text-[12px] font-bold uppercase tracking-[0.12em] text-white transition-colors hover:bg-[#7B62FF]"
            >
              Browse products
            </Link>
            <Link
              href={"/launch" as any}
              className="flex h-11 items-center justify-center border border-[color:var(--border2)] px-7 text-[12px] font-bold uppercase tracking-[0.12em] text-[color:var(--text2)] transition-colors hover:border-white hover:text-white"
            >
              Publish a product
            </Link>
          </div>
        </div>

        {/* Right: 4 feature tiles */}
        <div className="grid grid-cols-2 gap-px bg-[color:var(--border)]">
          {[
            { label: "Browser encryption", body: "Files encrypted locally before any upload. Your plaintext never leaves the browser." },
            { label: "On-chain payment", body: "Instant settlement on Solana. No escrow service, no middlemen, fully auditable." },
            { label: "Conditional delivery", body: "Decryption key released only after confirmed on-chain payment via Arcium." },
            { label: "Revocable access", body: "Set expiry windows and reveal limits. Revoke access at any time if listing is revocable." }
          ].map(({ label, body }) => (
            <div key={label} className="flex flex-col justify-between gap-6 bg-[color:var(--surface)] p-6">
              <div className="h-0.5 w-8 bg-[#6B50FF]" />
              <div className="flex flex-col gap-2">
                <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-white">{label}</span>
                <p className="text-[13px] leading-6 text-[color:var(--text2)]">{body}</p>
              </div>
            </div>
          ))}
        </div>

      </section>

      {/* Flow steps */}
      <section className="grid gap-px border border-[color:var(--border)] bg-[color:var(--border)] sm:grid-cols-4">
        {[
          ["01", "Encrypt", "Select a file. It's encrypted in-browser before upload."],
          ["02", "Publish", "Set price, access terms, and publish to Solana."],
          ["03", "Purchase", "Buyer pays on-chain. Arcium locks the key."],
          ["04", "Reveal", "After delivery, buyer decrypts and downloads."]
        ].map(([num, title, desc]) => (
          <div key={num} className="flex flex-col gap-3 bg-[color:var(--surface)] p-5">
            <span className="font-mono text-[11px] text-[#6B50FF]">{num}</span>
            <strong className="text-[13px] font-bold uppercase tracking-[0.06em] text-white">{title}</strong>
            <p className="text-[12px] leading-5 text-[color:var(--text2)]">{desc}</p>
          </div>
        ))}
      </section>
    </AppShell>
  );
}
