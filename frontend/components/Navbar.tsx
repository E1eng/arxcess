"use client";

import type { Route } from "next";
import dynamic from "next/dynamic";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMemo, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { cn, shortenAddress } from "@/lib/utils";

const WalletMultiButton = dynamic(
  () => import("@solana/wallet-adapter-react-ui").then((module) => module.WalletMultiButton),
  { ssr: false }
);

const links: Array<{ href: Route; label: string }> = [
  { href: "/explore" as Route, label: "Explore" },
  { href: "/launch" as Route, label: "Launch" },
  { href: "/library" as Route, label: "Library" }
];

export function Navbar() {
  const pathname = usePathname();
  const { publicKey } = useWallet();
  const [mobileOpen, setMobileOpen] = useState(false);
  const address = useMemo(() => publicKey?.toBase58() ?? null, [publicKey]);

  return (
    <header className="sticky top-0 z-50 border-b border-[color:var(--border)] bg-black">
      <div className="mx-auto flex w-[min(1280px,calc(100%-24px))] items-center justify-between gap-6 py-3">

        {/* Logo */}
        <Link href="/" className="flex items-center gap-2.5 shrink-0">
          <svg width="22" height="22" viewBox="0 0 22 22" fill="none" aria-hidden="true">
            <polygon points="11,2 20,19 2,19" fill="#6B50FF" />
          </svg>
          <span className="font-head text-[15px] font-bold tracking-[0.06em] uppercase text-white">
            Arxcess
          </span>
        </Link>

        {/* Desktop nav */}
        <nav className="hidden md:flex items-center gap-1" aria-label="Primary">
          {links.map((link) => {
            const active = pathname === link.href || pathname?.startsWith(link.href + "/");
            return (
              <Link
                key={link.href}
                href={link.href as Route}
                className={cn(
                  "px-4 py-2 text-[12px] font-semibold uppercase tracking-[0.1em] transition-colors duration-150",
                  active
                    ? "text-white"
                    : "text-[color:var(--text2)] hover:text-white"
                )}
              >
                {link.label}
              </Link>
            );
          })}
        </nav>

        {/* Wallet action */}
        <div className="flex items-center gap-3">
          {address ? (
            <span className="hidden md:inline-flex items-center gap-1.5 text-[11px] font-mono text-[color:var(--text2)]">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-green animate-pulseSoft" />
              {shortenAddress(address)}
            </span>
          ) : null}
          <div className="wallet-button-shell">
            <WalletMultiButton />
          </div>

          {/* Mobile toggle */}
          <button
            className="inline-flex h-8 w-8 items-center justify-center border border-[color:var(--border)] bg-[color:var(--surface)] text-xs text-[color:var(--text2)] md:hidden"
            type="button"
            aria-label="Toggle navigation"
            onClick={() => setMobileOpen((v) => !v)}
          >
            ☰
          </button>
        </div>
      </div>

      {/* Mobile menu */}
      {mobileOpen ? (
        <div className="border-t border-[color:var(--border)] bg-black px-4 py-3 md:hidden">
          {links.map((link) => {
            const active = pathname === link.href;
            return (
              <Link
                key={link.href}
                href={link.href as Route}
                className={cn(
                  "block px-2 py-2.5 text-[12px] font-semibold uppercase tracking-[0.1em] border-b border-[color:var(--border)] last:border-b-0 transition-colors",
                  active ? "text-white" : "text-[color:var(--text2)]"
                )}
                onClick={() => setMobileOpen(false)}
              >
                {link.label}
              </Link>
            );
          })}
        </div>
      ) : null}
    </header>
  );
}
