"use client";

import type { Route } from "next";
import Link from "next/link";
import { PropsWithChildren } from "react";
import { TopBar } from "@/components/TopBar";
import { Sidebar } from "@/components/Sidebar";

interface AppShellProps extends PropsWithChildren {
  footer?: boolean;
}

export function AppShell({ children }: AppShellProps) {
  return (
    <div className="flex min-h-screen flex-col bg-black">
      {/* Top bar */}
      <TopBar />

      {/* Body: sidebar + content */}
      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar — hidden on mobile, fixed on desktop */}
        <div className="hidden md:flex md:w-[240px] md:shrink-0">
          <div className="fixed top-0 bottom-0 w-[240px] overflow-hidden">
            <Sidebar />
          </div>
        </div>

        {/* Main content */}
        <main className="flex-1 overflow-auto">
          <div className="mx-auto max-w-[1080px] px-4 py-5 sm:px-5 sm:py-6">
            <div className="flex flex-col gap-5">{children}</div>
            <footer className="mt-8 border-t border-[color:var(--border)] pt-4">
              <div className="flex flex-col gap-3 text-[11px] text-[color:var(--text2)] sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-2">
                  <svg width="12" height="12" viewBox="0 0 22 22" fill="none" aria-hidden="true">
                    <polygon points="11,2 20,19 2,19" fill="#6B50FF" />
                  </svg>
                  <span className="font-head text-[11px] font-bold uppercase tracking-[0.08em] text-white">Arxcess</span>
                  <span className="text-[color:var(--text3)]">Encrypted marketplace on Solana</span>
                </div>
                <div className="flex flex-wrap gap-4 text-[color:var(--text3)]">
                  <Link href={"/explore" as Route}>Explore</Link>
                  <Link href={"/launch" as Route}>Launch</Link>
                  <Link href={"/library" as Route}>Library</Link>
                </div>
              </div>
            </footer>
          </div>
        </main>
      </div>
    </div>
  );
}
