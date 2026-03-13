"use client";

import type { Route } from "next";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const links: Array<{ href: Route; label: string; icon: string }> = [
  { href: "/" as Route, label: "Home", icon: "⌂" },
  { href: "/explore" as Route, label: "Explore", icon: "◎" },
  { href: "/launch" as Route, label: "Launch", icon: "↑" },
  { href: "/library" as Route, label: "Library", icon: "▤" }
];

export function TopBar() {
  const pathname = usePathname();

  return (
    <div className="border-b border-[color:var(--border)] bg-black md:hidden">
      <div className="flex min-h-12 items-center justify-between gap-3 px-4">
        <div className="flex items-center gap-2">
          <svg width="14" height="14" viewBox="0 0 22 22" fill="none" aria-hidden="true">
            <polygon points="11,2 20,19 2,19" fill="#6B50FF" />
          </svg>
          <span className="font-head text-[12px] font-bold uppercase tracking-[0.08em] text-white">Arxcess</span>
          <span className="border border-[color:var(--border2)] px-1.5 py-px font-mono text-[9px] font-bold uppercase tracking-[0.1em] text-[color:var(--text2)]">Devnet</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="h-1.5 w-1.5 rounded-full bg-[color:var(--green)] animate-pulseSoft" />
          <span className="font-mono text-[10px] text-[color:var(--text3)]">Solana</span>
        </div>
      </div>

      <div className="flex gap-px border-t border-[color:var(--border)] px-2 py-2 md:hidden">
        {links.map((link) => {
          const active = (link.href as string) === "/"
            ? pathname === "/"
            : pathname === link.href || pathname?.startsWith(link.href + "/");

          return (
            <Link
              key={link.href}
              href={link.href}
              className={cn(
                "flex min-w-0 flex-1 items-center justify-center gap-1.5 border px-2 py-2 text-[10px] font-bold uppercase tracking-[0.08em]",
                active
                  ? "border-[#6B50FF] bg-[#6B50FF] text-white"
                  : "border-[color:var(--border)] bg-[color:var(--surface)] text-[color:var(--text2)]"
              )}
            >
              <span className="font-mono text-[10px]">{link.icon}</span>
              <span className="truncate">{link.label}</span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
