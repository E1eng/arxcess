"use client";

import type { Route } from "next";
import dynamic from "next/dynamic";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMemo, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { cn, shortenAddress } from "@/lib/utils";

const WalletMultiButton = dynamic(
  () => import("@solana/wallet-adapter-react-ui").then((module) => module.WalletMultiButton),
  { ssr: false }
);

const links: Array<{ href: Route; label: string }> = [
  { href: "/" as Route, label: "Home" },
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
    <header className="sticky top-0 z-50 border-b border-[color:var(--border)] bg-[color:rgba(3,7,18,0.85)] backdrop-blur-[20px]">
      <div className="mx-auto flex w-[min(1280px,calc(100%-24px))] items-center justify-between gap-4 py-4">
        <Link href="/" className="font-head text-2xl font-extrabold tracking-tight text-transparent bg-gradient-to-r from-violet2 to-cyan2 bg-clip-text">
          Arxcess
        </Link>

        <button
          className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-[color:var(--border)] bg-[color:rgba(12,21,37,0.75)] text-text md:hidden"
          type="button"
          aria-label="Toggle navigation"
          onClick={() => setMobileOpen((value) => !value)}
        >
          ☰
        </button>

        <nav className={cn("absolute left-3 right-3 top-[calc(100%+8px)] grid gap-2 rounded-[var(--radius-lg)] border border-[color:var(--border)] bg-[color:rgba(12,21,37,0.94)] p-3 shadow-glass md:static md:flex md:items-center md:gap-2 md:border-0 md:bg-transparent md:p-0 md:shadow-none", mobileOpen ? "grid" : "hidden md:flex")} aria-label="Primary">
          {links.map((link) => {
            const active = pathname === link.href;
            return (
              <Link
                key={link.href}
                href={link.href as Route}
                className={cn(
                  "rounded-full px-4 py-2 text-sm transition duration-200",
                  active ? "bg-[color:rgba(124,58,237,0.12)] text-violet2" : "text-text2 hover:bg-[color:var(--surface)] hover:text-text"
                )}
                onClick={() => setMobileOpen(false)}
              >
                {link.label}
              </Link>
            );
          })}
        </nav>

        <div className="hidden items-center gap-3 md:flex">
          {address ? (
            <Badge variant="green" className="gap-2 normal-case tracking-normal">
              <span className="inline-block h-2 w-2 rounded-full bg-green animate-pulseSoft" />
              {shortenAddress(address)}
            </Badge>
          ) : null}
          <div className="wallet-button-shell">
            <WalletMultiButton />
          </div>
        </div>

        <div className="wallet-button-shell md:hidden">
          {address ? <WalletMultiButton /> : <Button size="sm">Connect Wallet</Button>}
        </div>
      </div>
    </header>
  );
}
