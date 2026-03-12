import { cn } from "@/lib/utils";

type StatusVariant = "pending_seal" | "delivered" | "locked" | "revoked";

const copy: Record<StatusVariant, { label: string; dot: string }> = {
  pending_seal: { label: "Awaiting Delivery", dot: "bg-amber shadow-[0_0_16px_rgba(245,158,11,0.45)] animate-pulseSoft" },
  delivered: { label: "Delivered", dot: "bg-green shadow-[0_0_16px_rgba(16,185,129,0.45)] animate-pulseSoft" },
  locked: { label: "Encrypted", dot: "bg-violet shadow-[0_0_16px_rgba(124,58,237,0.45)]" },
  revoked: { label: "Access Revoked", dot: "bg-red shadow-[0_0_16px_rgba(239,68,68,0.4)]" }
};

export function StatusIndicator({ status }: { status: StatusVariant }) {
  const state = copy[status];
  return (
    <span className="inline-flex items-center gap-2 text-sm text-text2">
      <span className={cn("h-2 w-2 rounded-full", state.dot)} aria-hidden="true" />
      <span>{state.label}</span>
    </span>
  );
}
