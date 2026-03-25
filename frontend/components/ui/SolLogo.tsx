import { cn } from "@/lib/utils";

interface SolLogoProps {
  className?: string;
  size?: number;
}

export function SolLogo({ className, size = 14 }: SolLogoProps) {
  const gradientIdTop = `sol-logo-top-${size}`;
  const gradientIdMiddle = `sol-logo-middle-${size}`;
  const gradientIdBottom = `sol-logo-bottom-${size}`;

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
      <defs>
        <linearGradient id={gradientIdTop} x1="3.2" y1="4.25" x2="17.8" y2="9.5" gradientUnits="userSpaceOnUse">
          <stop stopColor="#00FFA3" />
          <stop offset="1" stopColor="#DC1FFF" />
        </linearGradient>
        <linearGradient id={gradientIdMiddle} x1="3.2" y1="10.375" x2="17.8" y2="15.625" gradientUnits="userSpaceOnUse">
          <stop stopColor="#00FFA3" />
          <stop offset="1" stopColor="#DC1FFF" />
        </linearGradient>
        <linearGradient id={gradientIdBottom} x1="3.2" y1="16.5" x2="17.8" y2="21.75" gradientUnits="userSpaceOnUse">
          <stop stopColor="#00FFA3" />
          <stop offset="1" stopColor="#DC1FFF" />
        </linearGradient>
      </defs>
      <path
        d="M4.5 16.5h13.5a.5.5 0 0 1 .354.854l-2.25 2.25a.5.5 0 0 1-.354.146H2.25a.5.5 0 0 1-.354-.854l2.25-2.25A.5.5 0 0 1 4.5 16.5Z"
        fill={`url(#${gradientIdBottom})`}
      />
      <path
        d="M4.5 4.25h13.5a.5.5 0 0 1 .354.854L16.1 7.354A.5.5 0 0 1 15.75 7.5H2.25a.5.5 0 0 1-.354-.854l2.25-2.25A.5.5 0 0 1 4.5 4.25Z"
        fill={`url(#${gradientIdTop})`}
      />
      <path
        d="M15.75 10.375H2.25a.5.5 0 0 0-.354.854l2.25 2.25a.5.5 0 0 0 .354.146h13.5a.5.5 0 0 0 .354-.854l-2.25-2.25a.5.5 0 0 0-.354-.146Z"
        fill={`url(#${gradientIdMiddle})`}
      />
    </svg>
  );
}
