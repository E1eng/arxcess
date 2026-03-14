import { normalizeMarketplaceCategory } from "@/lib/marketplace/categories";

type CategoryIconProps = {
  category: string;
  className?: string;
};

export function CategoryIcon({ category, className }: CategoryIconProps) {
  const normalized = normalizeMarketplaceCategory(category);

  if (normalized === "image") {
    return (
      <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
        <circle cx="9" cy="10" r="1.6" />
        <path d="M6.5 16.5 11 12l3.2 3.2 1.8-1.8 1.5 1.5" />
      </svg>
    );
  }

  if (normalized === "video_gif") {
    return (
      <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect x="3.5" y="5" width="17" height="14" rx="2" />
        <path d="m10 9 5 3-5 3z" fill="currentColor" stroke="none" />
        <path d="M7 7.5v9" />
      </svg>
    );
  }

  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M7.5 3.5h6l4 4v13h-10a2 2 0 0 1-2-2v-13a2 2 0 0 1 2-2Z" />
      <path d="M13.5 3.5v4h4" />
      <path d="M8.5 13h7" />
      <path d="M8.5 16h5" />
    </svg>
  );
}
