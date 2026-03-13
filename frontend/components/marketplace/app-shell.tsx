"use client";

import { PropsWithChildren } from "react";
import { Navbar } from "@/components/Navbar";

interface AppShellProps extends PropsWithChildren {
  footer?: boolean;
}

export function AppShell({ children, footer = true }: AppShellProps) {
  return (
    <div className="min-h-screen bg-black">
      <Navbar />
      <main className="mx-auto w-[min(1280px,calc(100%-24px))] py-6 md:py-8">
        <div className="flex flex-col gap-4">{children}</div>
      </main>
      {footer ? (
        <footer className="border-t border-[color:var(--border)]">
          <div className="mx-auto flex w-[min(1280px,calc(100%-24px))] flex-wrap items-center justify-between gap-4 py-5 text-[11px] text-[color:var(--text2)]">
            <div className="flex items-center gap-2">
              <svg width="14" height="14" viewBox="0 0 22 22" fill="none" aria-hidden="true">
                <polygon points="11,2 20,19 2,19" fill="#6B50FF" />
              </svg>
              <span className="font-bold uppercase tracking-[0.1em] text-white">Arxcess</span>
              <span>— Encrypted marketplace on Solana</span>
            </div>
            <div className="flex flex-wrap gap-4 font-mono uppercase tracking-[0.08em]">
              <span>Explore</span>
              <span>Launch</span>
              <span>Library</span>
              <span className="text-[color:var(--text3)]">© 2025 · Devnet</span>
            </div>
          </div>
        </footer>
      ) : null}
    </div>
  );
}
