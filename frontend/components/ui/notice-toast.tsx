"use client";

import { useEffect } from "react";
import { cn } from "@/lib/utils";

type NoticeToastVariant = "error" | "success" | "info";

interface NoticeToastProps {
  message: string | null;
  open: boolean;
  onClose: () => void;
  title?: string;
  variant?: NoticeToastVariant;
}

const variantStyles: Record<NoticeToastVariant, { border: string; accent: string; bar: string; icon: string }> = {
  error: {
    border: "border-[color:rgba(239,68,68,0.28)]",
    accent: "bg-[color:rgba(239,68,68,0.16)] text-red",
    bar: "bg-red",
    icon: "!"
  },
  success: {
    border: "border-[color:rgba(34,197,94,0.28)]",
    accent: "bg-[color:rgba(34,197,94,0.16)] text-[color:var(--green)]",
    bar: "bg-[color:var(--green)]",
    icon: "✓"
  },
  info: {
    border: "border-[color:rgba(107,80,255,0.28)]",
    accent: "bg-[color:rgba(107,80,255,0.16)] text-[#9B8FFF]",
    bar: "bg-[#6B50FF]",
    icon: "i"
  }
};

export function NoticeToast({ message, open, onClose, title, variant = "error" }: NoticeToastProps) {
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

  const styles = variantStyles[variant];

  return (
    <div className={cn("fixed bottom-5 right-5 z-[80] flex min-w-[280px] max-w-[420px] items-start gap-3 rounded-[var(--radius-lg)] border bg-[color:rgba(12,21,37,0.92)] px-4 py-3 text-sm text-text shadow-glass animate-slideInRight", styles.border)} role="status" aria-live="polite">
      <span className={cn("mt-0.5 inline-flex h-6 w-6 items-center justify-center rounded-full", styles.accent)}>{styles.icon}</span>
      <div className="grid flex-1 gap-2">
        {title ? <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-text">{title}</span> : null}
        <span className="leading-6 text-text2">{message}</span>
        <span className="h-1 w-full overflow-hidden rounded-full bg-white/10">
          <span className={cn("block h-full w-full origin-left animate-[shrink_4.2s_linear_forwards] rounded-full", styles.bar)} />
        </span>
      </div>
      <button className="text-text3 transition hover:text-text" type="button" aria-label="Dismiss notification" onClick={onClose}>×</button>
    </div>
  );
}
