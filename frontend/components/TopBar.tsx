"use client";

export function TopBar() {
  return (
    <div className="flex h-[41px] shrink-0 items-center justify-between border-b border-[color:var(--border)] bg-black px-4">
      <div className="flex items-center gap-2">
        <span className="font-mono text-[10px] text-[color:var(--text3)]">Arxcess</span>
        <span className="border border-[color:var(--border2)] px-1.5 py-px font-mono text-[9px] font-bold uppercase tracking-[0.1em] text-[color:var(--text3)]">Devnet</span>
      </div>
      <div className="flex items-center gap-2">
        <span className="h-1.5 w-1.5 rounded-full bg-[color:var(--green)] animate-pulseSoft" />
        <span className="font-mono text-[10px] text-[color:var(--text3)]">Solana</span>
      </div>
    </div>
  );
}
