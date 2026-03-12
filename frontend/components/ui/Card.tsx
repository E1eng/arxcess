import { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  variant?: "glass" | "solid";
}

export function Card({ className, variant = "glass", ...props }: CardProps) {
  return (
    <div
      className={cn(
        "overflow-hidden rounded-[var(--radius-lg)] border transition duration-200 ease-out hover:border-[color:var(--border2)]",
        variant === "glass"
          ? "border-[color:var(--border)] bg-[color:rgba(12,21,37,0.7)] backdrop-blur-xl shadow-glass"
          : "border-[color:var(--border)] bg-[color:var(--surface)]",
        className
      )}
      {...props}
    />
  );
}
