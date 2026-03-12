import { ButtonHTMLAttributes, forwardRef } from "react";
import { cn } from "@/lib/utils";

type ButtonVariant = "primary" | "secondary" | "ghost" | "cyan" | "danger" | "outline";
type ButtonSize = "sm" | "md" | "lg" | "icon";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
}

const variantClasses: Record<ButtonVariant, string> = {
  primary: "border border-transparent bg-gradient-to-r from-violet to-cyan text-white shadow-[var(--glow-v)] hover:-translate-y-0.5 hover:shadow-[var(--glow-v)]",
  secondary: "border border-[color:var(--border2)] bg-[color:var(--surface2)] text-text hover:border-violet hover:bg-[color:rgba(17,30,51,0.92)]",
  ghost: "border border-[color:var(--border)] bg-transparent text-text hover:bg-[color:rgba(12,21,37,0.65)]",
  cyan: "border border-transparent bg-gradient-to-r from-cyan to-cyan2 text-slate-950 shadow-[var(--glow-c)] hover:-translate-y-0.5 hover:shadow-[var(--glow-c)]",
  danger: "border border-[color:rgba(239,68,68,0.35)] bg-[color:rgba(239,68,68,0.12)] text-red hover:bg-[color:rgba(239,68,68,0.18)]",
  outline: "border border-[color:rgba(124,58,237,0.45)] bg-transparent text-violet2 hover:border-cyan hover:text-cyan2"
};

const sizeClasses: Record<ButtonSize, string> = {
  sm: "h-9 px-3.5 text-[13px]",
  md: "h-11 px-5 text-sm",
  lg: "h-14 px-7 text-base",
  icon: "h-[38px] w-[38px] px-0 text-sm"
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, children, variant = "primary", size = "md", loading = false, disabled, ...props },
  ref
) {
  return (
    <button
      ref={ref}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-[var(--radius)] font-medium transition duration-200 ease-out active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet2/70 disabled:cursor-not-allowed disabled:opacity-40",
        variantClasses[variant],
        sizeClasses[size],
        className
      )}
      disabled={disabled || loading}
      {...props}
    >
      {loading ? <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-r-transparent" aria-hidden="true" /> : null}
      <span>{loading ? "Loading..." : children}</span>
    </button>
  );
});
