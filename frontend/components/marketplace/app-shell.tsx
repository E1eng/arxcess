"use client";

import { PropsWithChildren } from "react";
import { Navbar } from "@/components/Navbar";

interface AppShellProps extends PropsWithChildren {
  footer?: boolean;
}

export function AppShell({ children, footer = true }: AppShellProps) {
  return (
    <div className="relative min-h-screen">
      <Navbar />
      <main className="mx-auto flex w-[min(1280px,calc(100%-24px))] flex-col gap-8 py-8 md:py-10">{children}</main>
      {footer ? (
        <footer className="mx-auto flex w-[min(1280px,calc(100%-24px))] flex-col gap-4 border-t border-[color:var(--border)] py-8 text-sm text-text2 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="font-head text-lg font-bold text-text">Arxcess</div>
            <p>Encrypted marketplace on Solana.</p>
          </div>
          <div className="flex flex-wrap gap-4">
            <span>Explore</span>
            <span>Launch</span>
            <span>Library</span>
            <span>© 2025 Arxcess · Built on Solana Devnet</span>
          </div>
        </footer>
      ) : null}
    </div>
  );
}
