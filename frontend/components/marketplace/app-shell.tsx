"use client";

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
        <div className="hidden md:flex md:w-[200px] md:shrink-0">
          <div className="fixed top-[41px] bottom-0 w-[200px] overflow-hidden">
            <Sidebar />
          </div>
        </div>

        {/* Main content */}
        <main className="flex-1 overflow-auto">
          <div className="mx-auto max-w-[1080px] px-5 py-6">
            <div className="flex flex-col gap-5">{children}</div>
          </div>
        </main>
      </div>
    </div>
  );
}
