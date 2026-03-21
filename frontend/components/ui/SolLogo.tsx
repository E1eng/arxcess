import { cn } from "@/lib/utils";

interface SolLogoProps {
  className?: string;
  size?: number;
}

export function SolLogo({ className, size = 14 }: SolLogoProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={cn("shrink-0", className)}
      aria-label="SOL"
    >
      <path
        d="M4.5 16.5h13.5a.5.5 0 0 1 .354.854l-2.25 2.25a.5.5 0 0 1-.354.146H2.25a.5.5 0 0 1-.354-.854l2.25-2.25A.5.5 0 0 1 4.5 16.5Z"
        fill="currentColor"
      />
      <path
        d="M4.5 4.25h13.5a.5.5 0 0 1 .354.854L16.1 7.354A.5.5 0 0 1 15.75 7.5H2.25a.5.5 0 0 1-.354-.854l2.25-2.25A.5.5 0 0 1 4.5 4.25Z"
        fill="currentColor"
      />
      <path
        d="M15.75 10.375H2.25a.5.5 0 0 0-.354.854l2.25 2.25a.5.5 0 0 0 .354.146h13.5a.5.5 0 0 0 .354-.854l-2.25-2.25a.5.5 0 0 0-.354-.146Z"
        fill="currentColor"
      />
    </svg>
  );
}
