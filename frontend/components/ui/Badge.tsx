import { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

type BadgeVariant = "violet" | "cyan" | "green" | "amber" | "red" | "gray";

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
}

const variants: Record<BadgeVariant, string> = {
  violet: "border border-[#6B50FF] bg-[#6B50FF] text-white",
  cyan:   "border border-[color:var(--border2)] bg-transparent text-[color:var(--cyan2)]",
  green:  "border border-[color:var(--green)] bg-transparent text-[color:var(--green)]",
  amber:  "border border-[color:var(--amber)] bg-transparent text-[color:var(--amber)]",
  red:    "border border-[color:var(--red)] bg-transparent text-[color:var(--red)]",
  gray:   "border border-[color:var(--border2)] bg-transparent text-[color:var(--text2)]"
};

export function Badge({ className, variant = "gray", ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.1em]",
        variants[variant],
        className
      )}
      {...props}
    />
  );
}
