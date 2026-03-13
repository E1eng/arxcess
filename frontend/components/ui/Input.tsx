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
    <label className={cn("grid gap-2 text-sm text-text", className)}>
      {label ? <span className="text-[11px] font-bold uppercase tracking-[0.08em] text-text2">{label}</span> : null}
      <div className={cn("relative flex items-center overflow-hidden rounded-[var(--radius)] border bg-[color:var(--surface)] transition focus-within:border-violet focus-within:shadow-[0_0_0_3px_rgba(124,58,237,0.12)]", error ? "border-red/60" : "border-[color:var(--border2)]")}>
        {prefix ? <span className="pointer-events-none absolute left-4 text-text3">{prefix}</span> : null}
        {children}
        {suffix ? <span className="absolute right-4 text-xs font-medium uppercase tracking-[0.08em] text-text3">{suffix}</span> : null}
      </div>
      {error ? <span className="text-xs text-red">{error}</span> : hint ? <span className="text-xs text-text2">{hint}</span> : null}
    </label>
  );
}

export function Input({ label, hint, error, prefix, suffix, className, ...props }: InputProps) {
  return (
    <Frame label={label} hint={hint} error={error} prefix={prefix} suffix={suffix} className={className}>
      <input className={cn("h-12 w-full bg-transparent px-4 text-text outline-none placeholder:text-text3", prefix ? "pl-11" : "", suffix ? "pr-14" : "")} {...props} />
    </Frame>
  );
}

export function Textarea({ label, hint, error, prefix, suffix, className, ...props }: TextareaProps) {
  return (
    <Frame label={label} hint={hint} error={error} prefix={prefix} suffix={suffix} className={className}>
      <textarea className={cn("min-h-[120px] w-full resize-y bg-transparent px-4 py-3 text-text outline-none placeholder:text-text3", prefix ? "pl-11" : "", suffix ? "pr-14" : "")} {...props} />
    </Frame>
  );
}

export function Select({ label, hint, error, prefix, suffix, className, children, ...props }: SelectProps) {
  return (
    <Frame label={label} hint={hint} error={error} prefix={prefix} suffix={suffix} className={className}>
      <select className={cn("h-12 w-full appearance-none bg-[color:var(--surface)] px-4 text-white outline-none", prefix ? "pl-11" : "", suffix ? "pr-14" : "")} {...props}>
        {children}
      </select>
    </Frame>
  );
}
