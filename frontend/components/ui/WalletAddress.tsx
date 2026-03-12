"use client";

import { useMemo, useState } from "react";
import { cn, shortenAddress } from "@/lib/utils";

interface WalletAddressProps {
  address: string;
  shortened?: boolean;
  copyable?: boolean;
  className?: string;
}

export function WalletAddress({ address, shortened = true, copyable = true, className }: WalletAddressProps) {
  const [copied, setCopied] = useState(false);
  const display = useMemo(() => (shortened ? shortenAddress(address) : address), [address, shortened]);

  async function handleCopy() {
    await navigator.clipboard.writeText(address);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }

  return (
    <span className={cn("inline-flex items-center gap-2 rounded-[var(--radius-sm)] border border-[color:var(--border)] bg-[color:var(--surface)] px-2.5 py-1 font-mono text-xs text-text2", className)}>
      <span>{display}</span>
      {copyable ? (
        <button className="text-text3 transition hover:text-text" type="button" onClick={() => void handleCopy()} aria-label="Copy wallet address">
          {copied ? "Copied!" : "Copy"}
        </button>
      ) : null}
    </span>
  );
}
