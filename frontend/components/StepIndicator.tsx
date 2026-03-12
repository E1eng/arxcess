import { cn } from "@/lib/utils";

interface StepIndicatorProps {
  steps: string[];
  currentStep: number;
}

export function StepIndicator({ steps, currentStep }: StepIndicatorProps) {
  return (
    <div className="grid gap-4 md:grid-cols-[repeat(4,minmax(0,1fr))]">
      {steps.map((step, index) => {
        const stepNumber = index + 1;
        const done = stepNumber < currentStep;
        const active = stepNumber === currentStep;

        return (
          <div key={step} className="relative grid gap-2">
            {index < steps.length - 1 ? (
              <span className={cn("absolute left-[calc(50%+20px)] top-5 hidden h-px w-[calc(100%-40px)] md:block", done ? "bg-green/80" : "bg-[color:var(--border)]")} aria-hidden="true" />
            ) : null}
            <div className="flex items-center gap-3">
              <span className={cn("flex h-10 w-10 items-center justify-center rounded-full border text-sm font-semibold", done ? "border-green/40 bg-green/15 text-green" : active ? "border-transparent bg-gradient-to-r from-violet to-cyan text-white shadow-[var(--glow-v)]" : "border-[color:var(--border)] bg-[color:var(--surface2)] text-text3")}>
                {done ? "✓" : stepNumber}
              </span>
              <div className="grid gap-0.5">
                <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-text3">Step {stepNumber}</span>
                <span className={cn("text-sm", active || done ? "text-text" : "text-text2")}>{step}</span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
