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

const navLinks: Array<{ href: Route; label: string; icon: React.ReactNode }> = [
  { 
    href: "/" as Route, 
    label: "Home", 
    icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg> 
  },
  { 
    href: "/explore" as Route, 
    label: "Explore", 
    icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg> 
  },
  { 
    href: "/launch" as Route, 
    label: "Launch", 
    icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242"/><path d="M12 12v9"/><path d="m8 17 4-4 4 4"/></svg> 
  },
  { 
    href: "/library" as Route, 
    label: "Library", 
    icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="8" height="8" x="3" y="3" rx="2"/><rect width="8" height="8" x="13" y="3" rx="2"/><rect width="8" height="8" x="3" y="13" rx="2"/><rect width="8" height="8" x="13" y="13" rx="2"/></svg> 
  },
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
    <aside className="flex h-full w-[240px] shrink-0 flex-col border-r border-[#1a1a2e] bg-[#0b0b12]">
      <div className="border-b border-[#1a1a2e] px-6 py-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <svg width="20" height="20" viewBox="0 0 22 22" fill="none" aria-hidden="true">
              <polygon points="11,2 20,19 2,19" fill="#8b5cf6" />
            </svg>
            <span className="font-head text-[16px] font-bold tracking-wide text-white">Arxcess</span>
          </div>
        </div>
      </div>

      {/* Nav links */}
      <nav className="flex flex-1 flex-col gap-1 px-3 py-6" aria-label="Sidebar">
        {navLinks.map((link) => {
          const active = link.href === "/"
            ? pathname === "/"
            : pathname === link.href || pathname?.startsWith(link.href + "/");
          const isLibrary = (link.href as string) === "/library";

          return (
            <Link
              key={link.href as string}
              href={link.href}
              className={cn(
                "group relative flex items-center justify-between rounded-lg px-3 py-3 text-[13px] font-medium transition-all duration-200",
                active
                  ? "bg-gradient-to-r from-purple-500/10 to-transparent text-purple-400"
                  : "text-[#8b8b9d] hover:bg-white/5 hover:text-white"
              )}
            >
              {active && (
                <div className="absolute left-0 top-1/2 h-6 w-1 -translate-y-1/2 rounded-r-full bg-purple-500 shadow-[0_0_10px_rgba(168,85,247,0.6)]" />
              )}
              <div className="flex items-center gap-3">
                <span className={cn(
                  "flex items-center justify-center transition-colors",
                  active ? "text-purple-400" : "text-[#5e5e73] group-hover:text-white"
                )}>
                  {link.icon}
                </span>
                <span className="tracking-wide">{link.label}</span>
              </div>
              {/* Library: lock icon if no wallet, count badge if connected */}
              {isLibrary ? (
                address ? (
                  libraryCount > 0 ? (
                    <span className={cn(
                      "flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[10px] font-bold",
                      active ? "bg-purple-500/20 text-purple-300" : "bg-[#1a1a2e] text-[#8b8b9d]"
                    )}>
                      {libraryCount}
                    </span>
                  ) : null
                ) : (
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-[#5e5e73]"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                )
              ) : null}
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-[#1a1a2e] px-4 py-4">
        <div className="wallet-button-shell w-full [&_.wallet-adapter-button-trigger]:w-full [&_.wallet-adapter-button-trigger]:justify-center [&_.wallet-adapter-button]:w-full [&_.wallet-adapter-button]:justify-center">
          <WalletMultiButton />
        </div>
      </div>
    </aside>
  );
}
