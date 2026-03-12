"use client";

import { PropsWithChildren } from "react";
import { Button } from "@/components/ui/Button";

interface OverlayDialogProps extends PropsWithChildren {
  open: boolean;
  title: string;
  onClose: () => void;
}

export function OverlayDialog({ children, open, title, onClose }: OverlayDialogProps) {
  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-[70] grid place-items-center bg-black/70 p-4 backdrop-blur-md" role="presentation" onClick={onClose}>
      <div
        className="grid w-full max-w-[560px] gap-4 rounded-[var(--radius-lg)] border border-[color:var(--border)] bg-[color:rgba(12,21,37,0.92)] p-5 shadow-glass animate-fadeUp"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3">
          <strong className="font-head text-xl text-text">{title}</strong>
          <button className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-[color:var(--border)] text-text2 transition hover:bg-[color:var(--surface2)] hover:text-text" type="button" aria-label="Close dialog" onClick={onClose}>
            ×
          </button>
        </div>
        <div className="grid gap-3 text-sm leading-7 text-text2">{children}</div>
        <div className="flex justify-end">
          <Button type="button" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </div>
  );
}

interface InfoButtonProps {
  label?: string;
  onClick: () => void;
}

export function InfoButton({ label = "View flow details", onClick }: InfoButtonProps) {
  return (
    <button className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-[color:var(--border)] bg-[color:rgba(12,21,37,0.75)] text-cyan2 transition hover:border-cyan hover:bg-[color:var(--surface2)]" type="button" aria-label={label} onClick={onClick}>
      i
    </button>
  );
}
