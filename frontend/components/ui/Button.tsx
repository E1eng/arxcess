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
  primary:   "bg-gradient-to-r from-purple-600 to-purple-500 text-white shadow-[0_0_15px_rgba(168,85,247,0.4)] hover:scale-[1.02] border border-transparent",
  secondary: "border border-[#2e2e48] bg-[#1a1a2e] text-white hover:bg-[#2e2e48]",
  ghost:     "border border-transparent bg-transparent text-[#8b8b9d] hover:text-white hover:bg-[#1a1a2e]",
  cyan:      "border border-cyan-500/50 bg-cyan-500/10 text-cyan-400 hover:bg-cyan-500/20",
  violet:    "bg-gradient-to-r from-[#6B50FF] to-[#8B5CF6] text-white shadow-[0_0_15px_rgba(107,80,255,0.4)] hover:scale-[1.02] border border-transparent",
  danger:    "border border-red-500/30 bg-red-500/10 text-red-400 hover:bg-red-500/20",
  outline:   "border border-purple-500/50 bg-transparent text-purple-400 hover:bg-purple-500/10"
};

const sizeClasses: Record<ButtonSize, string> = {
  sm:   "h-9 px-4 text-[11px] font-bold uppercase tracking-wider rounded-lg",
  md:   "h-10 px-5 text-[12px] font-bold uppercase tracking-wider rounded-lg",
  lg:   "h-12 px-8 text-[13px] font-bold uppercase tracking-wider rounded-xl",
  icon: "h-9 w-9 px-0 text-sm rounded-lg"
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, children, variant = "primary", size = "md", loading = false, disabled, ...props },
  ref
) {
  return (
    <button
      ref={ref}
      className={cn(
        "inline-flex items-center justify-center gap-2 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6B50FF]/50 disabled:pointer-events-none disabled:opacity-50",
        variantClasses[variant],
        sizeClasses[size],
        className
      )}
      disabled={disabled || loading}
      {...props}
    >
      {loading ? <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-r-transparent" aria-hidden="true" /> : null}
      <span>{loading ? "Loading..." : children}</span>
    </button>
  );
});
