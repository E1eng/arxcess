const LAMPORTS_PER_SOL = 1_000_000_000;

export function solToLamports(value: string): bigint {
  const normalized = value.trim();
  if (!normalized) {
    return 0n;
  }

  const [whole, fraction = ""] = normalized.split(".");
  const fractionPadded = `${fraction}000000000`.slice(0, 9);
  return BigInt(whole || "0") * BigInt(LAMPORTS_PER_SOL) + BigInt(fractionPadded || "0");
}

export function formatLamports(value: bigint): string {
  const whole = value / BigInt(LAMPORTS_PER_SOL);
  const fraction = value % BigInt(LAMPORTS_PER_SOL);
  if (fraction === 0n) {
    return `${whole.toString()} SOL`;
  }
  return `${whole.toString()}.${fraction.toString().padStart(9, "0").replace(/0+$/, "")} SOL`;
}
