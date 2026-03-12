import { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

type BadgeVariant = "violet" | "cyan" | "green" | "amber" | "red" | "gray";

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
}

const variants: Record<BadgeVariant, string> = {
  violet: "border-[color:rgba(124,58,237,0.35)] bg-[color:rgba(124,58,237,0.12)] text-violet2",
  cyan: "border-[color:rgba(6,182,212,0.35)] bg-[color:rgba(6,182,212,0.12)] text-cyan2",
  green: "border-[color:rgba(16,185,129,0.35)] bg-[color:rgba(16,185,129,0.12)] text-green",
  amber: "border-[color:rgba(245,158,11,0.35)] bg-[color:rgba(245,158,11,0.12)] text-amber",
  red: "border-[color:rgba(239,68,68,0.35)] bg-[color:rgba(239,68,68,0.12)] text-red",
  gray: "border-[color:var(--border2)] bg-[color:rgba(148,163,184,0.12)] text-text2"
};

export function Badge({ className, variant = "violet", ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.08em]",
        variants[variant],
        className
      )}
      {...props}
    />
  );
}
