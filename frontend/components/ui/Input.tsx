import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

interface BaseFieldProps {
  label?: string;
  hint?: string | null;
  error?: string | null;
  prefix?: ReactNode;
  suffix?: ReactNode;
  className?: string;
}

type InputProps = BaseFieldProps & InputHTMLAttributes<HTMLInputElement>;
type TextareaProps = BaseFieldProps & TextareaHTMLAttributes<HTMLTextAreaElement>;
type SelectProps = BaseFieldProps & SelectHTMLAttributes<HTMLSelectElement>;

function Frame({ label, hint, error, prefix, suffix, className, children }: BaseFieldProps & { children: ReactNode }) {
  return (
    <label className={cn("grid gap-2 text-[14px]", className)}>
      {label ? <span className="text-[12px] font-bold uppercase tracking-wider text-[#5e5e73]">{label}</span> : null}
      <div className={cn(
        "relative flex items-center overflow-hidden rounded-xl border bg-gradient-to-b from-[#131320] to-[#0b0b12] transition-all",
        "focus-within:border-[#6B50FF] focus-within:shadow-[0_0_15px_rgba(107,80,255,0.15)]",
        error ? "border-red-500/50" : "border-[#2e2e48]"
      )}>
        {prefix ? <span className="pointer-events-none absolute left-4 text-[#5e5e73]">{prefix}</span> : null}
        {children}
        {suffix ? <span className="absolute right-4 text-[12px] font-bold uppercase tracking-wider text-[#5e5e73]">{suffix}</span> : null}
      </div>
      {error ? <span className="text-[12px] text-red-400">{error}</span> : hint ? <span className="text-[12px] text-[#8b8b9d]">{hint}</span> : null}
    </label>
  );
}

export function Input({ label, hint, error, prefix, suffix, className, ...props }: InputProps) {
  return (
    <Frame label={label} hint={hint} error={error} prefix={prefix} suffix={suffix} className={className}>
      <input className={cn("h-[52px] w-full bg-transparent px-4 text-white outline-none placeholder:text-[#5e5e73]", prefix ? "pl-11" : "", suffix ? "pr-14" : "")} {...props} />
    </Frame>
  );
}

export function Textarea({ label, hint, error, prefix, suffix, className, ...props }: TextareaProps) {
  return (
    <Frame label={label} hint={hint} error={error} prefix={prefix} suffix={suffix} className={className}>
      <textarea className={cn("min-h-[140px] w-full resize-y bg-transparent px-4 py-4 text-white outline-none placeholder:text-[#5e5e73]", prefix ? "pl-11" : "", suffix ? "pr-14" : "")} {...props} />
    </Frame>
  );
}

export function Select({ label, hint, error, prefix, suffix, className, children, ...props }: SelectProps) {
  return (
    <Frame label={label} hint={hint} error={error} prefix={prefix} suffix={suffix} className={className}>
      <select className={cn("h-[52px] w-full appearance-none bg-transparent px-4 text-white outline-none", prefix ? "pl-11" : "", suffix ? "pr-14" : "")} {...props}>
        {children}
      </select>
      <div className="pointer-events-none absolute right-4 flex h-full items-center text-[#5e5e73]">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6"/></svg>
      </div>
    </Frame>
  );
}
