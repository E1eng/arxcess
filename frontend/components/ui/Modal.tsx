"use client";

import type { PropsWithChildren, ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/utils";

interface ModalProps extends PropsWithChildren {
  open: boolean;
  title: string;
  onClose: () => void;
  footer?: ReactNode;
}

export function Modal({ open, title, onClose, footer, children }: ModalProps) {
  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-[70] grid place-items-center bg-black/70 p-4 backdrop-blur-md" role="presentation" onClick={onClose}>
      <div className="grid w-full max-w-[480px] gap-4 rounded-[var(--radius-lg)] border border-[color:var(--border)] bg-[color:rgba(12,21,37,0.84)] p-5 shadow-glass animate-fadeUp" role="dialog" aria-modal="true" aria-label={title} onClick={(event) => event.stopPropagation()}>
        <div className="flex items-center justify-between gap-3">
          <h3 className="font-head text-xl font-bold text-text">{title}</h3>
          <button className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-[color:var(--border)] text-text2 transition hover:bg-[color:var(--surface2)] hover:text-text" type="button" onClick={onClose} aria-label="Close dialog">
            ×
          </button>
        </div>
        <div className="max-h-[60vh] overflow-y-auto text-sm leading-7 text-text2">{children}</div>
        <div className={cn("flex flex-wrap justify-end gap-3", footer ? "" : "justify-end")}>
          {footer ?? <Button variant="secondary" onClick={onClose}>Close</Button>}
        </div>
      </div>
    </div>
  );
}
