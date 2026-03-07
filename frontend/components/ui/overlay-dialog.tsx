"use client";

import { PropsWithChildren } from "react";

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
    <div className="overlay-backdrop" role="presentation" onClick={onClose}>
      <div
        className="overlay-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="overlay-dialog__header">
          <strong>{title}</strong>
          <button className="icon-button" type="button" aria-label="Close dialog" onClick={onClose}>
            ×
          </button>
        </div>
        <div className="overlay-dialog__body">{children}</div>
        <div className="overlay-dialog__actions">
          <button className="button" type="button" onClick={onClose}>
            Close
          </button>
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
    <button className="icon-button icon-button--info" type="button" aria-label={label} onClick={onClick}>
      i
    </button>
  );
}
