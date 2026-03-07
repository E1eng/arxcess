"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { PropsWithChildren } from "react";
import { usePathname } from "next/navigation";

const WalletMultiButton = dynamic(
  () => import("@solana/wallet-adapter-react-ui").then((module) => module.WalletMultiButton),
  { ssr: false }
);

const links = [
  { href: "/products", label: "Explore" },
  { href: "/seller", label: "Launch" },
  { href: "/purchases", label: "Library" }
] as const;

export function AppShell({ children }: PropsWithChildren) {
  const pathname = usePathname();

  return (
    <main className="app-main">
      <div className="shell">
        <header className="nav-shell">
          <div className="nav-shell__row">
            <div className="nav-brand">
              <Link className="brand-link" href="/">
                <span className="brand-mark">AX</span>
                <strong>Arxcess</strong>
              </Link>
            </div>
            <nav className="nav-links" aria-label="Primary">
              {links.map((link) => (
                <Link key={link.href} className={pathname === link.href ? "nav-link active" : "nav-link"} href={link.href}>
                  {link.label}
                </Link>
              ))}
            </nav>
            <div className="nav-actions">
              <WalletMultiButton />
            </div>
          </div>
        </header>
        <div className="content-stack">{children}</div>
        <footer className="footer muted">
          <span>Encrypted files, wallet payments, and secure delivery.</span>
        </footer>
      </div>
    </main>
  );
}
