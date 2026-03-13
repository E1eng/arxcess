import { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  variant?: "default" | "elevated" | "glass";
}

export function Card({ className, variant = "default", ...props }: CardProps) {
  return (
    <div
      className={cn(
        "border border-[color:var(--border)] bg-[color:var(--surface)]",
        variant === "elevated" ? "bg-[color:var(--surface2)]" : "",
        variant === "glass" ? "bg-[color:var(--surface)]" : "",
        className
      )}
      {...props}
    />
  );
}
