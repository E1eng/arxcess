import { ReactNode } from "react";
import { Button } from "@/components/ui/Button";

interface EmptyStateProps {
  icon: ReactNode;
  title: string;
  description: string;
  action?: {
    label: string;
    onClick: () => void;
  };
}

export function EmptyState({ icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center gap-4 border border-[color:var(--border)] bg-[color:var(--surface)] px-6 py-14 text-center">
      <div className="flex h-12 w-12 items-center justify-center border border-[color:var(--border2)] bg-[color:var(--surface2)] text-2xl">{icon}</div>
      <div className="grid gap-1.5">
        <h3 className="font-head text-base font-bold uppercase tracking-[0.06em] text-white">{title}</h3>
        <p className="mx-auto max-w-sm text-[13px] leading-6 text-[color:var(--text2)]">{description}</p>
      </div>
      {action ? <Button onClick={action.onClick}>{action.label}</Button> : null}
    </div>
  );
}
