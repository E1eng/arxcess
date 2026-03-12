"use client";

import { useEffect } from "react";
import { cn } from "@/lib/utils";

interface NoticeToastProps {
  message: string | null;
  open: boolean;
  onClose: () => void;
}

export function NoticeToast({ message, open, onClose }: NoticeToastProps) {
  useEffect(() => {
    if (!open) {
      return;
    }

    const timeout = window.setTimeout(() => {
      onClose();
    }, 4200);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [onClose, open]);

  if (!open || !message) {
    return null;
  }

  return (
    <div className={cn("fixed bottom-5 right-5 z-[80] flex min-w-[280px] max-w-[420px] items-start gap-3 rounded-[var(--radius-lg)] border border-[color:rgba(239,68,68,0.28)] bg-[color:rgba(12,21,37,0.92)] px-4 py-3 text-sm text-text shadow-glass animate-slideInRight")} role="status" aria-live="polite">
      <span className="mt-0.5 inline-flex h-6 w-6 items-center justify-center rounded-full bg-[color:rgba(239,68,68,0.16)] text-red">!</span>
      <div className="grid flex-1 gap-2">
        <span className="leading-6 text-text2">{message}</span>
        <span className="h-1 w-full overflow-hidden rounded-full bg-[color:rgba(239,68,68,0.12)]">
          <span className="block h-full w-full origin-left animate-[shrink_4.2s_linear_forwards] rounded-full bg-red" />
        </span>
      </div>
      <button className="text-text3 transition hover:text-text" type="button" aria-label="Dismiss notification" onClick={onClose}>×</button>
    </div>
  );
}
