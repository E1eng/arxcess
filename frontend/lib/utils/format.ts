export function truncateValue(value: string, head = 12, tail = 8) {
  if (value.length <= head + tail + 3) {
    return value;
  }

  return `${value.slice(0, head)}...${value.slice(-tail)}`;
}

export function formatBytes(bytes: number) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }

  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatLicenseDuration(seconds: number) {
  if (seconds === 0) {
    return "No expiry";
  }

  const days = Math.floor(seconds / 86400);
  return `${days} days`;
}

export function formatOptionalDateTime(value: string | number | null | undefined) {
  if (!value) {
    return null;
  }

  const date = typeof value === "number" ? new Date(value) : new Date(value);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date.toLocaleString();
}
