import { ButtonHTMLAttributes, forwardRef } from "react";
import { cn } from "@/lib/utils";

type ButtonVariant = "primary" | "secondary" | "ghost" | "cyan" | "violet" | "danger" | "outline";
type ButtonSize = "sm" | "md" | "lg" | "icon";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
}

const variantClasses: Record<ButtonVariant, string> = {
  primary:   "border border-[#6B50FF] bg-[#6B50FF] text-white hover:bg-[#7B62FF] hover:border-[#7B62FF]",
  secondary: "border border-[color:var(--border2)] bg-[color:var(--surface2)] text-[color:var(--text)] hover:border-[#6B50FF] hover:text-white",
  ghost:     "border border-[color:var(--border)] bg-transparent text-[color:var(--text2)] hover:bg-[color:var(--surface2)] hover:text-[color:var(--text)]",
  cyan:      "border border-[color:var(--cyan)] bg-[color:var(--cyan)] text-black hover:opacity-90",
  violet:    "border border-[#6B50FF] bg-[#6B50FF] text-white hover:bg-[#7B62FF] hover:border-[#7B62FF]",
  danger:    "border border-[color:rgba(239,68,68,0.4)] bg-[color:rgba(239,68,68,0.1)] text-[color:var(--red)] hover:bg-[color:rgba(239,68,68,0.18)]",
  outline:   "border border-[#6B50FF] bg-transparent text-[#9B8FFF] hover:bg-[#6B50FF] hover:text-white"
};

const sizeClasses: Record<ButtonSize, string> = {
  sm:   "h-8 px-3 text-[11px] tracking-[0.06em] uppercase font-bold",
  md:   "h-9 px-4 text-[12px] tracking-[0.08em] uppercase font-bold",
  lg:   "h-11 px-6 text-[13px] tracking-[0.1em] uppercase font-bold",
  icon: "h-8 w-8 px-0 text-sm"
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, children, variant = "primary", size = "md", loading = false, disabled, ...props },
  ref
) {
  return (
    <button
      ref={ref}
      className={cn(
        "inline-flex items-center justify-center gap-2 font-semibold transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6B50FF]/50 disabled:cursor-not-allowed disabled:opacity-40",
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
