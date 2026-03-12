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
    <div className="flex flex-col items-center justify-center gap-4 rounded-[var(--radius-lg)] border border-[color:var(--border)] bg-[color:rgba(12,21,37,0.55)] px-6 py-12 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-full border border-[color:var(--border2)] bg-[color:rgba(17,30,51,0.82)] text-4xl">{icon}</div>
      <div className="space-y-2">
        <h3 className="font-head text-2xl font-bold text-text">{title}</h3>
        <p className="mx-auto max-w-xl text-sm leading-7 text-text2">{description}</p>
      </div>
      {action ? <Button onClick={action.onClick}>{action.label}</Button> : null}
    </div>
  );
}
