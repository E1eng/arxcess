"use client";

import { PropsWithChildren } from "react";
import { TopBar } from "@/components/TopBar";
import { Sidebar } from "@/components/Sidebar";

export function AppShell({ children }: PropsWithChildren) {
  return (
    <div className="flex min-h-screen flex-col bg-transparent">
      {/* Top bar */}
      <TopBar />

      {/* Body: sidebar + content */}
      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar - hidden on mobile, fixed on desktop */}
        <div className="hidden md:flex md:w-[240px] md:shrink-0">
          <div className="fixed top-0 bottom-0 w-[240px] overflow-hidden bg-[#0b0b12]/80 backdrop-blur-md border-r border-[#1a1a2e]">
            <Sidebar />
          </div>
        </div>

        {/* Main content */}
        <main className="flex-1 overflow-auto relative">
          <div className="mx-auto max-w-[1080px] px-4 py-5 sm:px-5 sm:py-6">
            <div className="flex flex-col gap-5 relative z-10">{children}</div>
            
            <footer className="mt-8 border-t border-[#1a1a2e] pt-4 relative z-10">
              <div className="flex flex-col gap-3 text-[11px] text-[#5e5e73] sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-2">
                  <svg width="12" height="12" viewBox="0 0 22 22" fill="none" aria-hidden="true">
                    <polygon points="11,2 20,19 2,19" fill="#8b5cf6" />
                  </svg>
                  <span className="font-head text-[11px] font-bold uppercase tracking-widest text-white">Arxcess</span>
                  <span className="text-[#5e5e73]">Encrypted marketplace on Solana</span>
                </div>
                <a
                  href="https://twitter.com/arxcess"
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-1.5 text-[#5e5e73] transition-colors hover:text-white"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.748l7.738-8.835L1.254 2.25H8.08l4.259 5.63 5.905-5.63Zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                  </svg>
                  Twitter
                </a>
              </div>
            </footer>
          </div>
        </main>
      </div>
    </div>
  );
}
