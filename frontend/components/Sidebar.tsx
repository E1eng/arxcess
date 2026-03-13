"use client";

import type { Route } from "next";
import dynamic from "next/dynamic";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMemo } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { usePurchases } from "@/hooks/use-purchases";
import { cn } from "@/lib/utils";

const WalletMultiButton = dynamic(
  () => import("@solana/wallet-adapter-react-ui").then((module) => module.WalletMultiButton),
  { ssr: false }
);

const navLinks: Array<{ href: Route; label: string; icon: string }> = [
  { href: "/" as Route,        label: "Home",    icon: "⌂" },
  { href: "/explore" as Route, label: "Explore", icon: "◎" },
  { href: "/launch" as Route,  label: "Launch",  icon: "↑" },
  { href: "/library" as Route, label: "Library", icon: "▤" },
];

export function Sidebar() {
  const pathname = usePathname();
  const { publicKey } = useWallet();
  const { purchases } = usePurchases();
  const address = useMemo(() => publicKey?.toBase58() ?? null, [publicKey]);

  const libraryCount = useMemo(() => {
    if (!address) return 0;
    return purchases.filter((p) => p.buyerWallet === address).length;
  }, [purchases, address]);

  return (
    <aside className="flex h-full w-[240px] shrink-0 flex-col border-r border-[color:var(--border)] bg-black">
      <div className="border-b border-[color:var(--border)] px-4 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <svg width="16" height="16" viewBox="0 0 22 22" fill="none" aria-hidden="true">
              <polygon points="11,2 20,19 2,19" fill="#6B50FF" />
            </svg>
            <span className="font-head text-[13px] font-bold uppercase tracking-[0.08em] text-white">Arxcess</span>
          </div>
          <span className="border border-[color:var(--border2)] px-1.5 py-px font-mono text-[9px] font-bold uppercase tracking-[0.1em] text-[color:var(--text2)]">
            Devnet
          </span>
        </div>
      </div>

      {/* Nav links */}
      <nav className="flex flex-1 flex-col gap-px px-2 py-3" aria-label="Sidebar">
        {navLinks.map((link) => {
          const active = link.href === "/"
            ? pathname === "/"
            : pathname === link.href || pathname?.startsWith(link.href + "/");
          const isLibrary = (link.href as string) === "/library";

          return (
            <Link
              key={link.href}
              href={link.href}
              className={cn(
                "group flex items-center justify-between gap-2.5 px-3 py-2.5 text-[11px] font-bold uppercase tracking-[0.1em] transition-colors",
                active
                  ? "bg-[#6B50FF] text-white"
                  : "text-[color:var(--text2)] hover:bg-[color:var(--surface)] hover:text-white"
              )}
            >
              <div className="flex items-center gap-2.5">
                <span className="w-3 text-center font-mono text-[11px] leading-none">{link.icon}</span>
                <span>{link.label}</span>
              </div>
              {/* Library: lock icon if no wallet, count badge if connected */}
              {isLibrary ? (
                address ? (
                  libraryCount > 0 ? (
                    <span className={cn(
                      "flex h-4 min-w-4 items-center justify-center px-1 font-mono text-[9px] font-bold",
                      active ? "bg-white/20 text-white" : "bg-[#6B50FF] text-white"
                    )}>
                      {libraryCount}
                    </span>
                  ) : null
                ) : (
                  <span className="font-mono text-[10px] text-[color:var(--text3)]">🔒</span>
                )
              ) : null}
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-[color:var(--border)] px-4 py-4">
        <div className="wallet-button-shell w-full [&_.wallet-adapter-button-trigger]:w-full [&_.wallet-adapter-button-trigger]:justify-center [&_.wallet-adapter-button]:w-full [&_.wallet-adapter-button]:justify-center">
          <WalletMultiButton />
        </div>
      </div>

    </aside>
  );
}
