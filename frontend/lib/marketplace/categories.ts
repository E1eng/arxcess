export const MARKETPLACE_CATEGORIES = ["image", "video_gif", "other"] as const;

export type MarketplaceCategory = (typeof MARKETPLACE_CATEGORIES)[number];

export const CATEGORY_LABELS: Record<MarketplaceCategory, string> = {
  image: "Image",
  video_gif: "Video / GIF",
  other: "Other"
};

export function normalizeMarketplaceCategory(category: string): MarketplaceCategory {
  if (category === "image" || category === "video_gif" || category === "other") {
    return category;
  }

  return "other";
}
