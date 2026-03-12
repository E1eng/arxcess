export function cn(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

export function formatSOL(lamports: number | bigint | string) {
  const value = typeof lamports === "string" ? Number(lamports) : Number(lamports);
  if (!Number.isFinite(value)) {
    return "◎ 0.0000";
  }
  return `◎ ${(value / 1e9).toFixed(4)}`;
}

export function shortenAddress(address: string, chars = 4) {
  if (!address) {
    return "";
  }
  if (address.length <= chars * 2) {
    return address;
  }
  return `${address.slice(0, chars)}...${address.slice(-chars)}`;
}

export function relativeTime(value: Date | string | number) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Just now";
  }

  const diff = date.getTime() - Date.now();
  const abs = Math.abs(diff);
  const minutes = Math.round(abs / 60000);
  const hours = Math.round(abs / 3600000);
  const days = Math.round(abs / 86400000);

  if (minutes < 1) {
    return "Just now";
  }
  if (minutes < 60) {
    return `${diff < 0 ? "" : "in "}${minutes} min${minutes === 1 ? "" : "s"}${diff < 0 ? " ago" : ""}`;
  }
  if (hours < 24) {
    return `${diff < 0 ? "" : "in "}${hours} hour${hours === 1 ? "" : "s"}${diff < 0 ? " ago" : ""}`;
  }
  return `${diff < 0 ? "" : "in "}${days} day${days === 1 ? "" : "s"}${diff < 0 ? " ago" : ""}`;
}
