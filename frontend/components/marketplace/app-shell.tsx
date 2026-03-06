"use client";

import Link from "next/link";
import { PropsWithChildren } from "react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { usePathname } from "next/navigation";

const links = [
  { href: "/seller", label: "Seller" },
  { href: "/products", label: "Products" },
  { href: "/purchases", label: "Purchases" }
] as const;

export function AppShell({ children }: PropsWithChildren) {
  const pathname = usePathname();

  return (
    <main>
      <div className="shell">
        <header className="nav-shell">
          <div className="nav-brand">
            <Link className="brand-link" href="/">
              <span className="brand-mark">AX</span>
              <span>
                <strong>Arxcess</strong>
                <span className="muted">Encrypted digital assets on Solana + Arcium</span>
              </span>
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
            <span className="badge">Browser-encrypted workflow</span>
            <WalletMultiButton />
          </div>
        </header>
        <div className="content-stack">{children}</div>
        <footer className="footer muted">
          <span>Client-side encryption, IPFS storage, and Solana-oriented purchase preparation in one workspace.</span>
          <span>Prototype flow: encrypt, upload, list, prepare purchase, deliver later.</span>
        </footer>
      </div>
    </main>
  );
}
