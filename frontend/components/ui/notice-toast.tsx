"use client";

import { useEffect } from "react";

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
    <div className="notice-toast" role="status" aria-live="polite">
      <span>{message}</span>
      <button className="icon-button" type="button" aria-label="Dismiss notification" onClick={onClose}>
        ×
      </button>
    </div>
  );
}
