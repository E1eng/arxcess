import { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export function LoadingSkeleton({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("animate-shimmer rounded-[var(--radius)] bg-[length:200%_100%] bg-gradient-to-r from-[color:var(--surface)] via-[color:var(--surface2)] to-[color:var(--surface)]", className)} {...props} />;
}
